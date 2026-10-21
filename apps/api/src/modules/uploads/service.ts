import { newId } from "@orbit/domain"
import { badRequest, forbidden, HttpError, notFound, unprocessable } from "@orbit/server-kit"
import type { Ctx, Deps } from "../../context"
import { saveLocal, verifyLocal, type StorageDriver } from "./storage"

const TICKET_TTL_SEC = 15 * 60
/** Upload limits: images ≤ 1 MB (banner checks ask for ≤ 150 KB; full-screen art is larger), video ≤ 50 MB. */
export const MAX_BYTES: Record<string, number> = { image: 1_000_000, video: 50_000_000 }
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" }

export function safeFileName(name: string, mime: string): string {
  const ext = EXT[mime]
  const base = name.replace(/\.[^.]*$/, "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "asset"
  return `${base}.${ext}`
}

/** Magic-byte sniffing: the declared type must match the content (no polyglots, no HTML). */
export function sniff(buf: Buffer): string | null {
  if (buf.length < 12) return null
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif"
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp"
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") return "video/mp4"
  if (buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm"
  return null
}

interface Ticket {
  key: string
  mime: string
  bytes: number
  userId: string
}

export function uploadsService(deps: Pick<Deps, "env" | "redis" | "now">, driver: StorageDriver) {
  const tkey = (id: string) => `${deps.env.REDIS_PREFIX}upload:${id}`
  return {
    async createTicket(ctx: Ctx, input: { fileName: string; mime: string; bytes: number }) {
      const kind = input.mime.split("/")[0]
      const max = MAX_BYTES[kind] ?? 0
      if (input.bytes > max) throw unprocessable(`${kind === "video" ? "Videos" : "Images"} can be at most ${max / 1_000_000} MB.`, [{ path: "bytes", message: `Max ${max} bytes` }])
      const uploadId = newId("upload")
      const key = `${uploadId}/${safeFileName(input.fileName, input.mime)}`
      const expiresAt = new Date(deps.now().getTime() + TICKET_TTL_SEC * 1000)
      const put = await driver.presign(key, input.mime, input.bytes, expiresAt)
      await deps.redis.set(tkey(uploadId), JSON.stringify({ key, mime: input.mime, bytes: input.bytes, userId: ctx.actor.id } satisfies Ticket), "EX", TICKET_TTL_SEC)
      return { uploadId, method: "PUT" as const, url: put.url, headers: put.headers, publicUrl: driver.publicUrl(key), expiresAt: expiresAt.toISOString() }
    },

    /** Local driver only: receive the raw body of a signed PUT. */
    async receiveLocal(uploadId: string, q: { exp?: string; sig?: string }, contentType: string | undefined, body: Buffer) {
      const exp = Number(q.exp)
      if (!q.sig || !Number.isFinite(exp) || !verifyLocal(deps.env.SESSION_SECRET, uploadId, exp, q.sig)) throw forbidden("The upload link is invalid.")
      if (exp * 1000 < deps.now().getTime()) throw forbidden("The upload link has expired. Request a new one.")
      const raw = await deps.redis.get(tkey(uploadId))
      if (!raw) throw notFound("Upload")
      const t = JSON.parse(raw) as Ticket
      if ((contentType ?? "").split(";")[0].trim() !== t.mime) throw badRequest(`Send the file with Content-Type: ${t.mime}.`)
      if (!body.length) throw badRequest("The upload is empty.")
      if (body.length > t.bytes) throw new HttpError(413, "too_large", "The file is larger than the size you requested the upload for.")
      if (sniff(body) !== t.mime) throw unprocessable("The file content doesn’t match its type.")
      await deps.redis.del(tkey(uploadId))
      await saveLocal(deps.env, t.key, body)
      return { ok: true, publicUrl: `${deps.env.CDN_BASE_URL.replace(/\/$/, "")}/${t.key}`, bytes: body.length }
    },
  }
}
export type UploadsService = ReturnType<typeof uploadsService>
