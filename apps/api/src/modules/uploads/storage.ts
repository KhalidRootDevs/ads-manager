/**
 * Creative asset storage drivers (the uploads module's "repo").
 * - local (development): signed PUT to the API itself, files under <repo>/.data/uploads, served at /media.
 * - s3: pre-signed S3 PUT to the private creatives bucket, served through the CDN (§3.1, §9).
 */
import { createHmac, timingSafeEqual } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { Env } from "../../env"

export interface PutTarget {
  url: string
  headers: Record<string, string>
}

export interface StorageDriver {
  kind: "local" | "s3"
  presign(key: string, mime: string, bytes: number, expiresAt: Date): Promise<PutTarget>
  publicUrl(key: string): string
}

/** Repo root (the folder with pnpm-workspace.yaml), walking up from cwd. */
function repoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

export const uploadDir = (env: Pick<Env, "UPLOAD_DIR">) => resolve(env.UPLOAD_DIR ?? join(repoRoot(), ".data", "uploads"))

export function signLocal(secret: string, uploadId: string, exp: number) {
  return createHmac("sha256", secret).update(`upload:${uploadId}:${exp}`).digest("base64url")
}

export function verifyLocal(secret: string, uploadId: string, exp: number, sig: string) {
  const want = Buffer.from(signLocal(secret, uploadId, exp))
  const got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got)
}

export function localDriver(env: Pick<Env, "API_URL" | "CDN_BASE_URL" | "SESSION_SECRET">): StorageDriver {
  return {
    kind: "local",
    async presign(key, mime, _bytes, expiresAt) {
      const uploadId = key.split("/")[0]
      const exp = Math.floor(expiresAt.getTime() / 1000)
      return { url: `${env.API_URL}/v1/uploads/${uploadId}?exp=${exp}&sig=${signLocal(env.SESSION_SECRET, uploadId, exp)}`, headers: { "Content-Type": mime } }
    },
    publicUrl: (key) => `${env.CDN_BASE_URL.replace(/\/$/, "")}/${key}`,
  }
}

export async function saveLocal(env: Pick<Env, "UPLOAD_DIR">, key: string, body: Buffer) {
  const path = join(uploadDir(env), key)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, body, { flag: "wx" })
  return path
}

export async function s3Driver(env: Pick<Env, "S3_BUCKET_CREATIVES" | "CDN_BASE_URL" | "AWS_REGION">): Promise<StorageDriver> {
  if (!env.S3_BUCKET_CREATIVES) throw new Error("STORAGE_DRIVER=s3 needs S3_BUCKET_CREATIVES")
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3")
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner")
  const client = new S3Client({ region: env.AWS_REGION })
  return {
    kind: "s3",
    async presign(key, mime, bytes, expiresAt) {
      const cmd = new PutObjectCommand({ Bucket: env.S3_BUCKET_CREATIVES, Key: key, ContentType: mime, ContentLength: bytes, CacheControl: "public, max-age=31536000, immutable" })
      const url = await getSignedUrl(client, cmd, { expiresIn: Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) })
      return { url, headers: { "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable" } }
    },
    publicUrl: (key) => `${env.CDN_BASE_URL.replace(/\/$/, "")}/${key}`,
  }
}
