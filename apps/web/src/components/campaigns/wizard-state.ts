import {
  addDays, CAMPAIGN_STEPS, compat, fromMicros, toMicros, todayKey, validateCampaign, WEEKDAYS, zVersion,
  type Campaign, type CampaignInput, type CountryMode, type Device, type FreqPeriod, type GoalType, type Objective, type PacingMode, type Priority,
  type ValidationCtx, type ValidationIssue, type ValidationResult, type Weekday,
} from "@orbit/domain"
import type { Index } from "@/lib/hooks"

export const STEPS = CAMPAIGN_STEPS
export const LAST_STEP = STEPS.length

/** Toasts raised inside the wizard sit at the top so they never cover the sticky Back/Continue bar. */
export const WIZ_TOAST = { position: "top-center" } as const

export interface WTarget {
  mode: CountryMode
  countries: string[]
  placementIds: string[]
}

/** Everything the wizard saves. Free-text numbers stay strings while editing. */
export interface WizardForm {
  name: string
  objective: Objective
  start: string
  end: string
  tz: string
  priority: Priority
  creativeIds: string[]
  propIds: string[]
  targets: Record<string, WTarget>
  days: Weekday[]
  hours: { from: number; to: number }
  devices: Device[]
  minOs: string
  freq: string
  freqPer: FreqPeriod
  audiences: string[]
  destOn: boolean
  dest: Record<string, string>
  budget: string
  goalType: GoalType
  goal: string
  pacing: PacingMode
  allocOn: boolean
  alloc: Record<string, string>
}

export const DEFAULT_T: WTarget = { mode: "all", countries: [], placementIds: [] }

export function emptyForm(tz = "Asia/Dhaka"): WizardForm {
  const today = todayKey(tz)
  return {
    name: "", objective: "awareness", start: today, end: addDays(today, 30), tz, priority: 2,
    creativeIds: [], propIds: [], targets: {},
    days: [...WEEKDAYS], hours: { from: 0, to: 24 }, devices: ["phone", "tablet", "desktop"], minOs: "", freq: "6", freqPer: "day",
    audiences: [], destOn: false, dest: {},
    budget: "", goalType: "impressions", goal: "", pacing: "even", allocOn: false, alloc: {},
  }
}

export function formFrom(c: Campaign): WizardForm {
  const k = c.constraints
  return {
    name: c.name, objective: c.objective, start: c.flight.start, end: c.flight.end, tz: c.flight.tz, priority: c.priority,
    creativeIds: [...c.creativeIds],
    propIds: c.targets.map((t) => t.propertyId),
    targets: Object.fromEntries(c.targets.map((t) => [t.propertyId, { mode: t.countryRule.mode, countries: [...t.countryRule.countries], placementIds: [...t.placementIds] }])),
    days: [...k.days], hours: { ...k.hours }, devices: [...k.devices], minOs: k.minAppVersion ?? "",
    freq: k.freqCap ? String(k.freqCap.count) : "", freqPer: k.freqCap?.per ?? "day",
    audiences: [...k.audienceIds],
    destOn: c.targets.some((t) => !!t.destinationOverride),
    dest: Object.fromEntries(c.targets.filter((t) => t.destinationOverride).map((t) => [t.propertyId, t.destinationOverride!])),
    budget: c.budget.amountMicros ? String(fromMicros(c.budget.amountMicros)) : "",
    goalType: c.budget.goal?.type ?? "impressions", goal: c.budget.goal ? String(c.budget.goal.value) : "", pacing: c.budget.pacing,
    allocOn: c.targets.some((t) => t.allocationPct != null),
    alloc: Object.fromEntries(c.targets.filter((t) => t.allocationPct != null).map((t) => [t.propertyId, String(t.allocationPct)])),
  }
}

const num = (s: string) => (s.trim() === "" ? NaN : Number(s))

/** The API payload for the form. Invalid free-text numbers are caught by `inputErrors` before anything is sent. */
export function toInput(f: WizardForm, team: string, plcById: Index["plcById"]): CampaignInput {
  const budget = num(f.budget)
  return {
    name: f.name.trim(),
    objective: f.objective,
    team,
    flight: { start: f.start, end: f.end, tz: f.tz },
    priority: f.priority,
    creativeIds: [...f.creativeIds],
    targets: f.propIds.map((pid) => {
      const t = f.targets[pid] ?? DEFAULT_T
      const dest = (f.dest[pid] ?? "").trim()
      return {
        propertyId: pid,
        countryRule: { mode: t.mode, countries: [...t.countries] },
        // Drop placements that belong to another property (left over after changing selections).
        placementIds: t.placementIds.filter((x) => !plcById[x] || plcById[x].propertyId === pid),
        allocationPct: f.allocOn ? Number(f.alloc[pid]) || 0 : null,
        destinationOverride: f.destOn && dest ? dest : null,
      }
    }),
    constraints: {
      days: [...f.days], hours: { ...f.hours }, devices: [...f.devices],
      minAppVersion: f.minOs.trim() || null,
      freqCap: f.freq.trim() ? { count: Number(f.freq), per: f.freqPer } : null,
      audienceIds: [...f.audiences],
    },
    budget: {
      amountMicros: budget > 0 ? toMicros(budget) : 0,
      pacing: f.pacing,
      goal: f.goal.trim() ? { type: f.goalType, value: Number(f.goal) } : null,
    },
  }
}

export function allocSum(f: WizardForm) {
  // Round away float noise (33.3 + 33.3 + 33.4 = 100.00000000000001).
  return Math.round(f.propIds.reduce((a, pid) => a + (Number(f.alloc[pid]) || 0), 0) * 100) / 100
}

