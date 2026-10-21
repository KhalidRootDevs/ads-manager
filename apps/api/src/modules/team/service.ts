/** Team members and roles (Settings → Team). Ported from the prototype store (inviteMember, changeRole, removeMember). */
import { canAssignRole, newId, ROLE_LABEL, type Role, type User } from "@orbit/domain"
import { conflict, forbidden, notFound } from "@orbit/server-kit"
import type { ClientSession } from "mongoose"
import type { SessionsRepo } from "../../auth/repo"
import type { Ctx, Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import { userDto } from "../../lib/dto"
import { isDuplicate } from "../../lib/mongo"
import type { UsersRepo } from "./repo"

/** "priya.menon@x" → "Priya Menon" */
export const nameFromEmail = (email: string) =>
  email.split("@")[0].split(/[._-]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || email

export function teamService(deps: Pick<Deps, "db" | "now">, users: UsersRepo, sessions: SessionsRepo, audit: AuditWriter) {
  const tx = <T>(fn: (s: ClientSession) => Promise<T>) => deps.db.primary.transaction(fn)
  const target = (u: { _id: string; name: string }) => ({ type: "user", id: u._id, name: u.name })

  async function loadOther(ctx: Ctx, id: string) {
    const u = await users.byId(id)
    if (!u || u.status === "disabled") throw notFound("Member")
    if (u._id === ctx.actor.id) throw forbidden("You can’t change your own membership. Ask another admin.")
    if (u.role === "owner" && ctx.actor.role !== "owner") throw forbidden("Only an owner can change another owner.")
    return u
  }

  return {
    list: async (): Promise<{ items: User[] }> => ({ items: (await users.listVisible()).map(userDto) }),

    async invite(ctx: Ctx, input: { email: string; role: Role; name?: string }): Promise<User> {
      if (!canAssignRole(ctx.actor.role, input.role)) throw forbidden("Only an owner can invite another owner.")
      const existing = await users.byEmail(input.email)
      if (existing && existing.status !== "disabled") throw conflict(existing.status === "invited" ? "This person already has a pending invite." : "This person is already on the team.", userDto(existing), "duplicate")
      const name = input.name?.trim() || nameFromEmail(input.email)
      return tx(async (s) => {
        let u
        if (existing) {
          u = await users.update(existing._id, existing.rev, { $set: { status: "invited", role: input.role, name, invitedBy: ctx.actor.id } }, s)
          if (!u) throw conflict("This member changed while you were inviting them. Reload and try again.")
        } else {
          try {
            u = await users.insert({ _id: newId("user"), email: input.email, name, role: input.role, status: "invited", invitedBy: ctx.actor.id, lastActiveAt: null, rev: 0 }, s)
          } catch (e) {
            if (isDuplicate(e)) throw conflict("This person is already on the team.", undefined, "duplicate")
            throw e
          }
        }
        await audit(ctx, { action: "member.invited", target: { type: "user", id: u!._id, name: input.email }, detail: `Invited as ${ROLE_LABEL[input.role]}` }, s)
        return userDto(u!)
      })
    },

    async changeRole(ctx: Ctx, id: string, input: { role: Role; rev: number }): Promise<User> {
      const u = await loadOther(ctx, id)
      if (!canAssignRole(ctx.actor.role, input.role)) throw forbidden("Only an owner can grant the owner role.")
      if (u.role === input.role) return userDto(u)
      return tx(async (s) => {
        if (u.role === "owner" && u.status === "active" && (await users.countActiveOwners(s)) <= 1) throw conflict("The workspace needs at least one owner. Make someone else an owner first.")
        const updated = await users.update(id, input.rev, { $set: { role: input.role } }, s)
        if (!updated) throw conflict("This member was changed by someone else. Review the latest version.", userDto((await users.byId(id, s))!))
        await audit(ctx, { action: "role.changed", target: target(u), detail: `${ROLE_LABEL[u.role as Role]} → ${ROLE_LABEL[input.role]}`, diff: { role: [u.role, input.role] } }, s)
        return userDto(updated)
      })
    },

    /** Remove = status disabled + sign out everywhere. Cancelling an invite works the same way. */
    async remove(ctx: Ctx, id: string) {
      const u = await loadOther(ctx, id)
      await tx(async (s) => {
        if (u.role === "owner" && u.status === "active" && (await users.countActiveOwners(s)) <= 1) throw conflict("The workspace needs at least one owner.")
        const updated = await users.update(id, u.rev, { $set: { status: "disabled" } }, s)
        if (!updated) throw conflict("This member was changed by someone else. Reload and try again.")
        await sessions.removeForUser(id, s)
        await audit(ctx, { action: u.status === "invited" ? "member.invite_cancelled" : "member.removed", target: target(u), detail: ROLE_LABEL[u.role as Role] }, s)
      })
      return { ok: true as const }
    },
  }
}
export type TeamService = ReturnType<typeof teamService>
