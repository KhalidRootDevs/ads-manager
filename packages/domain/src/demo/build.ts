/**
 * `buildDemo()`: the prototype's demo workspace in production shapes (schemas.ts DTOs: `id`, ISO instants,
 * "YYYY-MM-DD" calendar dates, integer micros). Browser-safe: no node imports, no secrets.
 * Every date is shifted by (today − 2026-10-19) so the demo looks current whenever it is built.
 */
import { DEVICES, WEEKDAYS, type KeyEnv, type KeyStatus } from "../enums"
import type { IdKind } from "../ids"
import { toMicros } from "../money"
import { campaignHealth, deriveAlerts } from "../rules/health"
import type {
  Alert, Asset, Audience, AuditEntry, Campaign, CampaignRevision, Country, Creative, CreativeVersion, EventDefinition, Placement, Property, Settings, TeamBudget, User,
} from "../schemas"
import { addDays, dayStart, daysBetween, quarterOf, todayKey } from "../time"
import {
  APP_FORMATS, AUDIENCES, AUDIT, BUDGETS, CAMPAIGNS, COUNTRIES, CREATIVES, DISABLED_COUNTRIES, emailOf, EVENTS, EVENTS_CREATED, OWNERS, PLACEMENTS, PROPS, PROPS_ADDED,
  PROTO_TODAY, TAGS, TEAM, TEAM_CREATED, WEB_FORMATS, type CreativeSeed,
} from "./data"
import { idFactory, rng } from "./random"

export interface DemoOptions {
  /** Reporting-day date key the demo is built for ("YYYY-MM-DD", Asia/Dhaka). */
  today: string
  /** PRNG seed for ids and jitter (default 7, the prototype's). */
  seed?: number
  /** Current instant (epoch ms). Defaults to now when `today` is the real current day, else the end of `today`. */
  now?: number
  /** Base URL of demo creative assets. */
  cdnBase?: string
}

/** SDK key metadata. The db seed generates the secret, `last4` and `hash` (node crypto). */
export interface DemoKey {
  id: string
  propertyId: string
  label: string
  env: KeyEnv
  prefix: string
  status: KeyStatus
  graceUntil: string | null
  createdAt: string
  createdBy: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  revokedBy: string | null
}

export type DemoCreativeVersion = CreativeVersion & { snapshot: Record<string, unknown> }
export type DemoCampaignRevision = CampaignRevision & { snapshot: Record<string, unknown> }
export type DemoAlert = Alert & { dedupeKey: string }

/** Inputs for the delivery generator that have no production field. */
export interface DemoSim {
  properties: Record<string, { scale: number; top: string[] }>
  campaigns: Record<string, { scale: number; index: number; stopKey: string | null; histSpendMicros: number }>
}

export interface Demo {
  today: string
  now: string
  seed: number
  users: User[]
  countries: Country[]
  settings: Settings
  properties: Property[]
  propertyKeys: DemoKey[]
  placements: Placement[]
  creatives: Creative[]
  creativeVersions: DemoCreativeVersion[]
  campaigns: Campaign[]
  campaignRevisions: DemoCampaignRevision[]
  events: EventDefinition[]
  audiences: Audience[]
  budgets: TeamBudget[]
  auditLog: AuditEntry[]
  alerts: DemoAlert[]
  /** prototype id (p1, w3, pl101, cr4, c1, m2, au1, …) → production id */
  idMap: Record<string, string>
  sim: DemoSim
}

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

