/**
 * Creative library and review workflow (Draft → In Review → Ready / Rejected → Archived), §1 and §6.4.
 * Every content edit writes a `creative_versions` document (`<id>:<v>`) in the same transaction.
 * Format checks come from `@orbit/domain` (`creativeChecks`), the same code the wizard runs.
 */
import { can, CREATIVE_STATUS_LABEL, creativeChecks, newId, SERVABLE_CAMPAIGN_STATUSES, type Creative, type CreativeInput, type CreativePatch, type CreativeVersion } from "@orbit/domain"
import { conflict, notFound, unprocessable } from "@orbit/server-kit"
import type { ClientSession } from "mongoose"
import type { Ctx, Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import { creativeDto, creativeVersionDto } from "../../lib/dto"
import type { Lean } from "../../lib/types"
import type { CreativesRepo } from "./repo"

type Content = Omit<CreativeInput, "intent">
const CONTENT_KEYS = ["name", "format", "size", "assets", "copy", "destination", "altText", "options"] as const

function failingChecks(c: Content) {
  return creativeChecks(c).filter((x) => !x.ok)
}

function requireChecks(c: Content) {
  const failing = failingChecks(c)
  if (failing.length)
    throw unprocessable(`Fix ${failing.length} check${failing.length === 1 ? "" : "s"} before submitting: ${failing.map((x) => x.label).join(", ")}.`, failing.map((x) => ({ path: x.key, message: `${x.label}: ${x.detail}` })))
}

const contentOf = (c: Creative): Content => ({ name: c.name, format: c.format, size: c.size, assets: c.assets, copy: c.copy, destination: c.destination, altText: c.altText, options: c.options })
const snapshotOf = (c: Creative) => {
  const { review: _review, ...rest } = c
  return rest
}

export function creativesService(deps: Pick<Deps, "db" | "now">, repo: CreativesRepo, audit: AuditWriter) {
  const tx = <T>(fn: (s: ClientSession) => Promise<T>) => deps.db.primary.transaction(fn)
  const target = (c: { _id?: string; id?: string; name: string }) => ({ type: "creative", id: (c._id ?? c.id)!, name: c.name })

  /** Status and review after a submit: auto-approved when the actor may approve creatives. */
  const submitted = (ctx: Ctx) =>
    can(ctx.actor.role, "creatives.approve")
      ? { status: "ready", review: { state: "approved", by: ctx.actor.id, at: deps.now(), reason: null } }
      : { status: "in_review", review: { state: "pending", by: null, at: null, reason: null } }
  const drafted = { status: "draft", review: { state: "none", by: null, at: null, reason: null } }

  async function load(id: string, session?: ClientSession) {
    const c = await repo.byId(id, session)
    if (!c) throw notFound("Creative")
    return c
  }
  async function stale(id: string, session?: ClientSession): Promise<never> {
    const cur = await repo.byId(id, session)
    if (!cur) throw notFound("Creative")
    throw conflict("This creative was changed by someone else. Review the latest version.", creativeDto(cur))
  }

  /** rev-guarded status change + audit. */
  async function transition(ctx: Ctx, id: string, rev: number, from: string[], set: Lean, action: string, detail: (c: Lean) => string, wrongState: (c: Lean) => string) {
    const c = await load(id)
    if (!from.includes(c.status)) throw conflict(wrongState(c), creativeDto(c))
    return tx(async (s) => {
      const updated = await repo.update(id, rev, { $set: set }, s)
      if (!updated) return stale(id, s)
      await audit(ctx, { action, target: target(c), detail: detail(c) }, s)
      return creativeDto(updated)
    })
  }

  async function insertWithVersion(ctx: Ctx, doc: Lean, note: string, action: string, detail: string, s: ClientSession) {
    const c = await repo.insert(doc, s)
    const dto = creativeDto(c!)
    await repo.insertVersion({ _id: `${dto.id}:1`, creativeId: dto.id, v: 1, snapshot: snapshotOf(dto), by: ctx.actor.id, byName: ctx.actor.name, note, at: deps.now() }, s)
    await audit(ctx, { action, target: target(dto), detail }, s)
    return dto
  }

  return {
    async list(q: { q?: string; includeArchived?: boolean }): Promise<{ items: Creative[] }> {
      const term = q.q?.trim()
      const rows = term ? await repo.search(term, !!q.includeArchived) : await repo.list(!!q.includeArchived)
      return { items: rows.map(creativeDto) }
    },
    get: async (id: string): Promise<Creative> => creativeDto(await load(id)),

    async create(ctx: Ctx, input: CreativeInput): Promise<Creative> {
      const { intent, ...content } = input
      if (intent === "submit") requireChecks(content)
      const state = intent === "submit" ? submitted(ctx) : drafted
      const doc = { _id: newId("creative"), ...content, ...state, ownerId: ctx.actor.id, currentVersion: 1, rev: 0 }
      const detail = state.status === "ready" ? "Created and approved" : state.status === "in_review" ? "Submitted for review" : "Saved as draft"
      return tx((s) => insertWithVersion(ctx, doc, "Created", "creative.created", detail, s))
    },

    /**
     * Edit → new version. A ready (or in-review) creative keeps its status only while every check still passes;
     * otherwise it drops back to draft so it can't serve broken. `intent: "submit"` submits in the same step.
     */
    async patch(ctx: Ctx, id: string, input: CreativePatch): Promise<Creative> {
      const before = creativeDto(await load(id))
      if (before.status === "archived") throw conflict("Restore this creative before editing it.", before)
      const { rev, note, intent, ...fields } = input
      const merged: Content = { ...contentOf(before), ...fields }
      let state: Lean = {}
      if (intent === "submit") {
        requireChecks(merged)
        state = submitted(ctx)
      } else if ((before.status === "ready" || before.status === "in_review") && failingChecks(merged).length) state = drafted
      const set: Lean = {}
      for (const k of CONTENT_KEYS) if (fields[k] !== undefined) set[k] = fields[k]
      return tx(async (s) => {
        const updated = await repo.update(id, rev, { $set: { ...set, ...state }, $inc: { currentVersion: 1 } }, s)
        if (!updated) return stale(id, s)
        const dto = creativeDto(updated)
        await repo.insertVersion({ _id: `${id}:${dto.currentVersion}`, creativeId: id, v: dto.currentVersion, snapshot: snapshotOf(dto), by: ctx.actor.id, byName: ctx.actor.name, note: note?.trim() || "Edited", at: deps.now() }, s)
        const statusNote = dto.status !== before.status ? ` · ${CREATIVE_STATUS_LABEL[before.status]} → ${CREATIVE_STATUS_LABEL[dto.status]}` : ""
        await audit(ctx, { action: "creative.updated", target: target(dto), detail: `v${dto.currentVersion}${note ? ` · ${note.trim()}` : ""}${statusNote}` }, s)
        return dto
      })
    },

    async submit(ctx: Ctx, id: string, rev: number): Promise<Creative> {
      const c = creativeDto(await load(id))
      if (c.status !== "draft" && c.status !== "rejected") throw conflict(`Only drafts and rejected creatives can be submitted (this one is ${CREATIVE_STATUS_LABEL[c.status].toLowerCase()}).`, c)
      requireChecks(contentOf(c))
      const state = submitted(ctx)
      return transition(ctx, id, rev, ["draft", "rejected"], state, state.status === "ready" ? "creative.approved" : "creative.submitted", () => (state.status === "ready" ? "Submitted and approved" : "Submitted for review"), () => "")
    },
    approve: (ctx: Ctx, id: string, rev: number) =>
      transition(ctx, id, rev, ["in_review"], { status: "ready", review: { state: "approved", by: ctx.actor.id, at: deps.now(), reason: null } }, "creative.approved", () => `Approved by ${ctx.actor.name}`,
        (c) => `Only creatives in review can be approved (this one is ${CREATIVE_STATUS_LABEL[c.status as Creative["status"]].toLowerCase()}).`),
    reject: (ctx: Ctx, id: string, input: { reason: string; rev: number }) =>
      transition(ctx, id, input.rev, ["in_review"], { status: "rejected", review: { state: "rejected", by: ctx.actor.id, at: deps.now(), reason: input.reason } }, "creative.rejected", () => input.reason,
        (c) => `Only creatives in review can be rejected (this one is ${CREATIVE_STATUS_LABEL[c.status as Creative["status"]].toLowerCase()}).`),

    /** Archive is blocked while a scheduled or active campaign uses the creative (it would stop serving). */
    async archive(ctx: Ctx, id: string, rev: number): Promise<Creative> {
      const used = await repo.campaignsUsing(id, SERVABLE_CAMPAIGN_STATUSES)
      if (used.length) {
        const names = used.slice(0, 3).map((c) => `“${c.name}”`).join(", ") + (used.length > 3 ? ` and ${used.length - 3} more` : "")
        throw conflict(`This creative is used by ${used.length} live campaign${used.length === 1 ? "" : "s"} (${names}). Remove it from ${used.length === 1 ? "that campaign" : "those campaigns"} or pause ${used.length === 1 ? "it" : "them"} first.`, creativeDto(await load(id)), "in_use")
      }
      return transition(ctx, id, rev, ["draft", "in_review", "ready", "rejected"], { status: "archived" }, "creative.archived", (c) => `${CREATIVE_STATUS_LABEL[c.status as Creative["status"]]} → Archived`, () => "This creative is already archived.")
    },
    restore: (ctx: Ctx, id: string, rev: number) =>
      transition(ctx, id, rev, ["archived"], { ...drafted }, "creative.restored", () => "Restored as draft", () => "Only archived creatives can be restored."),

    async duplicate(ctx: Ctx, id: string): Promise<Creative> {
      const src = creativeDto(await load(id))
      const doc = { _id: newId("creative"), ...contentOf(src), name: `${src.name} (copy)`.slice(0, 120), ...drafted, ownerId: ctx.actor.id, currentVersion: 1, rev: 0 }
      return tx((s) => insertWithVersion(ctx, doc, `Duplicated from ${src.name}`, "creative.duplicated", `Copied from ${src.name}`, s))
    },

    async versions(id: string): Promise<{ items: CreativeVersion[] }> {
      await load(id)
      return { items: (await repo.versions(id)).map(creativeVersionDto) }
    },
  }
}
export type CreativesService = ReturnType<typeof creativesService>
