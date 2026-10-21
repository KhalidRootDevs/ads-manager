/**
 * Serving index compilation (guideline §4.3). Pure: takes the loaded documents, returns the index the ad server
 * serves from plus each campaign's health. All targeting rules come from @orbit/domain.
 */
import {
  addDays, campaignHealth, compat, dateKeyInTz, dayStart, finalCountries, finalUrl, FORMAT_META, isDateKey,
  type AdFormat, type Candidate, type CountryLike, type CountryRule, type HealthIssue, type ServingCreative, type ServingIndex,
  type ServingKey, type ServingPlacement, type ServingProperty,
} from "@orbit/domain"

type Id = { _id: string }
export interface PropertyIn extends Id {
  name: string
  platform: "android" | "ios" | "web"
  identifier: string
  status: string
  env?: string
  testMode?: boolean
  countryRule: CountryRule
  sdk: { state: string; version: string | null; lastHeartbeatAt: Date | null }
}
export interface PlacementIn extends Id {
  propertyId: string
  name: string
  format: AdFormat
  size: string
  status: string
  minAppVersion: string | null
  refreshSec: number | null
}
export interface CreativeIn extends Id {
  name: string
  format: AdFormat
  size: string
  status: string
  assets: { kind: string; url: string }[]
  copy: { headline: string; body: string; cta: string }
  destination: { url: string | null; deepLink: string | null; utm: { source: string; medium: string; campaign: string } }
  altText: string
  options: Record<string, unknown>
}
export interface CampaignIn extends Id {
  name: string
  status: string
  priority: number
  flight: { start: Date | string; end: Date | string; tz: string }
  creativeIds: string[]
  targets: { propertyId: string; countryRule: CountryRule; placementIds: string[]; destinationOverride: string | null }[]
  constraints: {
    days: string[]; hours: { from: number; to: number }; devices: string[]; minAppVersion: string | null
    freqCap: { count: number; per: "hour" | "day" | "week" } | null
  }
  budget: { amountMicros: number | bigint | { toString(): string }; pacing: "even" | "asap" }
  health?: { issues: HealthIssue[] }
}
export interface KeyIn extends Id {
  propertyId: string
  hash: string
  env: "live" | "test"
  status: string
  graceUntil: Date | null
}
export interface SettingsIn {
  killSwitch?: boolean
  defaults?: { freqCap: { count: number; per: "hour" | "day" | "week" } | null; refreshSec: number | null }
}
export interface CompileInput {
  campaigns: CampaignIn[]
  creatives: CreativeIn[]
  properties: PropertyIn[]
  placements: PlacementIn[]
  countries: { _id: string; name: string; enabled: boolean }[]
  keys: KeyIn[]
  settings: SettingsIn | null
  /** lifetime spend per campaign (micros), for the budget health check */
  spend?: Record<string, number>
}

export interface CompileOutput {
  index: ServingIndex
  health: Map<string, HealthIssue[]>
}

/**
 * Flight dates are calendar dates. They're stored as Dates: UTC midnight of the date key (preferred), or the local
 * midnight in the campaign time zone. Both map back to the same "YYYY-MM-DD".
 */
export function flightKey(v: Date | string, tz: string): string {
  if (typeof v === "string") return isDateKey(v) ? v : flightKey(new Date(v), tz)
  const iso = v.toISOString()
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : dateKeyInTz(v, tz)
}

export function flightWindow(f: CampaignIn["flight"]) {
  const start = flightKey(f.start, f.tz)
  const end = flightKey(f.end, f.tz)
  return { start, end, startMs: dayStart(start, f.tz).getTime(), endMs: dayStart(addDays(end, 1), f.tz).getTime() }
}

const num = (v: CampaignIn["budget"]["amountMicros"]) => Number(typeof v === "object" ? v.toString() : v)

function creativePayload(cr: CreativeIn, override: string | null): ServingCreative {
  const assets: Record<string, string> = {}
  for (const a of cr.assets ?? []) if (!assets[a.kind]) assets[a.kind] = a.url
  const dest = (override ?? "").trim() || finalUrl(cr.destination)
  return {
    id: cr._id, format: cr.format, size: cr.size, weight: 1,
    payload: { assets, copy: { headline: cr.copy?.headline ?? "", body: cr.copy?.body ?? "", cta: cr.copy?.cta ?? "" }, clickUrl: dest, deepLink: cr.destination?.deepLink ?? null, altText: cr.altText ?? "", options: cr.options ?? {} },
  }
}

