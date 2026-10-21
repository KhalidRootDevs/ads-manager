import type { endpoints } from "@orbit/domain"
import { truncateIp } from "@orbit/domain/node"
import { unauthorized, type Handler } from "@orbit/server-kit"
import type { AuthService } from "./service"
import type { SessionService } from "./sessions"

type E = typeof endpoints

export function authController(svc: AuthService, sessions: SessionService) {
  return {
    me: (async ({ req }) => {
      if (!req.actor) throw unauthorized()
      return svc.me(req.actor.id)
    }) satisfies Handler<E["me"]>,
    devLogin: (async ({ req, body }) => {
      const { token, me } = await svc.devLogin(body.email, { ip: req.ip ? truncateIp(req.ip) : null, ua: req.header("user-agent") ?? null, requestId: String(req.id) })
      sessions.setCookie(req.res!, token)
      return me
    }) satisfies Handler<E["devLogin"]>,
    logout: (async ({ req }) => {
      if (req.session) await svc.logout(req.session.id)
      sessions.clearCookie(req.res!)
      return { ok: true as const }
    }) satisfies Handler<E["logout"]>,
  }
}
