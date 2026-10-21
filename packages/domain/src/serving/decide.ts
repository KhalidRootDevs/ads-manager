/**
 * The ad decision (guideline §4.2), as pure functions over a compiled serving index.
 * The ad server calls `eligible()` → checks frequency caps and pacing in Redis → `pick()`.
 * No I/O here, so it is unit-testable and shared with the admin UI preview.
 */
import type { AdFormat, Device, FreqPeriod, PacingMode, Platform, Weekday } from "../enums"
import { partsInTz } from "../time"

export interface ServingKey {
  /** property_keys._id (for last-used tracking) */
  id?: string
  hash: string
  env: "live" | "test"
  status: "active" | "grace"
  /** epoch ms; grace keys stop working after this */
  graceUntil: number | null
}

export interface ServingProperty {
  id: string
  platform: Platform
  /** bundle id / package / domain */
  identifier: string
  active: boolean
  testMode: boolean
  keys: ServingKey[]
}

export interface ServingCreative {
  id: string
  format: AdFormat
  size: string
  weight: number
  payload: {
    assets: Record<string, string>
    copy: { headline: string; body: string; cta: string }
    clickUrl: string
    deepLink: string | null
    altText: string
    options: Record<string, unknown>
  }
}

export interface Candidate {
  campaignId: string
  priority: 1 | 2 | 3
  /** Final countries for this property (availability ∩ enabled ∩ campaign rule), conflicts removed. */
  countries: string[]
  /** Runtime-only lookup built by the ad server when it loads an index (never serialised). */
  countrySet?: ReadonlySet<string>
  startMs: number
  /** exclusive */
  endMs: number
  tz: string
  days: Weekday[]
  hours: { from: number; to: number }
  devices: Device[]
  minAppVersion: string | null
  freqCap: { count: number; per: FreqPeriod } | null
  pacing: PacingMode
  budgetMicros: number
  /** Share used to boost campaigns behind their goal (1 = neutral). */
  weight: number
  destinationOverride: string | null
  creatives: ServingCreative[]
}

export interface ServingPlacement {
  id: string
  /** display name (diagnostics / test requests) */
  name?: string
  propertyId: string
  format: AdFormat
  size: string
  active: boolean
  minAppVersion: string | null
  refreshSec: number | null
  candidates: Candidate[]
}

export interface ServingIndex {
  version: string
  builtAt: string
  properties: Record<string, ServingProperty>
  placements: Record<string, ServingPlacement>
  /** ecpm (USD) per format, for spend accounting in tracking tokens */
  ecpm: Record<string, number>
  killSwitch: boolean
}

export type NoFillReason = "no_candidates" | "capped" | "paced" | "country" | "paused_property" | "paused_placement" | "schedule" | "device" | "app_version" | "kill_switch" | "unknown_placement"

export interface DecisionRequest {
  placementId: string
  propertyId: string
  country: string
  device: Device
  appVersion: string | null
  test: boolean
  now: number
}

/** The property key matching a hashed secret: active keys always, grace keys until `graceUntil` (§9). */
export function findKey(prop: Pick<ServingProperty, "keys">, hash: string, now: number): ServingKey | null {
  for (const k of prop.keys) {
    if (k.hash !== hash) continue
    if (k.status === "active") return k
    if (k.status === "grace" && k.graceUntil != null && now < k.graceUntil) return k
    return null
  }
  return null
}

/**
 * Web properties authenticate by Origin: its host must equal the property domain or be a subdomain of it.
 * `allowLocal` (development only) also accepts localhost / 127.0.0.1 origins.
 */
export function originAllowed(identifier: string, origin: string | null | undefined, allowLocal = false): boolean {
  if (!origin) return false
  let host: string
  try {
    host = new URL(origin).hostname.toLowerCase()
  } catch {
    return false
  }
  if (allowLocal && (host === "localhost" || host === "127.0.0.1" || host === "[::1]")) return true
  const id = identifier.toLowerCase()
  return host === id || host.endsWith("." + id)
}

