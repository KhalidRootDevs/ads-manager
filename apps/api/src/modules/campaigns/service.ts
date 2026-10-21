/**
 * Campaigns (§6.4, §6.7, §6.9): drafts, validation (the wizard's Review step), the publish transaction
 * (campaign + campaign_revisions + audit_log), lifecycle transitions and the targeting matrix.
 * Every rule comes from `@orbit/domain` (validateCampaign, publishedStatus, teamBudgetLeft, campaignHealth, matrixState).
 */
import {
  availSet, CAMPAIGN_STATUSES, campaignHealth, CAMPAIGN_STATUS_LABEL, can, matrixState, newId, publishedStatus, quarterOf, teamBudgetLeft, todayKey, validateCampaign,
  type Campaign, type CampaignInput, type CampaignListItem, type CampaignPatch, type CampaignRevision, type CampaignStatus, type ValidationCtx, type ValidationResult,
} from "@orbit/domain"
import { badRequest, conflict, forbidden, notFound, unprocessable } from "@orbit/server-kit"
import type { ClientSession } from "mongoose"
import type { Ctx, Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import { decodeCursor, encodeCursor } from "../../lib/cursor"
import { campaignDocFields, campaignDto, campaignInputOf, countryDto, creativeDto, placementDto, propertyDto, revisionDto, statsDto } from "../../lib/dto"
import { isDuplicate } from "../../lib/mongo"
import type { Lean } from "../../lib/types"
import { campaignDiff } from "./diff"
import type { CampaignsRepo } from "./repo"

const NAME_TAKEN = "Another campaign already uses this name."
const DEFAULT_STATUSES = CAMPAIGN_STATUSES.filter((s) => s !== "archived")
const uniq = <T>(xs: T[]) => [...new Set(xs)]

export function campaignsService(deps: Pick<Deps, "db" | "now">, repo: CampaignsRepo, audit: AuditWriter) {
  const tx = <T>(fn: (s: ClientSession) => Promise<T>) => deps.db.primary.transaction(fn)
  const target = (c: { id: string; name: string }) => ({ type: "campaign", id: c.id, name: c.name })

  async function load(id: string, session?: ClientSession) {
    const c = await repo.byId(id, session)
    if (!c) throw notFound("Campaign")
    return campaignDto(c)
  }
  async function stale(id: string, session?: ClientSession): Promise<never> {
    throw conflict("This campaign was changed by someone else. Review the latest version before saving.", await load(id, session))
  }
  async function withStats(c: Campaign): Promise<CampaignListItem> {
    return { ...c, stats: statsDto(await repo.statsOne(c.id), deps.now()) }
  }

  /** Everything `validateCampaign` / `campaignHealth` need, read from the database (sequentially inside a transaction). */
  async function validationCtx(input: CampaignInput, excludeId: string | undefined, s?: ClientSession): Promise<ValidationCtx & { names: Record<string, string> }> {
    const props = await repo.properties(uniq(input.targets.map((t) => t.propertyId)), s)
    const pls = await repo.placements(uniq(input.targets.flatMap((t) => t.placementIds)), s)
    const crs = await repo.creatives(uniq(input.creativeIds), s)
    const countries = (await repo.countries(s)).map(countryDto)
    const taken = input.name.trim().length >= 3 && (await repo.nameTaken(input.name, excludeId, s))
    const quarter = quarterOf(todayKey(undefined, deps.now()))
    const budget = await repo.budget(`${input.team}:${quarter}`, s)
    let teamLeftMicros: number | null = null
    if (budget) {
      const live = (await repo.liveForTeam(input.team, s)).map((c) => ({ id: c._id as string, team: c.team as string, status: c.status as CampaignStatus, budget: { amountMicros: Number(c.budget?.amountMicros ?? 0) } }))
      teamLeftMicros = teamBudgetLeft(Number(budget.amountMicros), live, input.team, excludeId).left
    }
    const properties = Object.fromEntries(props.map((p) => [p._id, propertyDto(p)]))
    const placements = Object.fromEntries(pls.map((p) => [p._id, placementDto(p)]))
    const creatives = Object.fromEntries(crs.map((c) => [c._id, creativeDto(c)]))
    const names = Object.fromEntries([...props, ...crs, ...pls].map((x) => [x._id, x.name as string]))
    return { otherNames: taken ? [input.name.trim()] : [], properties, placements, creatives, countries, teamLeftMicros, today: todayKey(input.flight.tz, deps.now()), names }
  }

  /** rev-guarded status change + audit. */
  async function transition(ctx: Ctx, id: string, rev: number, from: CampaignStatus[], update: (c: Campaign) => Lean, action: string, verb: string) {
    const c = await load(id)
    if (!from.includes(c.status)) throw conflict(`A ${CAMPAIGN_STATUS_LABEL[c.status].toLowerCase()} campaign can’t be ${verb}.`, c)
    try {
      return await tx(async (s) => {
        const updated = await repo.update(id, rev, update(c), s)
        if (!updated) return stale(id, s)
        const after = campaignDto(updated)
        await audit(ctx, { action, target: target(after), detail: `${CAMPAIGN_STATUS_LABEL[c.status]} → ${CAMPAIGN_STATUS_LABEL[after.status]}` }, s)
        return after
      })
    } catch (e) {
      if (isDuplicate(e)) throw conflict(`${NAME_TAKEN} Rename that campaign (or this one, after restoring under a new name) first.`, undefined, "duplicate")
      throw e
    }
  }

  function checkTargetingPermission(ctx: Ctx, before: Campaign | null, patch: Partial<CampaignInput>) {
    if (!patch.targets || can(ctx.actor.role, "campaigns.targeting")) return
    const rules = (ts: Campaign["targets"]) => JSON.stringify(ts.map((t) => [t.propertyId, t.countryRule]))
    if (!before || rules(before.targets) !== rules(patch.targets)) throw forbidden("Your role can’t change country targeting.")
  }

  return {
    async list(q: { cursor?: string; limit: number; status?: CampaignStatus | CampaignStatus[]; propertyId?: string; creativeId?: string; q?: string }) {
      const statuses = q.status ? (Array.isArray(q.status) ? q.status : [q.status]) : DEFAULT_STATUSES
      const cur = decodeCursor(q.cursor, 2)
      const cursor = cur ? { updatedAt: new Date(cur[0]), id: cur[1] } : null
      if (cursor && Number.isNaN(cursor.updatedAt.getTime())) throw badRequest("The cursor is invalid or expired.")
      const rows = (await repo.list({ statuses, cursor, propertyId: q.propertyId, creativeId: q.creativeId, q: q.q?.trim() || undefined, limit: q.limit }))
        .filter((r) => !cursor || r.updatedAt.getTime() < cursor.updatedAt.getTime() || r._id < cursor.id)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a._id < b._id ? 1 : -1))
      const page = rows.slice(0, q.limit)
      const stats = new Map((await repo.stats(page.map((r) => r._id))).map((s) => [s._id, s]))
      const now = deps.now()
      const last = page[page.length - 1]
      return {
        items: page.map((r) => ({ ...campaignDto(r), stats: statsDto(stats.get(r._id), now) })),
        nextCursor: rows.length > q.limit && last ? encodeCursor([last.updatedAt.toISOString(), last._id]) : null,
      }
    },

    async counts() {
      const [rows, needsAttention] = await Promise.all([repo.countsByStatus(), repo.countNeedsAttention()])
      const counts: Record<string, number> = Object.fromEntries(CAMPAIGN_STATUSES.map((s) => [s, 0]))
      for (const r of rows) counts[r._id] = r.n
      return { counts, needsAttention }
    },

    get: async (id: string) => withStats(await load(id)),

    async create(ctx: Ctx, input: CampaignInput): Promise<Campaign> {
      if (!input.name.trim()) throw badRequest("Give the campaign a name.", [{ path: "name", message: "Required" }])
      checkTargetingPermission(ctx, null, input.targets.length ? input : {})
      try {
        return await tx(async (s) => {
          const doc = {
            _id: newId("campaign"), ...campaignDocFields(input), status: "draft", health: { issues: [], checkedAt: null }, ownerId: ctx.actor.id,
            live: true, publishedRev: null, publishedAt: null, archivedAt: null, createdBy: ctx.actor.id, rev: 0,
          }
          const c = campaignDto((await repo.insert(doc, s))!)
          await audit(ctx, { action: "campaign.created", target: target(c), detail: `Draft · ${c.targets.length} propert${c.targets.length === 1 ? "y" : "ies"}` }, s)
          return c
        })
      } catch (e) {
        if (isDuplicate(e)) throw conflict(NAME_TAKEN, undefined, "duplicate")
        throw e
      }
    },

    /** Edits keep the status: changes to a live campaign go live on the next publish. */
    async patch(ctx: Ctx, id: string, input: CampaignPatch): Promise<Campaign> {
      const before = await load(id)
      if (before.status === "archived") throw conflict("Restore this campaign before editing it.", before)
      const { rev, ...fields } = input
      if (fields.name !== undefined && !fields.name.trim()) throw badRequest("Give the campaign a name.", [{ path: "name", message: "Required" }])
      checkTargetingPermission(ctx, before, fields)
      try {
        return await tx(async (s) => {
          const updated = await repo.update(id, rev, { $set: campaignDocFields(fields) }, s)
          if (!updated) return stale(id, s)
          const after = campaignDto(updated)
          await audit(ctx, { action: "campaign.updated", target: target(after), detail: campaignDiff(before, after).join("; ") }, s)
          return after
        })
      } catch (e) {
        if (isDuplicate(e)) throw conflict(NAME_TAKEN, undefined, "duplicate")
        throw e
      }
    },

    async validate(id: string): Promise<ValidationResult> {
      const input = campaignInputOf(await load(id))
      return validateCampaign(input, await validationCtx(input, id))
    },
    async validateDraft(body: CampaignInput & { id?: string }): Promise<ValidationResult> {
      const { id, ...input } = body
      return validateCampaign(input, await validationCtx(input, id))
    },

    /** Validate → set status/health → revision with a diff → audit, in one transaction (§6.7, §6.9). */
    publish: (ctx: Ctx, id: string, rev: number): Promise<Campaign> =>
      tx(async (s) => {
        const before = await load(id, s)
        if (before.rev !== rev) return stale(id, s)
        if (before.status === "archived" || before.status === "completed") throw conflict(`A ${CAMPAIGN_STATUS_LABEL[before.status].toLowerCase()} campaign can’t be published.`, before)
        const input = campaignInputOf(before)
        const vctx = await validationCtx(input, id, s)
        const result = validateCampaign(input, vctx)
        if (result.errors.length)
          throw unprocessable(`Fix ${result.errors.length} issue${result.errors.length === 1 ? "" : "s"} before publishing.`, result.errors.map((e) => ({ path: e.key ?? `step${e.step}`, message: e.message })))
        const now = deps.now()
        const status = publishedStatus(before.flight, now)
        const spent = Number((await repo.statsOne(id, s))?.lifetime?.costMicros ?? 0)
        const issues = campaignHealth(before, vctx, spent)
        const updated = await repo.update(id, rev, { $set: { status, publishedRev: rev + 1, publishedAt: now, health: { issues, checkedAt: now } } }, s)
        if (!updated) return stale(id, s)
        const after = campaignDto(updated)
        const prev = await repo.latestRevision(id, s)
        const diff = campaignDiff((prev?.snapshot as Campaign | undefined) ?? null, after, vctx.names)
        await repo.insertRevision({ _id: `${id}:${after.rev}`, campaignId: id, rev: after.rev, snapshot: after, publishedBy: ctx.actor.id, publishedByName: ctx.actor.name, at: now, diff }, s)
        await audit(ctx, { action: status === "scheduled" ? "campaign.scheduled" : "campaign.published", target: target(after), detail: diff.join("; ") }, s)
        return after
      }),

    pause: (ctx: Ctx, id: string, rev: number) => transition(ctx, id, rev, ["active", "scheduled"], () => ({ $set: { status: "paused" } }), "campaign.paused", "paused"),
    async resume(ctx: Ctx, id: string, rev: number) {
      const c = await load(id)
      if (c.status === "paused" && c.flight.end < todayKey(c.flight.tz, deps.now())) throw conflict("The flight has ended. Extend the end date and publish again.", c)
      return transition(ctx, id, rev, ["paused"], (x) => ({ $set: { status: publishedStatus(x.flight, deps.now()) } }), "campaign.resumed", "resumed")
    },
    /** Archive frees the name: `live` is removed, so the partial unique index no longer holds it. */
    archive: (ctx: Ctx, id: string, rev: number) =>
      transition(ctx, id, rev, ["draft", "scheduled", "active", "paused", "completed"], () => ({ $set: { status: "archived", archivedAt: deps.now() }, $unset: { live: 1 } }), "campaign.archived", "archived"),
    restore: (ctx: Ctx, id: string, rev: number) =>
      transition(ctx, id, rev, ["archived"], () => ({ $set: { status: "draft", live: true, archivedAt: null } }), "campaign.restored", "restored"),

    async duplicate(ctx: Ctx, id: string): Promise<Campaign> {
      const src = await load(id)
      for (let i = 1; i <= 10; i++) {
        const name = `${src.name} (copy${i > 1 ? ` ${i}` : ""})`.slice(0, 120)
        try {
          return await tx(async (s) => {
            const doc = {
              _id: newId("campaign"), ...campaignDocFields({ ...campaignInputOf(src), name }), status: "draft", health: { issues: [], checkedAt: null }, ownerId: ctx.actor.id, live: true,
              publishedRev: null, publishedAt: null, archivedAt: null, createdBy: ctx.actor.id, rev: 0,
            }
            const c = campaignDto((await repo.insert(doc, s))!)
            await audit(ctx, { action: "campaign.duplicated", target: target(c), detail: `Copied from “${src.name}” as a draft` }, s)
            return c
          })
        } catch (e) {
          if (!isDuplicate(e)) throw e
        }
      }
      throw conflict(NAME_TAKEN, undefined, "duplicate")
    },

    async revisions(id: string): Promise<{ items: CampaignRevision[] }> {
      await load(id)
      return { items: (await repo.revisions(id)).map(revisionDto) }
    },

    /** Property × country cells for every target, over the countries each target names plus each property's availability. */
    async targetingMatrix(id: string) {
      const c = await load(id)
      const props = Object.fromEntries((await repo.properties(c.targets.map((t) => t.propertyId))).map((p) => [p._id, propertyDto(p)]))
      const countries = (await repo.countries()).map(countryDto)
      const codes = new Set<string>()
      for (const t of c.targets) {
        const p = props[t.propertyId]
        if (!p) continue
        for (const cc of t.countryRule.countries) codes.add(cc)
        for (const cc of availSet(p.countryRule, countries)) codes.add(cc)
      }
      const list = [...codes].sort()
      const cells = c.targets.flatMap((t) => {
        const p = props[t.propertyId]
        return p ? list.map((country) => ({ propertyId: t.propertyId, country, state: matrixState(country, t.countryRule, p.countryRule, countries) })) : []
      })
      return { countries: list, cells }
    },
  }
}
export type CampaignsService = ReturnType<typeof campaignsService>
