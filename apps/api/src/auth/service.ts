import { permissionsOf, type Me } from "@orbit/domain"
import { notFound, unauthorized } from "@orbit/server-kit"
import type { Ctx, Deps } from "../context"
import type { AuditWriter } from "../lib/audit"
import { userDto } from "../lib/dto"
import type { Lean } from "../lib/types"
import type { UsersRepo } from "../modules/team/repo"
import type { SessionService } from "./sessions"

export function authService(deps: Pick<Deps, "env" | "now">, users: UsersRepo, sessions: SessionService, audit: AuditWriter) {
  const meOf = (u: Lean): Me => ({ user: userDto(u), permissions: permissionsOf(u.role) })

  /** Sign an existing active or invited user in (an invite is accepted on first sign-in). */
  async function signIn(email: string, meta: { ip: string | null; ua: string | null; requestId: string }, how: string) {
    let u = await users.byEmail(email)
    if (!u || u.status === "disabled") throw unauthorized("There is no Orbit account for this email. Ask an admin to invite you.")
    if (u.status === "invited") {
      u = (await users.update(u._id, u.rev, { $set: { status: "active", lastActiveAt: deps.now() } })) ?? u
      const ctx: Ctx = { actor: { id: u._id, name: u.name, email: u.email, role: u.role }, ip: meta.ip, requestId: meta.requestId }
      await audit(ctx, { action: "member.joined", target: { type: "user", id: u._id, name: u.name }, detail: `Accepted the invite (${how})` })
    }
    const token = await sessions.create(u._id, meta.ip, meta.ua)
    return { token, me: meOf(u) }
  }

  return {
    devLoginEnabled: () => deps.env.AUTH_DEV_LOGIN && deps.env.NODE_ENV !== "production",
    async devLogin(email: string, meta: { ip: string | null; ua: string | null; requestId: string }) {
      if (!(deps.env.AUTH_DEV_LOGIN && deps.env.NODE_ENV !== "production")) throw notFound("Route")
      return signIn(email, meta, "development sign-in")
    },
    signIn,
    async me(userId: string) {
      const u = await users.byId(userId)
      if (!u || u.status !== "active") throw unauthorized()
      return meOf(u)
    },
    logout: (sessionId: string) => sessions.destroy(sessionId),
    users,
  }
}
export type AuthService = ReturnType<typeof authService>
