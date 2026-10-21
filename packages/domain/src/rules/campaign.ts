/**
 * Campaign validation (the wizard's Review step and `POST /v1/campaigns/:id/validate` / publish),
 * team budgets and pacing. Ported from the prototype's wizard-state.ts and sim.ts.
 */
import { LIVE_CAMPAIGN_STATUSES, type CampaignStatus } from "../enums"
import { fromMicros } from "../money"
import type { CampaignInput, Creative, Placement, Property, ValidationIssue, ValidationResult } from "../schemas"
import { addDays, dayStart, daysBetween, todayKey } from "../time"
import { compat, conflictsFor, type CountryLike } from "./targeting"

/** Wizard steps; issues reference them by number. */
export const CAMPAIGN_STEPS = ["Basics", "Creatives", "Properties", "Countries", "Placements", "Constraints", "Budget", "Review"] as const

export interface ValidationCtx {
  /** Other campaigns, for the unique-name check (only live ones occupy names). */
  otherNames: string[]
  properties: Record<string, Pick<Property, "id" | "name" | "platform" | "countryRule" | "status" | "sdk">>
  placements: Record<string, Pick<Placement, "id" | "propertyId" | "format" | "size" | "status">>
  creatives: Record<string, Pick<Creative, "id" | "name" | "format" | "size" | "status">>
  countries: CountryLike[]
  /** Remaining team budget in micros (team quarter budget minus other live campaigns), or null if unknown. */
  teamLeftMicros: number | null
  today?: string
}

const WEB_URL = /^https:\/\/[^\s/]+\.[^\s]+$/
const DEEP_LINK = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i

export function validateCampaign(c: CampaignInput, ctx: ValidationCtx): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const err = (step: number, message: string, key: string | null = null) => errors.push({ step, key, message })
  const warn = (step: number, message: string, key: string | null = null) => warnings.push({ step, key, message })
  const today = ctx.today ?? todayKey(c.flight.tz)

  // 1 Basics
  const name = c.name.trim()
  if (name.length < 3) err(1, "Enter a campaign name of at least 3 characters.", "name")
  else if (ctx.otherNames.some((n) => n.trim().toLowerCase() === name.toLowerCase())) err(1, "Another campaign already uses this name.", "name")
  if (!c.flight.start) err(1, "Choose a start date.", "start")
  if (!c.flight.end) err(1, "Choose an end date.", "end")
  else if (c.flight.start && c.flight.end < c.flight.start) err(1, "End date must be on or after the start date.", "end")
  else if (c.flight.end < today) err(1, "End date is in the past.", "end")

  // 2 Creatives
  if (!c.creativeIds.length) err(2, "Select at least one creative.", "creatives")
  for (const id of c.creativeIds) {
    const cr = ctx.creatives[id]
    if (!cr) err(2, "A selected creative no longer exists.", "creatives")
    else if (cr.status !== "ready") warn(2, `${cr.name} is ${cr.status.replace("_", " ")}; it won’t serve until it is ready.`, id)
  }

  // 3 Properties
  if (!c.targets.length) err(3, "Select at least one app or website.", "props")
  for (const t of c.targets) {
    const p = ctx.properties[t.propertyId]
    if (!p) { err(3, "A selected property no longer exists.", t.propertyId); continue }
    if (p.sdk.state === "not_integrated") warn(3, `${p.name} has no SDK integration yet, so it can’t request ads.`, p.id)
    if (p.sdk.state === "heartbeat_missing") warn(3, `${p.name} hasn’t sent an SDK heartbeat recently.`, p.id)
    if (p.status === "paused") warn(3, `${p.name} is paused, so it won’t serve until it is activated.`, p.id)
  }

  // 4 Countries
  for (const t of c.targets) {
    const p = ctx.properties[t.propertyId]
    if (!p) continue
    if (t.countryRule.mode === "include" && !t.countryRule.countries.length) err(4, `${p.name}: add at least one country to include.`, p.id)
    if (t.countryRule.mode === "exclude" && !t.countryRule.countries.length) warn(4, `${p.name}: Exclude is selected with no countries, so it serves everywhere available.`, p.id)
  }
  const conflicts = conflictsFor(c.targets, ctx.properties as never, ctx.countries)
  const byProp = new Map<string, string[]>()
  for (const x of conflicts) byProp.set(x.propertyName, [...(byProp.get(x.propertyName) ?? []), x.countryName])
  for (const [prop, names] of byProp) warn(4, `${prop}: ${names.join(", ")} won’t serve (not in the property’s country defaults).`)

  // 5 Placements
  const creatives = c.creativeIds.map((id) => ctx.creatives[id]).filter(Boolean)
  for (const t of c.targets) {
    const p = ctx.properties[t.propertyId]
    if (!p) continue
    if (!t.placementIds.length) { err(5, `${p.name}: select at least one compatible placement.`, p.id); continue }
    for (const plId of t.placementIds) {
      const pl = ctx.placements[plId]
      if (!pl || pl.propertyId !== p.id) err(5, `${p.name}: a selected placement doesn’t belong to this property.`, p.id)
      else if (creatives.length && !creatives.some((cr) => compat(cr, pl).ok)) err(5, `${p.name}: no selected creative fits one of the chosen placements.`, p.id)
    }
  }

  // 6 Constraints
  const k = c.constraints
  if (!k.days.length) err(6, "Select at least one day of the week.", "days")
  if (!k.devices.length) err(6, "Select at least one device type.", "devices")
  if (k.hours.to <= k.hours.from) err(6, "Delivery hours must end after they start.", "hours")
  if (k.audienceIds.length) warn(6, "Audience segments are saved but not enforced until the event pipeline ships.")
  for (const t of c.targets) {
    const v = (t.destinationOverride ?? "").trim()
    const p = ctx.properties[t.propertyId]
    if (!v || !p) continue
    const ok = p.platform === "web" ? WEB_URL.test(v) : WEB_URL.test(v) || DEEP_LINK.test(v)
    if (!ok) err(6, `${p.name}: destination must be ${p.platform === "web" ? "an https:// URL" : "an https:// URL or an app deep link (scheme://path)"}.`, `dest-${p.id}`)
  }

  // 7 Budget
  if (!(c.budget.amountMicros > 0)) err(7, "Enter an internal budget greater than $0.", "budget")
  const allocs = c.targets.map((t) => t.allocationPct)
  if (allocs.some((a) => a != null)) {
    const sum = Math.round(allocs.reduce<number>((a, x) => a + (x ?? 0), 0) * 100) / 100
    if (Math.round(sum) !== 100) err(7, `Property allocation must add up to 100% (now ${sum}%).`, "alloc")
  }
  if (ctx.teamLeftMicros != null && c.budget.amountMicros > ctx.teamLeftMicros)
    warn(7, `Budget is above the ${c.team} team’s remaining allocation ($${Math.max(0, fromMicros(ctx.teamLeftMicros)).toLocaleString("en-US")}).`, "budget")

  return { errors, warnings }
}