export function compileIndex(input: CompileInput, version: string, now = new Date()): CompileOutput {
  const countries: CountryLike[] = input.countries.map((c) => ({ code: c._id, name: c.name, enabled: c.enabled }))
  const nowMs = now.getTime()

  const properties: Record<string, ServingProperty> = {}
  const keysByProp = new Map<string, ServingKey[]>()
  for (const k of input.keys) {
    if (k.status !== "active" && k.status !== "grace") continue
    const graceUntil = k.graceUntil ? new Date(k.graceUntil).getTime() : null
    if (k.status === "grace" && (graceUntil == null || graceUntil <= nowMs)) continue
    const list = keysByProp.get(k.propertyId) ?? []
    list.push({ id: k._id, hash: k.hash, env: k.env, status: k.status, graceUntil })
    keysByProp.set(k.propertyId, list)
  }
  for (const p of input.properties) {
    properties[p._id] = { id: p._id, platform: p.platform, identifier: p.identifier, active: p.status === "active", testMode: !!p.testMode, keys: keysByProp.get(p._id) ?? [] }
  }

  const placements: Record<string, ServingPlacement> = {}
  const plById = new Map(input.placements.map((pl) => [pl._id, pl]))
  for (const pl of input.placements) {
    if (!properties[pl.propertyId]) continue
    placements[pl._id] = {
      id: pl._id, name: pl.name, propertyId: pl.propertyId, format: pl.format, size: pl.size, active: pl.status === "active",
      minAppVersion: pl.minAppVersion ?? null, refreshSec: pl.refreshSec ?? input.settings?.defaults?.refreshSec ?? null, candidates: [],
    }
  }

  const crById = new Map(input.creatives.map((c) => [c._id, c]))
  const propById = new Map(input.properties.map((p) => [p._id, p]))
  const defaultCap = input.settings?.defaults?.freqCap ?? null

  for (const c of input.campaigns) {
    if (c.status !== "scheduled" && c.status !== "active") continue
    const ready = c.creativeIds.map((id) => crById.get(id)).filter((cr): cr is CreativeIn => !!cr && cr.status === "ready")
    if (!ready.length) continue
    const fw = flightWindow(c.flight)
    if (fw.endMs <= nowMs) continue // flight over: never serves again
    for (const t of c.targets) {
      const prop = propById.get(t.propertyId)
      if (!prop) continue
      const cc = finalCountries(t.countryRule, prop.countryRule, countries)
      for (const plId of t.placementIds) {
        const pl = plById.get(plId)
        const spl = placements[plId]
        if (!pl || !spl || pl.propertyId !== prop._id) continue
        const fit = ready.filter((cr) => compat(cr, pl).ok)
        if (!fit.length) continue
        const cand: Candidate = {
          campaignId: c._id,
          priority: (c.priority === 1 || c.priority === 3 ? c.priority : 2) as 1 | 2 | 3,
          countries: cc,
          startMs: fw.startMs,
          endMs: fw.endMs,
          tz: c.flight.tz,
          days: c.constraints.days as Candidate["days"],
          hours: c.constraints.hours,
          devices: c.constraints.devices as Candidate["devices"],
          minAppVersion: c.constraints.minAppVersion ?? null,
          freqCap: c.constraints.freqCap ?? defaultCap,
          pacing: c.budget.pacing,
          budgetMicros: num(c.budget.amountMicros),
          weight: 1,
          destinationOverride: t.destinationOverride ?? null,
          creatives: fit.map((cr) => creativePayload(cr, t.destinationOverride ?? null)),
        }
        spl.candidates.push(cand)
      }
    }
  }

  const ecpm: Record<string, number> = {}
  for (const [f, m] of Object.entries(FORMAT_META)) ecpm[f] = m.ecpm

  // Health for live campaigns (persisted by the compiler service only when it changed).
  const health = new Map<string, HealthIssue[]>()
  const hctx = {
    properties: Object.fromEntries(input.properties.map((p) => [p._id, { id: p._id, name: p.name, status: p.status, countryRule: p.countryRule, sdk: p.sdk }])),
    placements: Object.fromEntries(input.placements.map((p) => [p._id, { id: p._id, propertyId: p.propertyId, format: p.format, size: p.size, status: p.status }])),
    creatives: Object.fromEntries(input.creatives.map((c) => [c._id, { id: c._id, name: c.name, format: c.format, size: c.size, status: c.status }])),
    countries,
  }
  for (const c of input.campaigns) {
    health.set(c._id, campaignHealth({ creativeIds: c.creativeIds, targets: c.targets as never, budget: { amountMicros: num(c.budget.amountMicros) } as never }, hctx as never, input.spend?.[c._id] ?? 0))
  }

  return {
    index: { version, builtAt: now.toISOString(), properties, placements, ecpm, killSwitch: !!input.settings?.killSwitch },
    health,
  }
}

/** Stable comparison of health issue lists (order-insensitive). */
export function sameIssues(a: HealthIssue[] | undefined, b: HealthIssue[]): boolean {
  const norm = (xs: HealthIssue[]) => xs.map((x) => `${x.code}|${x.propertyId ?? ""}|${x.creativeId ?? ""}|${x.country ?? ""}|${x.message}`).sort().join("\n")
  return norm(a ?? []) === norm(b)
}
