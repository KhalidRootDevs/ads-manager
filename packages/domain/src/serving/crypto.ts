/**
 * Node-only crypto: signed tracking tokens (§4.2) and SDK key hashing (§9). Import from "@orbit/domain/node".
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export interface TrackingPayload {
  /** request id */
  r: string
  /** campaign, creative, property, placement */
  c: string
  cr: string
  p: string
  pl: string
  /** country, device code (ph|tb|dt), platform code (an|io|wb), format */
  cc: string
  dv: string
  pf: string
  f: string
  /** issued at (epoch seconds) */
  ts: number
  /** internal cost of one impression in micros (eCPM / 1000) */
  cpi: number
  /** hashed uid, when consent allows */
  u?: string
  /** test traffic: excluded from rollups and budgets */
  t?: 1
  /** click id (click tokens only) */
  k?: string
  /** final destination URL / deep link (click tokens only; the collector redirects here) */
  d?: string
}

export interface TrackingSecrets {
  active: string
  secrets: Record<string, string>
}

/** Parse "k1:secret1,k2:secret2" (TRACKING_SECRETS) into a keyring. */
export function parseSecrets(spec: string, activeKid: string): TrackingSecrets {
  const secrets: Record<string, string> = {}
  for (const part of spec.split(",")) {
    const i = part.indexOf(":")
    if (i > 0) secrets[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  if (!secrets[activeKid]) throw new Error(`TRACKING_ACTIVE_KID ${activeKid} has no secret`)
  return { active: activeKid, secrets }
}

const b64url = (b: Buffer) => b.toString("base64url")

/** `kid.base64url(payload).base64url(HMAC-SHA256)` */
export function signToken(payload: TrackingPayload, ring: TrackingSecrets): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)))
  const kid = ring.active
  const mac = createHmac("sha256", ring.secrets[kid]).update(`${kid}.${body}`).digest()
  return `${kid}.${body}.${b64url(mac)}`
}

export type VerifyError = "malformed" | "unknown_kid" | "bad_signature" | "expired"

/** Verify a token and its age. Impression tokens live 24 h, click tokens 7 days. */
export function verifyToken(token: string, ring: TrackingSecrets, maxAgeSec: number, nowSec = Math.floor(Date.now() / 1000)): { ok: true; payload: TrackingPayload } | { ok: false; error: VerifyError } {
  const parts = token.split(".")
  if (parts.length !== 3) return { ok: false, error: "malformed" }
  const [kid, body, sig] = parts
  const secret = ring.secrets[kid]
  if (!secret) return { ok: false, error: "unknown_kid" }
  const expected = createHmac("sha256", secret).update(`${kid}.${body}`).digest()
  let given: Buffer
  try {
    given = Buffer.from(sig, "base64url")
  } catch {
    return { ok: false, error: "malformed" }
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, error: "bad_signature" }
  let payload: TrackingPayload
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  } catch {
    return { ok: false, error: "malformed" }
  }
  if (typeof payload.ts !== "number" || nowSec - payload.ts > maxAgeSec) return { ok: false, error: "expired" }
  return { ok: true, payload }
}

export const IMPRESSION_TOKEN_TTL_SEC = 24 * 3600
export const CLICK_TOKEN_TTL_SEC = 7 * 24 * 3600

// ---------- SDK keys ----------
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** New SDK key: `ok_live_` / `ok_test_` + 32 random bytes in base62. Shown once, never stored in clear. */
export function generateKeySecret(env: "live" | "test"): { secret: string; prefix: string; last4: string } {
  const bytes = randomBytes(32)
  let s = ""
  for (const b of bytes) s += B62[b % 62]
  const prefix = `ok_${env}_`
  const secret = prefix + s
  return { secret, prefix, last4: secret.slice(-4) }
}

/** HMAC-SHA256 with a server pepper. Keys are high-entropy, so a slow hash isn't needed. */
export function hashKeySecret(secret: string, pepper: string): string {
  return createHmac("sha256", pepper).update(secret).digest("hex")
}

/** HMAC signature of a request body with an SDK key secret, as sent in X-Orbit-Sig: `t=<sec>,v1=<hex>`. */
export function signBody(body: string, secret: string, tsSec = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac("sha256", secret).update(`${tsSec}.${body}`).digest("hex")
  return `t=${tsSec},v1=${mac}`
}

/** Hash of an install/cookie uid for frequency caps (never store the raw uid). */
export function hashUid(uid: string, pepper: string): string {
  return createHmac("sha256", pepper).update(uid).digest("base64url").slice(0, 22)
}

/** Truncate an IP for storage and logs: /24 for IPv4, /48 for IPv6 (§9). */
export function truncateIp(ip: string): string {
  const v4 = ip.replace(/^::ffff:/, "")
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.split(".").slice(0, 3).join(".") + ".0/24"
  const parts = ip.split(":").filter(Boolean)
  return parts.slice(0, 3).join(":") + "::/48"
}
