/**
 * Persisted documents ↔ contract DTOs (packages/domain/src/schemas.ts).
 * `_id` → `id`, Date → ISO string, Long/BigInt micros → number, campaign flight Date ↔ "YYYY-MM-DD" in `flight.tz`.
 * Every mapper lists its fields explicitly so nothing internal (key hashes, `live`, sessions) can leak.
 */
import {
  dateKeyInTz, dayStart, todayKey,
  type Alert, type Audience, type AuditEntry, type Campaign, type CampaignInput, type CampaignRevision, type CampaignStats, type Country, type Creative,
  type CreativeVersion, type EventDefinition, type Placement, type Property, type PropertyKey, type RequestSample, type Settings, type TeamBudget, type User,
} from "@orbit/domain"
import type { Lean } from "./types"

export const iso = (d: Date | string | number | null | undefined): string | null => (d == null ? null : new Date(d).toISOString())
const isoReq = (d: Date | string | number | null | undefined): string => (d == null ? new Date(0).toISOString() : new Date(d).toISOString())
export const num = (v: unknown): number => (v == null ? 0 : typeof v === "number" ? v : Number(v as bigint))
const freq = (f: Lean | null | undefined) => (f && f.count != null ? { count: num(f.count), per: f.per } : null)
const rule = (r: Lean | null | undefined) => ({ mode: r?.mode ?? "all", countries: [...(r?.countries ?? [])] })

export function userDto(u: Lean): User {
  return {
    id: u._id, email: u.email, name: u.name, role: u.role, status: u.status, lastActiveAt: iso(u.lastActiveAt), invitedBy: u.invitedBy ?? null,
    createdAt: isoReq(u.createdAt), updatedAt: isoReq(u.updatedAt), rev: num(u.rev),
  }
}

export function propertyDto(p: Lean): Property {
  return {
    id: p._id, name: p.name, platform: p.platform, identifier: p.identifier, team: p.team, ownerId: p.ownerId ?? null, env: p.env, status: p.status,
    formats: [...(p.formats ?? [])], countryRule: rule(p.countryRule), tags: [...(p.tags ?? [])], testMode: !!p.testMode,
    sdk: { state: p.sdk?.state ?? "not_integrated", version: p.sdk?.version ?? null, lastHeartbeatAt: iso(p.sdk?.lastHeartbeatAt) },
    createdAt: isoReq(p.createdAt), updatedAt: isoReq(p.updatedAt), rev: num(p.rev),
  }
}

export function keyDto(k: Lean): PropertyKey {
  return {
    id: k._id, propertyId: k.propertyId, label: k.label, env: k.env, prefix: k.prefix, last4: k.last4, status: k.status, graceUntil: iso(k.graceUntil),
    createdAt: isoReq(k.createdAt), createdBy: k.createdBy ?? null, lastUsedAt: iso(k.lastUsedAt), revokedAt: iso(k.revokedAt),
  }
}

export function placementDto(p: Lean): Placement {
  return {
    id: p._id, propertyId: p.propertyId, name: p.name, format: p.format, size: p.size, minAppVersion: p.minAppVersion ?? null, freqCap: freq(p.freqCap),
    refreshSec: p.refreshSec == null ? null : num(p.refreshSec), status: p.status, createdAt: isoReq(p.createdAt), updatedAt: isoReq(p.updatedAt), rev: num(p.rev),
  }
}

export function creativeDto(c: Lean): Creative {
  const o = c.options ?? {}
  const d = c.destination ?? {}
  return {
    id: c._id, name: c.name, format: c.format, size: c.size ?? "", status: c.status, ownerId: c.ownerId ?? null, currentVersion: num(c.currentVersion ?? 1),
    assets: (c.assets ?? []).map((a: Lean) => ({
      kind: a.kind, url: a.url, name: a.name, mime: a.mime, bytes: num(a.bytes), width: a.width ?? null, height: a.height ?? null, durationSec: a.durationSec ?? null, sha256: a.sha256 ?? null,
    })),
    copy: { headline: c.copy?.headline ?? "", body: c.copy?.body ?? "", cta: c.copy?.cta ?? "" },
    destination: { url: d.url ?? null, deepLink: d.deepLink ?? null, utm: { source: d.utm?.source ?? "", medium: d.utm?.medium ?? "", campaign: d.utm?.campaign ?? "" } },
    altText: c.altText ?? "",
    options: {
      media: o.media ?? "image", closeDelaySec: o.closeDelaySec ?? null, reward: o.reward ?? null, completionEvent: o.completionEvent ?? null, safeArea: o.safeArea ?? null,
      closeButton: o.closeButton ?? null, freqNotice: o.freqNotice ?? null, brandColor: o.brandColor ?? "#0F766E",
    },
    review: { state: c.review?.state ?? "none", by: c.review?.by ?? null, at: iso(c.review?.at), reason: c.review?.reason ?? null },
    createdAt: isoReq(c.createdAt), updatedAt: isoReq(c.updatedAt), rev: num(c.rev),
  }
}

