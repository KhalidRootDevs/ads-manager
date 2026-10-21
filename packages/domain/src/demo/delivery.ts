/**
 * Demo analytics: `delivery_daily`, `supply_daily`, `campaign_stats` and `request_samples` documents, ported from the
 * prototype's `genFacts()` volume model (property scale × campaign scale × country rank × device mix × weekend uplift,
 * format CTR / eCPM from FORMAT_META) and its HOUR_PROFILE time-of-day curves.
 *
 * Differences from the prototype, on purpose:
 * - Requests, eligibility, errors and no-fill reasons are supply metrics: they live in supply rows without campaign
 *   or creative (guideline §6.5). Supply `fill` equals the sum of delivered impressions of the same grain.
 * - Placements that no campaign uses still receive (unfilled) requests, so fill rate and no-fill reasons look real.
 * - "Today" is partial: hours after `now` (Asia/Dhaka) are empty instead of a flat 42 % factor. Heartbeat-missing
 *   properties stop sending traffic at their last heartbeat.
 * - Volume is bounded by the prototype's own reductions (≤ 6 countries per target, devices per platform), giving
 *   a few thousand delivery and ~20–30 k supply documents for 60 days.
 * Browser-safe: plain numbers (micros) and Dates; the db seed converts money to BSON Long.
 */
import { DEVICE_CODE, PLATFORM_CODE, type Device, type Platform, type Weekday } from "../enums"
import { FORMAT_META } from "../formats"
import { availSet, compat, finalCountries } from "../rules/targeting"
import type { CampaignStats, RequestSample } from "../schemas"
import { addDays, compactKey, dayStart, daysBetween, weekdayOfKey } from "../time"
import type { Demo } from "./build"
import { rng } from "./random"

const HOUR = 3_600_000

// ---------- time-of-day model (prototype analytics.ts) ----------
const curve = (peaks: [number, number, number][]) =>
  Array.from({ length: 24 }, (_, h) => 0.08 + peaks.reduce((a, [c, w, amp]) => a + amp * Math.exp(-((h - c) ** 2) / (2 * w * w)), 0))
/** Relative traffic per hour of day (Asia/Dhaka) by platform. */
export const HOUR_PROFILE: Record<Platform, number[]> = {
  android: curve([[8, 1.5, 0.45], [13, 1.8, 0.5], [21, 2.2, 1]]),
  ios: curve([[8, 1.5, 0.5], [13, 1.6, 0.45], [21, 2, 0.95]]),
  web: curve([[10, 2, 0.75], [14, 2.2, 0.8], [20, 2, 0.6]]),
}

/** Device mix per platform, restricted to the campaign's device targeting and renormalised. */
export const DEVICE_MIX: Record<Platform, [Device, number][]> = {
  web: [["desktop", 0.55], ["phone", 0.38], ["tablet", 0.07]],
  android: [["phone", 0.9], ["tablet", 0.1]],
  ios: [["phone", 0.84], ["tablet", 0.16]],
}
export function deviceSplit(platform: Platform, allowed?: Device[]): [Device, number][] {
  const mix = DEVICE_MIX[platform]
  const kept = allowed?.length ? mix.filter(([d]) => allowed.includes(d)) : mix
  const total = kept.reduce((a, [, w]) => a + w, 0)
  return total ? kept.map(([d, w]) => [d, w / total]) : []
}

/** Country rank weights (top country first), as in the prototype. */
const RANK_W = [1, 0.62, 0.41, 0.28, 0.2, 0.14]
/** Bangladesh / GCC weekend. */
const WEEKEND: Weekday[] = ["fri", "sat"]

/** Split an integer total over weights with the largest-remainder method (the parts sum exactly to `total`). */
export function distribute(total: number, weights: number[]): number[] {
  const out = weights.map(() => 0)
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!total) return out
  if (!sum) {
    out[0] = total
    return out
  }
  const raw = weights.map((w) => (total * w) / sum)
  let left = total
  raw.forEach((x, i) => {
    out[i] = Math.floor(x)
    left -= out[i]
  })
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; k < left; k++) out[order[k % order.length][1]] += 1
  return out
}

// ---------- document shapes ----------
export interface DeliveryDailyRow {
  _id: string
  d: Date
  c: string
  p: string
  pl: string
  cr: string
  cc: string
  dv: "ph" | "tb" | "dt"
  pf: "an" | "io" | "wb"
  f: string
  m: { imp: number; view: number; clk: number; vs: number; vc: number; rw: number; conv: number; costMicros: number }
  h: { imp: number[]; clk: number[] }
}

export interface SupplyDailyRow {
  _id: string
  d: Date
  p: string
  pl: string
  cc: string
  dv: "ph" | "tb" | "dt"
  pf: "an" | "io" | "wb"
  m: { req: number; elig: number; fill: number; err: number; nf: Record<string, number>; latP50: number; latP99: number }
  h: { req: number[] }
}

