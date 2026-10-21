/** Opaque cursors for cursor pagination (§7.1). */
import { badRequest } from "@orbit/server-kit"

export function encodeCursor(parts: (string | number)[]): string {
  return Buffer.from(parts.join("|"), "utf8").toString("base64url")
}

export function decodeCursor(cursor: string | undefined, n: number): string[] | null {
  if (!cursor) return null
  const parts = Buffer.from(cursor, "base64url").toString("utf8").split("|")
  if (parts.length !== n || parts.some((x) => !x || x.length > 100)) throw badRequest("The cursor is invalid or expired.")
  return parts
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
/** Smallest ULID-based id with the given prefix at time `ms`: lets `_id` ranges stand in for time ranges. */
export function idAtTime(prefix: string, ms: number): string {
  let t = Math.max(0, Math.floor(ms))
  let out = ""
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32] + out
    t = Math.floor(t / 32)
  }
  return `${prefix}_${out}${"0".repeat(16)}`
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