export function creativeVersionDto(v: Lean): CreativeVersion {
  return { id: v._id, creativeId: v.creativeId, v: num(v.v), by: v.by ?? null, byName: v.byName ?? null, note: v.note ?? "", at: isoReq(v.at) }
}

// ---------- campaigns ----------
/** Stored flight (UTC instants of local midnights) → calendar dates in the campaign time zone. End is inclusive. */
export function flightDto(f: Lean): Campaign["flight"] {
  const tz = f?.tz ?? "Asia/Dhaka"
  return { start: dateKeyInTz(f.start, tz), end: dateKeyInTz(f.end, tz), tz }
}

/** Calendar dates → stored instants: start = local midnight of the first day, end = local midnight of the last day. */
export function flightDoc(f: CampaignInput["flight"]) {
  return { start: dayStart(f.start, f.tz), end: dayStart(f.end, f.tz), tz: f.tz }
}

export function campaignDto(c: Lean): Campaign {
  const k = c.constraints ?? {}
  return {
    id: c._id, name: c.name, objective: c.objective, status: c.status,
    health: {
      issues: (c.health?.issues ?? []).map((i: Lean) => ({ code: i.code, message: i.message, propertyId: i.propertyId ?? null, creativeId: i.creativeId ?? null, country: i.country ?? null })),
      checkedAt: iso(c.health?.checkedAt),
    },
    ownerId: c.ownerId ?? null, team: c.team, flight: flightDto(c.flight), priority: (num(c.priority) || 2) as 1 | 2 | 3,
    creativeIds: [...(c.creativeIds ?? [])],
    targets: (c.targets ?? []).map((t: Lean) => ({
      propertyId: t.propertyId, countryRule: rule(t.countryRule), placementIds: [...(t.placementIds ?? [])], allocationPct: t.allocationPct ?? null, destinationOverride: t.destinationOverride ?? null,
    })),
    constraints: {
      days: [...(k.days ?? [])], hours: { from: num(k.hours?.from ?? 0), to: num(k.hours?.to ?? 24) }, devices: [...(k.devices ?? [])], minAppVersion: k.minAppVersion ?? null,
      freqCap: freq(k.freqCap), audienceIds: [...(k.audienceIds ?? [])],
    },
    budget: { amountMicros: num(c.budget?.amountMicros), pacing: c.budget?.pacing ?? "even", goal: c.budget?.goal ? { type: c.budget.goal.type, value: num(c.budget.goal.value) } : null },
    publishedRev: c.publishedRev == null ? null : num(c.publishedRev), publishedAt: iso(c.publishedAt), archivedAt: iso(c.archivedAt), createdBy: c.createdBy ?? null,
    createdAt: isoReq(c.createdAt), updatedAt: isoReq(c.updatedAt), rev: num(c.rev),
  }
}

/** Campaign DTO → the input shape `validateCampaign` and the wizard work with. */
export function campaignInputOf(c: Campaign): CampaignInput {
  return { name: c.name, objective: c.objective, team: c.team, flight: c.flight, priority: c.priority, creativeIds: c.creativeIds, targets: c.targets, constraints: c.constraints, budget: c.budget }
}

/** Input fields → persisted fields (only the keys present). */
export function campaignDocFields(input: Partial<CampaignInput>) {
  const out: Lean = {}
  if (input.name !== undefined) out.name = input.name.trim()
  if (input.objective !== undefined) out.objective = input.objective
  if (input.team !== undefined) out.team = input.team
  if (input.flight !== undefined) out.flight = flightDoc(input.flight)
  if (input.priority !== undefined) out.priority = input.priority
  if (input.creativeIds !== undefined) out.creativeIds = [...new Set(input.creativeIds)]
  if (input.targets !== undefined) out.targets = input.targets
  if (input.constraints !== undefined) out.constraints = input.constraints
  if (input.budget !== undefined) out.budget = { ...input.budget, amountMicros: BigInt(input.budget.amountMicros) }
  return out
}