export function buildDemo(opts: DemoOptions): Demo {
  const today = opts.today
  const seed = opts.seed ?? 7
  const r = rng(seed)
  const mkId = idFactory(rng(seed * 7919 + 17))
  const nowMs = opts.now ?? (todayKey() === today ? Date.now() : dayStart(addDays(today, 1)).getTime() - MIN)
  const iso = (t: number) => new Date(t).toISOString()
  const shiftDays = daysBetween(PROTO_TODAY, today)
  const shift = (k: string) => addDays(k, shiftDays)
  /** Instant of a prototype date + Dhaka wall-clock time, never later than `now − minBefore` minutes. */
  const at = (protoKey: string, hhmm = "10:00", minBefore = 1) => {
    const [h, m] = hhmm.split(":").map(Number)
    return Math.min(dayStart(shift(protoKey)).getTime() + h * HOUR + m * MIN, nowMs - minBefore * MIN)
  }
  const cdn = (opts.cdnBase ?? "https://cdn.orbit.example/demo").replace(/\/$/, "")
  const idMap: Record<string, string> = {}
  const id = (kind: IdKind, proto: string, t: number) => (idMap[proto] = mkId(kind, t))

  // ---------- users ----------
  const userByName: Record<string, string> = {}
  const users: User[] = TEAM.map((m) => {
    const created = m.status === "invited" ? at("2026-10-11", "11:00") : at(TEAM_CREATED, "09:00")
    const uid = id("user", m.id, created)
    userByName[m.name] = uid
    const last =
      m.last == null ? null
      : m.last === "now" ? nowMs - MIN
      : m.last === "today" ? Math.max(dayStart(today).getTime(), nowMs - Math.round((1 + r() * 4) * HOUR))
      : m.last === "yesterday" ? at(addDays(PROTO_TODAY, -1), "18:30")
      : at(m.last, "16:00")
    return {
      id: uid, email: emailOf(m.name), name: m.name, role: m.role, status: m.status, lastActiveAt: last == null ? null : iso(last), invitedBy: null,
      createdAt: iso(created), updatedAt: iso(created), rev: 0,
    }
  })
  const fatima = users.find((u) => u.status === "invited")
  if (fatima) fatima.invitedBy = userByName["Nadia Rahman"]
  const mei = users.find((u) => u.name === "Mei Tanaka")!
  mei.updatedAt = iso(at("2026-10-14", "15:10"))
  mei.rev = 1
  const uidOf = (name: string) => userByName[name] ?? null

  // ---------- countries & settings ----------
  const countries: Country[] = COUNTRIES.map(([code, name, region]) => ({ code, name, region, enabled: !DISABLED_COUNTRIES.includes(code) }))
  const settings: Settings = {
    reportingTz: "Asia/Dhaka", currency: "USD", defaults: { freqCap: { count: 6, per: "day" }, refreshSec: 60 },
    tracking: { clicks: true, viewability: true, ipTruncation: true }, autoPauseOnBudget: true, rev: 0, updatedAt: iso(at(TEAM_CREATED, "09:30")),
  }

  // ---------- properties & keys ----------
  const sim: DemoSim = { properties: {}, campaigns: {} }
  const propAdded = at(PROPS_ADDED, "10:00")
  const properties: Property[] = PROPS.map(([pid, name, platform, identifier, team, status, sdk, top, mode, list, env, sdkVer, scale]) => {
    const t = propAdded + PROPS.findIndex((x) => x[0] === pid) * MIN
    const hb =
      sdk === "healthy" ? nowMs - Math.round((1 + r() * 3) * MIN)
      : sdk === "degraded" ? nowMs - 14 * MIN
      : sdk === "heartbeat_missing" ? nowMs - 26 * HOUR
      : null
    sim.properties[id("property", pid, t)] = { scale, top }
    return {
      id: idMap[pid], name, platform, identifier, team, ownerId: uidOf(OWNERS[team]), env, status, formats: platform === "web" ? [...WEB_FORMATS] : [...APP_FORMATS],
      countryRule: { mode, countries: [...list] }, tags: TAGS[pid] ?? [], testMode: env === "staging",
      sdk: { state: sdk, version: sdkVer, lastHeartbeatAt: hb == null ? null : iso(hb) }, createdAt: iso(t), updatedAt: iso(t), rev: 0,
    }
  })
  const propByProto = (pid: string) => properties.find((p) => p.id === idMap[pid])!

  const imran = uidOf("Imran Qureshi")
  const leo = uidOf("Leo Martins")
  const propertyKeys: DemoKey[] = []
  for (const p of properties) {
    const integrated = p.sdk.state !== "not_integrated"
    const hb = p.sdk.lastHeartbeatAt ? Date.parse(p.sdk.lastHeartbeatAt) : null
    const key = (env: KeyEnv, label: string, created: number, extra: Partial<DemoKey> = {}): DemoKey => ({
      id: mkId("key", created), propertyId: p.id, label, env, prefix: `ok_${env}_`, status: "active", graceUntil: null, createdAt: iso(created), createdBy: imran,
      lastUsedAt: !integrated ? null : env === "live" ? iso(hb ?? nowMs - MIN) : iso(Math.min(hb ?? nowMs, nowMs - 6 * DAY)), revokedAt: null, revokedBy: null, ...extra,
    })
    const created = Date.parse(p.createdAt)
    if (p.id === idMap.p1) {
      // Imran rotated the production key: the old one went through a 24 h grace period and is now revoked.
      const rotated = at("2026-10-10", "14:12")
      propertyKeys.push(key("live", "Production SDK key (rotated)", created, { status: "revoked", graceUntil: iso(rotated + DAY), lastUsedAt: iso(rotated + DAY - 5 * MIN), revokedAt: iso(rotated + DAY), revokedBy: imran }))
      propertyKeys.push(key("live", "Production SDK key", rotated))
    } else propertyKeys.push(key("live", "Production SDK key", created))
    propertyKeys.push(key("test", "Test key", created + 1000))
    if (p.id === idMap.w13) {
      const revoked = at("2026-10-02", "12:44")
      propertyKeys.push(key("test", "Legacy test key", created - DAY, { status: "revoked", lastUsedAt: iso(revoked - 30 * DAY), revokedAt: iso(revoked), revokedBy: leo, createdBy: leo }))
    }
  }

  // ---------- placements ----------
  const placements: Placement[] = PLACEMENTS.map(([plid, pid, name, format, size, minVer, freq, refresh, status], i) => {
    const t = Date.parse(propByProto(pid).createdAt) + HOUR + i * MIN
    return {
      id: id("placement", plid, t), propertyId: idMap[pid], name, format, size, minAppVersion: minVer, freqCap: freq ? { count: freq[0], per: freq[1] } : null,
      refreshSec: refresh, status, createdAt: iso(t), updatedAt: iso(t), rev: 0,
    }
  })

  // ---------- creatives & versions ----------
  const approver = uidOf("Arif Hossain")
  const creatives: Creative[] = []
  const creativeVersions: DemoCreativeVersion[] = []
  for (const s of CREATIVES) {
    const versions = s.versions ?? [{ v: 1, date: s.updated, by: s.owner, note: "Created" }]
    const created = at(versions[0].date, "11:00")
    const cid = id("creative", s.id, created)
    const reviewAt = s.status === "rejected" ? at("2026-10-16", "17:20") : s.status === "in_review" ? at("2026-10-15", "11:03") : at(s.updated, "15:00")
    const updated = s.status === "rejected" || s.status === "in_review" ? reviewAt : at(s.updated, "12:00")
    const c: Creative = {
      id: cid, name: s.name, format: s.format, size: s.size, status: s.status, ownerId: uidOf(s.owner), currentVersion: versions.length,
      assets: assetsOf(s, cdn), copy: { headline: s.headline, body: s.body ?? "", cta: s.cta ?? "Learn more" },
      destination: { url: s.url ?? null, deepLink: s.deeplink ?? null, utm: parseUtm(s.utm) }, altText: s.alt ?? "",
      options: {
        media: s.format === "video" || s.format === "rewarded_video" ? "video" : "image",
        closeDelaySec: s.format === "interstitial" ? (s.closeDelay ?? 5) : null,
        reward: s.format === "rewarded_video" ? (s.reward ?? null) : null,
        completionEvent: s.format === "rewarded_video" ? (s.event ?? null) : null,
        safeArea: s.format === "app_open" ? !!s.safeArea : null,
        closeButton: s.format === "web_popup" ? true : null,
        freqNotice: s.format === "web_popup" ? true : null,
        brandColor: s.color,
      },
      review:
        s.status === "ready" || s.status === "archived" ? { state: "approved", by: approver, at: iso(reviewAt), reason: null }
        : s.status === "rejected" ? { state: "rejected", by: approver, at: iso(reviewAt), reason: s.rejectReason ?? null }
        : s.status === "in_review" ? { state: "pending", by: null, at: null, reason: null }
        : { state: "none", by: null, at: null, reason: null },
      createdAt: iso(created), updatedAt: iso(Math.max(created, updated)), rev: versions.length - 1 + (s.status === "draft" ? 0 : 1),
    }
    creatives.push(c)
    for (const v of versions) {
      creativeVersions.push({
        id: `${cid}:${v.v}`, creativeId: cid, v: v.v, by: uidOf(v.by), byName: v.by, note: v.note, at: iso(v.v === 1 ? created : at(v.date, "12:00")),
        snapshot: { name: c.name, format: c.format, size: c.size, assets: c.assets, copy: c.copy, destination: c.destination, altText: c.altText, options: c.options },
      })
    }
  }

  // ---------- campaigns & revisions ----------
  const campaignAudit = (proto: string) => AUDIT.filter((a) => a.target.type === "campaign" && a.target.ref === proto)
  const campaigns: Campaign[] = []
  const campaignRevisions: DemoCampaignRevision[] = []
  CAMPAIGNS.forEach((s, index) => {
    const created = at(s.created ?? s.start, "10:00", 30)
    const cmpId = id("campaign", s.id, created)
    const entries = campaignAudit(s.id)
    const publishes = entries.filter((a) => ["campaign.published", "campaign.updated", "campaign.targeting_changed"].includes(a.action))
    const edits = entries.filter((a) => a.action !== "campaign.created")
    const lastAt = edits.length ? at(edits[edits.length - 1].date, edits[edits.length - 1].time, 5) : created
    const c: Campaign = {
      id: cmpId, name: s.name, objective: s.objective, status: s.status, health: { issues: [], checkedAt: null }, ownerId: uidOf(s.owner), team: s.team,
      flight: { start: shift(s.start), end: shift(s.end), tz: s.tz }, priority: s.priority, creativeIds: s.creativeIds.map((x) => idMap[x]),
      targets: s.targets.map((t) => ({ propertyId: idMap[t.p], countryRule: { mode: t.mode, countries: [...t.countries] }, placementIds: t.pl.map((x) => idMap[x]), allocationPct: null, destinationOverride: null })),
      constraints: { days: [...WEEKDAYS], hours: { from: 0, to: 24 }, devices: [...DEVICES], minAppVersion: null, freqCap: { count: s.freq[0], per: s.freq[1] }, audienceIds: [] },
      budget: { amountMicros: toMicros(s.budget), pacing: s.pacing, goal: { type: s.goal[0], value: s.goal[1] } },
      publishedRev: publishes.length ? publishes.length : null,
      publishedAt: publishes.length ? iso(at(publishes[publishes.length - 1].date, publishes[publishes.length - 1].time, 5)) : null,
      archivedAt: s.status === "archived" ? iso(at(addDays(s.end, 14), "10:00")) : null,
      createdBy: uidOf(s.owner), createdAt: iso(created), updatedAt: iso(s.status === "archived" ? at(addDays(s.end, 14), "10:00") : lastAt), rev: edits.length + (s.status === "archived" ? 1 : 0),
    }
    campaigns.push(c)
    sim.campaigns[cmpId] = { scale: s.scale, index, stopKey: s.stopDay == null ? null : addDays(today, s.stopDay - 59), histSpendMicros: toMicros(s.histSpend ?? 0) }
    publishes.forEach((a, i) => {
      campaignRevisions.push({
        id: `${cmpId}:${i + 1}`, campaignId: cmpId, rev: i + 1, publishedBy: uidOf(a.actor), publishedByName: a.actor, at: iso(at(a.date, a.time, 5)),
        diff: i === 0 ? [] : [a.detail],
        snapshot: { name: c.name, objective: c.objective, team: c.team, flight: c.flight, priority: c.priority, creativeIds: c.creativeIds, targets: c.targets, constraints: c.constraints, budget: c.budget },
      })
    })
  })

  // ---------- events, audiences, budgets ----------
  const events: EventDefinition[] = EVENTS.map(([key, name, source, active, lastMin]) => ({
    key, name, source, active, lastSeenAt: lastMin == null ? null : iso(nowMs - lastMin * MIN), createdAt: iso(at(EVENTS_CREATED, "10:00")),
  }))
  const audiences: Audience[] = AUDIENCES.map((a) => {
    const t = at(a.created, "14:00")
    return {
      id: id("audience", a.id, t), name: a.name, rule: { event: a.event, withinDays: a.withinDays, exclude: a.exclude }, status: a.status,
      estimate: { size: a.size, at: iso(nowMs - 3 * HOUR) }, createdBy: uidOf(a.by), createdAt: iso(t), updatedAt: iso(t), rev: 0,
    }
  })
  const quarter = quarterOf(today)
  const budgets: TeamBudget[] = Object.entries(BUDGETS).map(([team, usd]) => ({
    team, quarter, amountMicros: toMicros(usd), updatedBy: uidOf("Nadia Rahman"), updatedAt: iso(Math.min(dayStart(quarterStart(quarter)).getTime() + 10 * HOUR, nowMs - HOUR)), rev: 0,
  }))

  // ---------- audit log ----------
  const nameOf: Record<string, string> = {}
  for (const c of CAMPAIGNS) nameOf[c.id] = c.name
  for (const c of CREATIVES) nameOf[c.id] = c.name
  for (const p of PROPS) nameOf[p[0]] = p[1]
  for (const m of TEAM) nameOf[m.id] = m.name
  const auditLog: AuditEntry[] = AUDIT.map((a, i) => {
    const t = at(a.date, a.time, AUDIT.length - i)
    return {
      id: mkId("auditLog", t), at: iso(t), actor: { id: a.actor === "System" ? null : uidOf(a.actor), name: a.actor }, action: a.action,
      target: { type: a.target.type, id: idMap[a.target.ref], name: nameOf[a.target.ref] }, detail: a.detail,
    }
  })

  const demo: Demo = {
    today, now: iso(nowMs), seed, users, countries, settings, properties, propertyKeys, placements, creatives, creativeVersions, campaigns, campaignRevisions,
    events, audiences, budgets, auditLog, alerts: [], idMap, sim,
  }
  refreshHealth(demo)
  demo.alerts = buildAlerts(demo, mkId)
  // The heartbeat alert surfaces in the activity feed as a system entry.
  for (const a of demo.alerts.filter((x) => x.type === "sdk_heartbeat_missing")) {
    const p = properties.find((x) => x.id === a.entity.id)!
    const t = Date.parse(a.firstSeenAt)
    demo.auditLog.push({ id: mkId("auditLog", t), at: iso(t), actor: { id: null, name: "System" }, action: "alert.opened", target: { type: "property", id: p.id, name: p.name }, detail: a.title })
  }
  demo.auditLog.sort((a, b) => (a.id < b.id ? -1 : 1))
  return demo
}