/** Status a campaign gets when published. */
export function publishedStatus(flight: { start: string; tz: string }, now: Date | number = Date.now()): CampaignStatus {
  return flight.start > todayKey(flight.tz, now) ? "scheduled" : "active"
}

/** Team budget left: quarter budget minus budgets of the team's other live campaigns (micros). */
export function teamBudgetLeft(teamTotalMicros: number, campaigns: { id: string; team: string; status: CampaignStatus; budget: { amountMicros: number } }[], team: string, excludeId?: string) {
  const allocated = campaigns.filter((c) => c.team === team && c.id !== excludeId && LIVE_CAMPAIGN_STATUSES.includes(c.status)).reduce((a, c) => a + c.budget.amountMicros, 0)
  return { total: teamTotalMicros, allocated, left: teamTotalMicros - allocated }
}

export type PacingLabel = "not_started" | "ended" | "paused" | "on_pace" | "behind" | "ahead"

/** Pacing: budget spent vs flight elapsed (DATA_MODEL.md §3). */
export function pacing(c: { status: CampaignStatus; flight: { start: string; end: string; tz: string }; budget: { amountMicros: number } }, spentMicros: number, now: Date | number = Date.now()) {
  const today = todayKey(c.flight.tz, now)
  const total = daysBetween(c.flight.start, c.flight.end) + 1
  const elapsed = Math.max(0, Math.min(1, (daysBetween(c.flight.start, today) + 1) / Math.max(1, total)))
  const budgetPct = c.budget.amountMicros ? spentMicros / c.budget.amountMicros : 0
  const diff = budgetPct - elapsed
  let label: PacingLabel
  if (c.status === "draft" || c.status === "scheduled") label = "not_started"
  else if (c.status === "completed" || c.status === "archived") label = "ended"
  else if (c.status === "paused") label = "paused"
  else label = Math.abs(diff) < 0.08 ? "on_pace" : diff < 0 ? "behind" : "ahead"
  return { elapsed, budgetPct, diff, label, daysLeft: Math.max(0, daysBetween(today, c.flight.end) + 1) }
}

export const PACING_LABEL_TEXT: Record<PacingLabel, string> = { not_started: "Not started", ended: "Ended", paused: "Paused", on_pace: "On pace", behind: "Behind", ahead: "Ahead" }

/** True when the campaign is active but has health issues ("Needs attention" in the UI). */
export function needsAttention(c: { status: CampaignStatus; health: { issues: unknown[] } }) {
  return c.status === "active" && c.health.issues.length > 0
}

/** Even pacing: budget the campaign may spend in the current hour (micros). */
export function hourlyAllowanceMicros(remainingMicros: number, flightEnd: string, tz: string, now: Date | number = Date.now()) {
  const endInstant = dayStart(addDays(flightEnd, 1), tz).getTime()
  const hoursLeft = Math.max(1, Math.ceil((endInstant - new Date(now).getTime()) / 3_600_000))
  return Math.max(0, Math.floor(remainingMicros / hoursLeft))
}