export function statsDto(s: Lean | null | undefined, now = new Date()): CampaignStats | null {
  if (!s) return null
  const today = todayKey(undefined, now)
  const isToday = s.today?.d && dateKeyInTz(s.today.d) === today
  return {
    campaignId: s._id,
    lifetime: { imp: num(s.lifetime?.imp), clk: num(s.lifetime?.clk), conv: num(s.lifetime?.conv), costMicros: num(s.lifetime?.costMicros) },
    today: isToday
      ? { d: today, imp: num(s.today.imp), clk: num(s.today.clk), conv: num(s.today.conv), costMicros: num(s.today.costMicros) }
      : { d: today, imp: 0, clk: 0, conv: 0, costMicros: 0 },
    updatedAt: iso(s.updatedAt),
  }
}

export function revisionDto(r: Lean): CampaignRevision {
  return { id: r._id, campaignId: r.campaignId, rev: num(r.rev), publishedBy: r.publishedBy ?? null, publishedByName: r.publishedByName ?? null, at: isoReq(r.at), diff: [...(r.diff ?? [])] }
}

// ---------- reference data ----------
export function settingsDto(s: Lean): Settings {
  return {
    reportingTz: s.reportingTz, currency: "USD",
    defaults: { freqCap: freq(s.defaults?.freqCap), refreshSec: s.defaults?.refreshSec == null ? null : num(s.defaults.refreshSec) },
    tracking: { clicks: !!s.tracking?.clicks, viewability: !!s.tracking?.viewability, ipTruncation: !!s.tracking?.ipTruncation },
    autoPauseOnBudget: !!s.autoPauseOnBudget, rev: num(s.rev), updatedAt: isoReq(s.updatedAt),
  }
}

export const countryDto = (c: Lean): Country => ({ code: c._id, name: c.name, region: c.region, enabled: !!c.enabled })

export const eventDto = (e: Lean): EventDefinition => ({ key: e._id, name: e.name, source: e.source, active: !!e.active, lastSeenAt: iso(e.lastSeenAt), createdAt: isoReq(e.createdAt) })

export function audienceDto(a: Lean): Audience {
  return {
    id: a._id, name: a.name,
    rule: { event: a.rule?.event, withinDays: num(a.rule?.withinDays), exclude: a.rule?.exclude?.event ? { event: a.rule.exclude.event, withinDays: num(a.rule.exclude.withinDays) } : null },
    status: a.status, estimate: a.estimate?.at ? { size: num(a.estimate.size), at: isoReq(a.estimate.at) } : null, createdBy: a.createdBy ?? null,
    createdAt: isoReq(a.createdAt), updatedAt: isoReq(a.updatedAt), rev: num(a.rev),
  }
}

export const budgetDto = (b: Lean): TeamBudget => ({ team: b.team, quarter: b.quarter, amountMicros: num(b.amountMicros), updatedBy: b.updatedBy ?? null, updatedAt: isoReq(b.updatedAt), rev: num(b.rev) })

export const auditDto = (a: Lean): AuditEntry => ({
  id: a._id, at: isoReq(a.at), actor: { id: a.actor?.id ?? null, name: a.actor?.name ?? "System" }, action: a.action,
  target: { type: a.target?.type, id: a.target?.id, name: a.target?.name }, detail: a.detail ?? "",
})

export const alertDto = (a: Lean): Alert => ({
  id: a._id, type: a.type, severity: a.severity, entity: { type: a.entity?.type, id: a.entity?.id }, status: a.status, title: a.title, message: a.message, href: a.href,
  firstSeenAt: isoReq(a.firstSeenAt), lastSeenAt: isoReq(a.lastSeenAt), resolvedAt: iso(a.resolvedAt),
})

export function requestSampleDto(s: Lean, placementNames: Record<string, string>): RequestSample {
  const pl = s.k?.pl ?? null
  return {
    at: isoReq(s.at), propertyId: s.k?.p, placementId: pl, placementName: pl ? (placementNames[pl] ?? null) : null, country: s.cc ?? "ZZ", result: String(s.result ?? ""),
    latencyMs: num(s.latencyMs), sdk: s.sdk ?? null,
  }
}