/** Recompute `campaigns[].health` with campaignHealth(), optionally with spend per campaign (micros). */
export function refreshHealth(demo: Pick<Demo, "campaigns" | "properties" | "placements" | "creatives" | "countries" | "now">, spentMicros: Record<string, number> = {}) {
  const ctx = {
    properties: Object.fromEntries(demo.properties.map((p) => [p.id, p])),
    placements: Object.fromEntries(demo.placements.map((p) => [p.id, p])),
    creatives: Object.fromEntries(demo.creatives.map((c) => [c.id, c])),
    countries: demo.countries,
  }
  for (const c of demo.campaigns) {
    const live = c.status !== "archived" && c.status !== "completed" && c.status !== "draft"
    c.health = { issues: live ? campaignHealth(c, ctx, spentMicros[c.id] ?? 0) : [], checkedAt: demo.now }
  }
}

function buildAlerts(demo: Demo, mkId: (k: IdKind, t: number) => string): DemoAlert[] {
  const nowMs = Date.parse(demo.now)
  const creatives = Object.fromEntries(demo.creatives.map((c) => [c.id, c]))
  const properties = Object.fromEntries(demo.properties.map((p) => [p.id, p]))
  const campaigns = Object.fromEntries(demo.campaigns.map((c) => [c.id, c]))
  const out: DemoAlert[] = []
  for (const a of deriveAlerts({ campaigns: demo.campaigns, creatives, properties, countries: demo.countries })) {
    let first = nowMs - 2 * HOUR
    if (a.type === "creative_rejected") first = Date.parse(creatives[a.entity.id].review.at ?? demo.now)
    if (a.type === "not_delivering") first = Math.max(Date.parse(campaigns[a.entity.id].publishedAt ?? demo.now), Date.parse(campaigns[a.entity.id].createdAt))
    if (a.type === "sdk_heartbeat_missing") first = Date.parse(properties[a.entity.id].sdk.lastHeartbeatAt ?? demo.now) + 15 * MIN
    if (a.type === "country_conflict") first = Date.parse(campaigns[a.entity.id].updatedAt)
    first = Math.min(first, nowMs - MIN)
    out.push({
      id: mkId("alert", first), type: a.type, severity: a.severity, entity: a.entity, status: "open", title: a.title, message: a.message, href: a.href,
      firstSeenAt: new Date(first).toISOString(), lastSeenAt: demo.now, resolvedAt: null, dedupeKey: a.dedupeKey,
    })
  }
  return out
}

