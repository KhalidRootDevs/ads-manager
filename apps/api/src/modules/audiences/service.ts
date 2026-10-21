import { newId, type Audience } from "@orbit/domain"
import { notFound } from "@orbit/server-kit"
import type { ClientSession } from "mongoose"
import type { Ctx, Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import { audienceDto } from "../../lib/dto"
import type { AudiencesRepo } from "./repo"

interface AudienceCreate {
  name: string
  rule: { event: string; withinDays: number; exclude: { event: string; withinDays: number } | null }
}

export function audiencesService(deps: Pick<Deps, "db">, repo: AudiencesRepo, audit: AuditWriter) {
  const tx = <T>(fn: (s: ClientSession) => Promise<T>) => deps.db.primary.transaction(fn)
  return {
    list: async (): Promise<{ items: Audience[] }> => ({ items: (await repo.list()).map(audienceDto) }),
    create: (ctx: Ctx, input: AudienceCreate): Promise<Audience> =>
      tx(async (s) => {
        const a = await repo.insert({ _id: newId("audience"), name: input.name, rule: input.rule, status: "draft", estimate: null, createdBy: ctx.actor.id, rev: 0 }, s)
        await audit(ctx, { action: "audience.created", target: { type: "audience", id: a!._id, name: input.name }, detail: `Did ${input.rule.event} within ${input.rule.withinDays} days` }, s)
        return audienceDto(a!)
      }),
    /** Delete + `$pull` from every campaign + audit, atomically (§6.9). */
    async remove(ctx: Ctx, id: string) {
      const a = await repo.byId(id)
      if (!a) throw notFound("Audience")
      await tx(async (s) => {
        await repo.remove(id, s)
        const r = await repo.pullFromCampaigns(id, s)
        await audit(ctx, { action: "audience.deleted", target: { type: "audience", id, name: a.name }, detail: r.modifiedCount ? `Removed from ${r.modifiedCount} campaign${r.modifiedCount === 1 ? "" : "s"}` : "" }, s)
      })
      return { ok: true as const }
    },
  }
}
