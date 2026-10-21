/**
 * Database sessions (§9): an opaque random token in the `orbit_sid` cookie; only its SHA-256 is stored.
 * Idle timeout 12 h (sliding), absolute lifetime 7 days, revocable server-side.
 */
import { randomBytes } from "node:crypto"
import type { Response } from "express"
import type { Deps } from "../context"
import { sha256 } from "../lib/json"
import type { SessionsRepo } from "./repo"

export const COOKIE = "orbit_sid"
export const IDLE_MS = 12 * 3600_000
export const ABSOLUTE_MS = 7 * 24 * 3600_000
/** Extend the idle window at most every 5 minutes (avoid one write per request). */
const SLIDE_EVERY_MS = 5 * 60_000

export function sessionService(deps: Pick<Deps, "env" | "now">, repo: SessionsRepo) {
  const cookieOpts = () => ({
    httpOnly: true, sameSite: "lax" as const, secure: deps.env.NODE_ENV === "production", path: "/", maxAge: ABSOLUTE_MS,
  })
  return {
    async create(userId: string, ip: string | null, ua: string | null) {
      const token = randomBytes(32).toString("base64url")
      const now = deps.now().getTime()
      const absoluteExpiresAt = new Date(now + ABSOLUTE_MS)
      const expiresAt = new Date(Math.min(now + IDLE_MS, absoluteExpiresAt.getTime()))
      await repo.insert({ _id: sha256(token), userId, expiresAt, absoluteExpiresAt, ip, ua: ua?.slice(0, 200) ?? null })
      return token
    },
    /** Valid session for a token, sliding its idle expiry; null when missing or expired. */
    async resolve(token: string) {
      const id = sha256(token)
      const s = await repo.byId(id)
      const now = deps.now().getTime()
      if (!s || s.expiresAt.getTime() <= now || s.absoluteExpiresAt.getTime() <= now) return null
      const next = Math.min(now + IDLE_MS, s.absoluteExpiresAt.getTime())
      if (next - s.expiresAt.getTime() > SLIDE_EVERY_MS) {
        s.expiresAt = new Date(next)
        await repo.slide(id, s.expiresAt)
      }
      return { id, userId: s.userId as string, expiresAt: s.expiresAt as Date, absoluteExpiresAt: s.absoluteExpiresAt as Date }
    },
    destroy: (id: string) => repo.remove(id),
    setCookie: (res: Response, token: string) => res.cookie(COOKIE, token, cookieOpts()),
    clearCookie: (res: Response) => res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined }),
  }
}
export type SessionService = ReturnType<typeof sessionService>