function quarterStart(q: string) {
  const [y, n] = q.split("-Q").map(Number)
  return `${y}-${String((n - 1) * 3 + 1).padStart(2, "0")}-01`
}

function parseUtm(s: string | undefined) {
  const out = { source: "orbit", medium: "", campaign: "" }
  if (!s) return out
  for (const part of s.split("&")) {
    const [k, v = ""] = part.split("=")
    if (k === "utm_source") out.source = decodeURIComponent(v)
    if (k === "utm_medium") out.medium = decodeURIComponent(v)
    if (k === "utm_campaign") out.campaign = decodeURIComponent(v)
  }
  return out
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", webm: "video/webm" }

function assetsOf(s: CreativeSeed, cdn: string): Asset[] {
  const out: Asset[] = []
  if (s.file) {
    const ext = s.file.split(".").pop()!.toLowerCase()
    const mime = MIME[ext]
    if (mime) {
      const [w, h] = s.size.split("x").map(Number)
      const video = mime.startsWith("video/")
      out.push({
        kind: video ? "video" : "image", url: `${cdn}/${s.file}`, name: s.file, mime, bytes: (s.fileKb ?? 0) * 1024,
        width: Number.isFinite(w) ? w : null, height: Number.isFinite(h) ? h : null, durationSec: video ? (s.durationSec ?? null) : null, sha256: null,
      })
    }
  }
  if (s.icon) out.push({ kind: "icon", url: `${cdn}/${s.icon}`, name: s.icon, mime: "image/png", bytes: 9 * 1024, width: 128, height: 128, durationSec: null, sha256: null })
  return out
}
