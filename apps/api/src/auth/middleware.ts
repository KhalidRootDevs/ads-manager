import { can, type Permission } from "@orbit/domain"
import { forbidden, unauthorized } from "@orbit/server-kit"
import type { RequestHandler } from "express"
import type { Deps } from "../context"
import type { UsersRepo } from "../modules/team/repo"
import { COOKIE, type SessionService } from "./sessions"

const TOUCH_EVERY_MS = 5 * 60_000

/** Attach `req.actor` / `req.session` when the cookie carries a valid session of an active user. Never rejects. */
export function loadSession(deps: Pick<Deps, "now" | "log">, sessions: SessionService, users: UsersRepo): RequestHandler {
  return async (req, _res, next) => {
    const token = req.cookies?.[COOKIE] as string | undefined
    if (!token || token.length > 100) return next()
    const s = await sessions.resolve(token)
    if (!s) return next()
    const user = await users.byId(s.userId)
    if (!user || user.status !== "active") return next()
    req.session = s
    req.actor = { id: user._id, name: user.name, email: user.email, role: user.role }
    const now = deps.now()
    if (!user.lastActiveAt || now.getTime() - new Date(user.lastActiveAt).getTime() > TOUCH_EVERY_MS) {
      users.touch(user._id, now).catch((err: unknown) => deps.log.warn({ err }, "lastActiveAt update failed"))
    }
    next()
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => next(req.actor ? undefined : unauthorized())

export const requirePermission =
  (perm: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!req.actor) return next(unauthorized())
    next(can(req.actor.role, perm) ? undefined : forbidden())
  }