/** Compare dotted versions numerically: -1, 0, 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

export function inSchedule(c: Pick<Candidate, "startMs" | "endMs" | "tz" | "days" | "hours">, now: number): boolean {
  if (now < c.startMs || now >= c.endMs) return false
  const p = partsInTz(now, c.tz)
  if (c.days.length && !c.days.includes(p.weekday)) return false
  return p.hour >= c.hours.from && p.hour < c.hours.to
}

export type EligibleResult = { ok: true; placement: ServingPlacement; candidates: Candidate[] } | { ok: false; reason: NoFillReason }

/** Steps 3–4 of §4.2: candidate lookup and in-memory filters. */
export function eligible(index: ServingIndex, r: DecisionRequest): EligibleResult {
  if (index.killSwitch) return { ok: false, reason: "kill_switch" }
  const pl = index.placements[r.placementId]
  if (!pl || pl.propertyId !== r.propertyId) return { ok: false, reason: "unknown_placement" }
  const prop = index.properties[pl.propertyId]
  if (!prop?.active) return { ok: false, reason: "paused_property" }
  if (!pl.active) return { ok: false, reason: "paused_placement" }
  if (pl.minAppVersion && r.appVersion && compareVersions(r.appVersion, pl.minAppVersion) < 0) return { ok: false, reason: "app_version" }
  if (!pl.candidates.length) return { ok: false, reason: "no_candidates" }
  let reason: NoFillReason = "no_candidates"
  const out: Candidate[] = []
  for (const c of pl.candidates) {
    if (!(c.countrySet ? c.countrySet.has(r.country) : c.countries.includes(r.country))) { reason = "country"; continue }
    if (!inSchedule(c, r.now)) { reason = "schedule"; continue }
    if (c.devices.length && !c.devices.includes(r.device)) { reason = "device"; continue }
    if (c.minAppVersion && r.appVersion && compareVersions(r.appVersion, c.minAppVersion) < 0) { reason = "app_version"; continue }
    out.push(c)
  }
  return out.length ? { ok: true, placement: pl, candidates: out } : { ok: false, reason }
}

/** Steps 7–8: highest priority tier first, then weighted random campaign, then weighted creative. */
export function pick(candidates: Candidate[], rnd: () => number = Math.random): { campaign: Candidate; creative: ServingCreative } | null {
  if (!candidates.length) return null
  const top = Math.max(...candidates.map((c) => c.priority))
  const tier = candidates.filter((c) => c.priority === top && c.creatives.length)
  const campaign = weighted(tier, (c) => c.weight, rnd)
  if (!campaign) return null
  const creative = weighted(campaign.creatives, (c) => c.weight, rnd)
  return creative ? { campaign, creative } : null
}

function weighted<T>(items: T[], w: (x: T) => number, rnd: () => number): T | null {
  const total = items.reduce((a, x) => a + Math.max(0, w(x)), 0)
  if (!items.length) return null
  if (!total) return items[Math.floor(rnd() * items.length)]
  let r = rnd() * total
  for (const x of items) {
    r -= Math.max(0, w(x))
    if (r < 0) return x
  }
  return items[items.length - 1]
}

/** Frequency-cap bucket for a period, in the campaign time zone (used in Redis key names). */
export function freqBucket(per: FreqPeriod, now: number, tz: string): string {
  const p = partsInTz(now, tz)
  const day = `${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}`
  if (per === "hour") return `${day}${String(p.hour).padStart(2, "0")}`
  if (per === "day") return day
  // ISO-like week bucket: days since epoch / 7, shifted so weeks start Monday
  const dayNum = Math.floor((Date.UTC(p.year, p.month - 1, p.day) / 86_400_000 + 3) / 7)
  return `w${dayNum}`
}

export function freqTtlSec(per: FreqPeriod): number {
  return per === "hour" ? 3_700 : per === "day" ? 90_000 : 8 * 86_400
}