export interface DeliveryOutput {
  delivery: DeliveryDailyRow[]
  supply: SupplyDailyRow[]
  stats: CampaignStats[]
  samples: RequestSample[]
}

export interface DeliveryOptions {
  /** Last (partial) reporting day; defaults to `demo.today`. */
  today?: string
  /** Number of days ending today (default 60). */
  days?: number
  /** Current instant; defaults to `demo.now`. Hours after it are empty. */
  now?: number
}

/** Same `_id` formulas as `deliveryId` / `supplyId` in @orbit/db (kept here so this module stays browser-safe). */
const dId = (day: string, c: string, p: string, pl: string, cr: string, cc: string, dv: string) => [compactKey(day), c, p, pl, cr, cc, dv].join("|")
const sId = (day: string, p: string, pl: string, cc: string, dv: string) => [compactKey(day), p, pl, cc, dv].join("|")

export function generateDelivery(demo: Demo, opts: DeliveryOptions = {}): DeliveryOutput {
  const today = opts.today ?? demo.today
  const N = opts.days ?? 60
  const nowMs = opts.now ?? Date.parse(demo.now)
  const key0 = addDays(today, -(N - 1))
  const dayKeys = Array.from({ length: N }, (_, i) => addDays(key0, i))
  const dayStarts = dayKeys.map((k) => dayStart(k).getTime())

  const props = Object.fromEntries(demo.properties.map((p) => [p.id, p]))
  const placements = Object.fromEntries(demo.placements.map((p) => [p.id, p]))
  const creatives = Object.fromEntries(demo.creatives.map((c) => [c.id, c]))

  /** Traffic stops at `now`, and at the last heartbeat for properties whose heartbeat is missing. */
  const limitOf = (pid: string) => {
    const p = props[pid]
    const hb = p.sdk.state === "heartbeat_missing" && p.sdk.lastHeartbeatAt ? Date.parse(p.sdk.lastHeartbeatAt) : Infinity
    return Math.min(nowMs, hb)
  }
  const fracCache = new Map<string, number[]>()
  /** Fraction of each hour of day `i` that is in the past for property `pid`. */
  const fracs = (i: number, pid: string) => {
    const k = `${i}|${pid}`
    let f = fracCache.get(k)
    if (!f) {
      const lim = limitOf(pid)
      f = Array.from({ length: 24 }, (_, h) => Math.max(0, Math.min(1, (lim - (dayStarts[i] + h * HOUR)) / HOUR)))
      fracCache.set(k, f)
    }
    return f
  }
  const hourWeights = (platform: Platform, f: number[]) => HOUR_PROFILE[platform].map((w, h) => w * f[h])
  const profTotal = (platform: Platform) => HOUR_PROFILE[platform].reduce((a, b) => a + b, 0)
  const weekend = (i: number) => (WEEKEND.includes(weekdayOfKey(dayKeys[i])) ? 1.14 : 1)

  // ---------- delivery (genFacts) ----------
  const delivery: DeliveryDailyRow[] = []
  /** delivered impressions per supply grain */
  const filled = new Map<string, number>()
  /** delivered countries per day × placement */
  const delivCountries = new Map<string, Set<string>>()
  const lifetime = new Map<string, { imp: number; clk: number; conv: number; costMicros: number }>()
  const todayAgg = new Map<string, { imp: number; clk: number; conv: number; costMicros: number }>()
  const rv = rng(demo.seed * 104_729 + 3)

  for (const c of demo.campaigns) {
    if (!["active", "paused", "completed"].includes(c.status)) continue
    const s = demo.sim.campaigns[c.id]
    const r = rng(42 + s.index * 13)
    const from = Math.max(0, daysBetween(key0, c.flight.start))
    const to = Math.min(N - 1, daysBetween(key0, c.flight.end), s.stopKey ? daysBetween(key0, s.stopKey) : N - 1)
    if (from > to) continue
    const crs = c.creativeIds.map((id) => creatives[id]).filter((cr) => cr && (cr.status === "ready" || s.stopKey != null))
    for (const t of c.targets) {
      const p = props[t.propertyId]
      if (!p || p.sdk.state === "not_integrated") continue
      const ps = demo.sim.properties[p.id]
      const fin = finalCountries(t.countryRule, p.countryRule, demo.countries)
      const devices = deviceSplit(p.platform, c.constraints.devices)
      const ctry = (t.countryRule.mode === "include" ? fin : ps.top.filter((x) => fin.includes(x))).slice(0, 6)
      for (const plId of t.placementIds) {
        const pl = placements[plId]
        if (!pl) continue
        for (const cr of crs) {
          if (!compat(cr, pl).ok) continue
          const fm = FORMAT_META[cr.format]
          const vid = cr.format === "video" || cr.format === "rewarded_video"
          ctry.forEach((cc, ci) => {
            const w = RANK_W[ci]
            for (let i = from; i <= to; i++) {
              const f = fracs(i, p.id)
              const hw = hourWeights(p.platform, f)
              const share = hw.reduce((a, b) => a + b, 0) / profTotal(p.platform)
              const day = weekend(i) * share
              const req = Math.round(s.scale * ps.scale * w * day * 5200 * (0.85 + r() * 0.3))
              const elig = Math.round(req * (0.9 + r() * 0.06))
              const imp = Math.round(elig * (0.8 + r() * 0.15))
              const clk = Math.round(imp * fm.ctr * (0.8 + r() * 0.4))
              const vs = vid ? imp : 0
              const vc = vid ? Math.round(vs * (cr.format === "rewarded_video" ? 0.82 : 0.58) * (0.95 + r() * 0.08)) : 0
              const conv = Math.round(clk * (c.objective === "conversion" ? 0.085 : 0.03) * (0.7 + r() * 0.6))
              const cost = (imp / 1000) * fm.ecpm * (0.9 + r() * 0.2)
              r() // the prototype's error draw: errors are supply metrics here
              if (!share) continue
              for (const [dv, sh] of devices) {
                const dImp = Math.round(imp * sh)
                if (!dImp) continue
                const dClk = Math.min(dImp, Math.round(clk * sh * (dv === "desktop" ? 0.8 : 1)))
                const dVs = Math.round(vs * sh)
                const dVc = Math.min(dVs, Math.round(vc * sh))
                const dConv = Math.min(dClk, Math.round(conv * sh * (dv === "desktop" ? 1.25 : 1)))
                const costMicros = Math.round(cost * sh * 1_000_000)
                const dvc = DEVICE_CODE[dv]
                const row: DeliveryDailyRow = {
                  _id: dId(dayKeys[i], c.id, p.id, pl.id, cr.id, cc, dvc), d: new Date(dayStarts[i]), c: c.id, p: p.id, pl: pl.id, cr: cr.id, cc, dv: dvc, pf: PLATFORM_CODE[p.platform], f: cr.format,
                  m: { imp: dImp, view: Math.round(dImp * ((vid ? 0.86 : 0.66) + rv() * 0.12)), clk: dClk, vs: dVs, vc: dVc, rw: cr.format === "rewarded_video" ? dVc : 0, conv: dConv, costMicros },
                  h: { imp: distribute(dImp, hw), clk: distribute(dClk, hw) },
                }
                delivery.push(row)
                const sk = sId(dayKeys[i], p.id, pl.id, cc, dvc)
                filled.set(sk, (filled.get(sk) ?? 0) + dImp)
                const dk = `${i}|${pl.id}`
                if (!delivCountries.has(dk)) delivCountries.set(dk, new Set())
                delivCountries.get(dk)!.add(cc)
                add(lifetime, c.id, dImp, dClk, dConv, costMicros)
                if (i === N - 1) add(todayAgg, c.id, dImp, dClk, dConv, costMicros)
              }
            }
          })
        }
      }
    }
  }

  // ---------- supply ----------
  const supply: SupplyDailyRow[] = []
  const rs = rng(demo.seed * 7_919 + 11)
  const usedPlacements = new Set(demo.campaigns.filter((c) => c.status === "active" || c.status === "paused").flatMap((c) => c.targets.flatMap((t) => t.placementIds)))
  for (const pl of demo.placements) {
    const p = props[pl.propertyId]
    if (!p || p.sdk.state === "not_integrated" || p.status === "pending") continue
    const ps = demo.sim.properties[p.id]
    const av = availSet(p.countryRule, demo.countries)
    const base = ps.top.filter((x) => av.has(x)).slice(0, 5)
    const degraded = p.sdk.state === "degraded"
    const pf = PLATFORM_CODE[p.platform]
    for (let i = 0; i < N; i++) {
      const f = fracs(i, p.id)
      const hw = hourWeights(p.platform, f)
      const share = hw.reduce((a, b) => a + b, 0) / profTotal(p.platform)
      if (!share) continue
      const ccs = [...new Set([...base, ...(delivCountries.get(`${i}|${pl.id}`) ?? [])])]
      for (const cc of ccs) {
        const rank = ps.top.indexOf(cc)
        const w = rank >= 0 ? RANK_W[rank] : 0.1
        for (const [dv, sh] of deviceSplit(p.platform)) {
          const dvc = DEVICE_CODE[dv]
          const _id = sId(dayKeys[i], p.id, pl.id, cc, dvc)
          const fill = filled.get(_id) ?? 0
          const baseline = ps.scale * w * weekend(i) * share * 2600 * sh * (0.85 + rs() * 0.3)
          const req = fill > 0 ? Math.max(fill + 1, Math.round(fill / (0.74 + rs() * 0.14))) : Math.round(baseline)
          if (!req) continue
          const err = Math.min(req - fill, Math.round(req * (degraded ? 0.02 : 0.003) * rs() * 2))
          const rest = req - fill - err
          const elig = fill > 0 ? fill + Math.round(rest * (0.25 + rs() * 0.25)) : 0
          const nf: Record<string, number> = {}
          const put = (k: string, n: number) => {
            if (n > 0) nf[k] = (nf[k] ?? 0) + n
          }
          // eligible but not served: frequency caps and pacing
          const capped = Math.round((elig - fill) * 0.7)
          put("capped", capped)
          put("paced", elig - fill - capped)
          // not eligible
          const notElig = req - err - elig
          if (pl.status === "paused") put("paused_placement", notElig)
          else if (!fill || !usedPlacements.has(pl.id)) put("no_candidates", notElig)
          else {
            const nc = Math.round(notElig * 0.7)
            put("no_candidates", nc)
            put("app_version", notElig - nc)
          }
          supply.push({
            _id, d: new Date(dayStarts[i]), p: p.id, pl: pl.id, cc, dv: dvc, pf,
            m: {
              req, elig, fill, err, nf,
              latP50: Math.round((degraded ? 85 : 38) + rs() * 30),
              latP99: Math.round(degraded ? 1600 + rs() * 600 : 140 + rs() * 90),
            },
            h: { req: distribute(req, hw) },
          })
        }
      }
    }
  }

  // ---------- campaign_stats ----------
  const nowIso = new Date(nowMs).toISOString()
  const stats: CampaignStats[] = demo.campaigns
    .filter((c) => c.status !== "draft")
    .map((c) => {
      const l = { ...(lifetime.get(c.id) ?? zero()) }
      const hist = demo.sim.campaigns[c.id].histSpendMicros
      if (hist) {
        // Spend before the generated window, converted back to counts with the creative's format benchmarks.
        const fm = FORMAT_META[creatives[c.creativeIds[0]]?.format ?? "banner"]
        const imp = Math.round((hist / 1_000_000 / fm.ecpm) * 1000)
        const clk = Math.round(imp * fm.ctr)
        l.imp += imp
        l.clk += clk
        l.conv += Math.round(clk * (c.objective === "conversion" ? 0.085 : 0.03))
        l.costMicros += hist
      }
      const t = todayAgg.get(c.id) ?? zero()
      return { campaignId: c.id, lifetime: l, today: { d: today, ...t }, updatedAt: nowIso }
    })

  // ---------- request_samples (last 24 h) ----------
  const samples: RequestSample[] = []
  const rq = rng(demo.seed * 6_151 + 29)
  for (const p of demo.properties) {
    if (p.sdk.state === "not_integrated" || p.status === "pending") continue
    const pls = demo.placements.filter((x) => x.propertyId === p.id)
    if (!pls.length) continue
    const top = demo.sim.properties[p.id].top
    const lim = limitOf(p.id)
    const from = nowMs - 24 * HOUR
    if (lim <= from) continue
    const degraded = p.sdk.state === "degraded"
    const results = degraded ? ["200", "200", "204", "408", "200", "500"] : ["200", "200", "200", "204", "200"]
    const n = degraded ? 30 : 24
    for (let k = 0; k < n; k++) {
      const pl = pls[Math.floor(rq() * pls.length)]
      const result = pl.status === "paused" ? "204" : results[Math.floor(rq() * results.length)]
      samples.push({
        at: new Date(Math.floor(from + rq() * (lim - from))).toISOString(), propertyId: p.id, placementId: pl.id, placementName: pl.name,
        country: top[Math.floor(rq() * top.length)], result, latencyMs: result === "408" ? 2000 : Math.round(38 + rq() * 140), sdk: p.sdk.version,
      })
    }
  }
  samples.sort((a, b) => (a.at < b.at ? -1 : 1))

  return { delivery, supply, stats, samples }
}

function zero() {
  return { imp: 0, clk: 0, conv: 0, costMicros: 0 }
}
function add(m: Map<string, ReturnType<typeof zero>>, k: string, imp: number, clk: number, conv: number, cost: number) {
  const x = m.get(k) ?? zero()
  x.imp += imp
  x.clk += clk
  x.conv += conv
  x.costMicros += cost
  m.set(k, x)
}

/** Lifetime spend per campaign (micros) from generated stats, for `refreshHealth()`. */
export function spentByCampaign(stats: CampaignStats[]): Record<string, number> {
  return Object.fromEntries(stats.map((s) => [s.campaignId, s.lifetime.costMicros]))
}