/**
 * Errors in free-text fields that can't be turned into a valid payload (the API would reject the shape).
 * Business rules are NOT here: they come from `validateCampaign` (local) and the API (authoritative).
 */
export function inputErrors(f: WizardForm): ValidationIssue[] {
  const out: ValidationIssue[] = []
  const add = (step: number, key: string, message: string) => out.push({ step, key, message })
  const int = (s: string, max: number) => Number.isInteger(num(s)) && num(s) >= 1 && num(s) <= max
  if (f.freq.trim() && !int(f.freq, 1000)) add(6, "freq", "Frequency cap must be a whole number from 1 to 1,000, or leave it empty.")
  if (f.minOs.trim() && !zVersion.safeParse(f.minOs.trim()).success) add(6, "minos", "Use a version like 6.2.1, or leave it empty.")
  if (f.goal.trim() && !int(f.goal, Number.MAX_SAFE_INTEGER)) add(7, "goal", "Goal must be a positive whole number, or leave it empty.")
  if (f.allocOn && f.propIds.some((pid) => { const v = num(f.alloc[pid] ?? "0"); return (f.alloc[pid] ?? "").trim() !== "" && !(v >= 0 && v <= 100) }))
    add(7, "alloc", "Each property’s share must be between 0% and 100%.")
  return out
}

export type IssuesByStep = Record<number, ValidationIssue[]>

export function byStep(list: ValidationIssue[]): IssuesByStep {
  const e: IssuesByStep = {}
  for (const x of list) (e[x.step] ||= []).push(x)
  return e
}

/** Local (instant) validation: form-input errors + the domain's `validateCampaign`. */
export function localValidation(f: WizardForm, input: CampaignInput, ctx: ValidationCtx): ValidationResult {
  const r = validateCampaign(input, ctx)
  // Domain budget/goal messages assume a parsed number; keep only the input-shape message for a field when both exist.
  const shape = inputErrors(f)
  const shapeKeys = new Set(shape.map((x) => x.key))
  return { errors: [...shape, ...r.errors.filter((x) => !x.key || !shapeKeys.has(x.key))].sort((a, b) => a.step - b.step), warnings: r.warnings }
}

/** Only the top-level keys that changed (PATCH sends these plus `rev`). */
export function changedKeys(before: CampaignInput, after: CampaignInput): Partial<CampaignInput> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(after) as (keyof CampaignInput)[]) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = after[k]
  }
  return out as Partial<CampaignInput>
}

/**
 * The prototype's example campaign, mapped to real ids by name. Missing entities are skipped and reported.
 * One banner on three apps, each with its own country rule.
 */
export function exampleForm(base: WizardForm, ix: Index): { form: WizardForm; missing: string[] } {
  const missing: string[] = []
  const byName = <T extends { name: string }>(list: T[], name: string) => list.find((x) => x.name.trim().toLowerCase() === name.toLowerCase())
  const cr = byName(ix.creatives, "World Cup Highlights 320×50") ?? ix.creatives.find((c) => c.name.startsWith("World Cup Highlights") && c.status === "ready")
  if (!cr) missing.push("creative “World Cup Highlights 320×50”")
  const plan: { prop: string; plc: string; mode: CountryMode; countries: string[] }[] = [
    { prop: "DRM Sport Android", plc: "Home Banner", mode: "include", countries: ["BD", "IN", "PK", "NP"] },
    { prop: "Cricket Live iOS", plc: "Live Score Banner", mode: "include", countries: ["GB", "AU", "NZ", "ZA"] },
    { prop: "Football Scores Android", plc: "Fixtures Banner", mode: "exclude", countries: ["US", "CA"] },
  ]
  const propIds: string[] = []
  const targets: Record<string, WTarget> = {}
  for (const x of plan) {
    const p = byName(ix.properties, x.prop)
    if (!p) { missing.push(x.prop); continue }
    const own = ix.placements.filter((pl) => pl.propertyId === p.id)
    const pl = byName(own, x.plc) ?? (cr ? own.find((o) => o.status === "active" && compat(cr, o).ok) : undefined)
    propIds.push(p.id)
    targets[p.id] = { mode: x.mode, countries: x.countries.filter((c) => ix.ctryByCode[c]), placementIds: pl ? [pl.id] : [] }
  }
  const today = todayKey(base.tz)
  const end = "2026-12-20" > today ? "2026-12-20" : addDays(today, 60)
  return {
    form: {
      ...base, name: "World Cup Final Week Banner", objective: "awareness", start: today, end, priority: 3,
      creativeIds: cr ? [cr.id] : [], propIds, targets, budget: "4000", goal: "2500000", goalType: "impressions",
    },
    missing,
  }
}

export type FormUpdate = (p: Partial<WizardForm> | ((f: WizardForm) => Partial<WizardForm>)) => void

export interface StepProps {
  form: WizardForm
  update: FormUpdate
  errors: IssuesByStep
  showErr: boolean
  editId?: string
  goStep: (n: number, showErr?: boolean) => void
  /** Opens the creative wizard after safely saving or confirming the in-progress campaign. */
  onNewCreative?: () => void
  /** The user may change country targeting (`campaigns.targeting`). */
  canTarget: boolean
}

/** First visible error for a field key (only once errors are being shown). */
export function fieldError(p: Pick<StepProps, "errors" | "showErr">, key: string) {
  if (!p.showErr) return undefined
  for (const list of Object.values(p.errors)) {
    const hit = list.find((x) => x.key === key)
    if (hit) return hit.message
  }
  return undefined
}

export function updateTarget(update: FormUpdate, pid: string, patch: Partial<WTarget>) {
  update((f) => ({ targets: { ...f.targets, [pid]: { ...(f.targets[pid] ?? DEFAULT_T), ...patch } } }))
}
