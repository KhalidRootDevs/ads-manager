/**
 * Analytics queries (§6.5 QA–QD, §6.7, contract in packages/domain/src/analytics.ts).
 *
 * - Delivery metrics from `delivery_daily`, supply metrics (req/elig/err) from `supply_daily`. Supply rows have no
 *   campaign, creative or format dimension, so supply is only reported when every filter and the groupBy are in
 *   `SUPPLY_DIMENSIONS`; otherwise it is null and `supplyAvailable: false`.
 * - Both aggregations run in parallel and are merged here (no `$lookup` across rollups).
 * - Index choice per §6.5: campaign → `{c,d}`, property/placement → `{p,d}`, creative → `{cr,d}`, else `{d}`.
 * - Results are cached in Redis for 60 s, keyed by the normalised query (with the resolved date range).
 */
import {
  addDays, CAMPAIGN_STATUS_LABEL, dateKeyInTz, dateKeys, dayStart, daysBetween, deriveMetrics, DEVICE_CODE, DEVICE_FROM_CODE, DEVICE_LABEL, FORMAT_LABEL,
  PLATFORM_CODE, PLATFORM_FROM_CODE, PLATFORM_LABEL, REPORTING_TZ, SUPPLY_DIMENSIONS, todayKey, WEEKDAY_LABEL, weekdayOfKey,
  type AdFormat, type DeliveryResult, type Device, type Dimension, type FilterKey, type Filters, type HeatmapResult, type Metrics, type Platform, type RangeInput, type RawTotals, type Row,
} from "@orbit/domain"
import { trusted } from "@orbit/db"
import { badRequest } from "@orbit/server-kit"
import type { PipelineStage } from "mongoose"
import type { Deps } from "../../context"
import { cached } from "../../lib/cache"
import type { Lean } from "../../lib/types"
import type { AnalyticsRepo, Hint } from "./repo"

const CACHE_TTL_SEC = 60
const MAX_RANGE_DAYS = 400

export interface DeliveryQueryIn {
  range: RangeInput
  compare: "previous_period" | null
  filters: Filters
  groupBy: Dimension | null
  limit: number
}

interface Range {
  from: string
  to: string
}

const GROUP_FIELD: Record<Dimension, string> = {
  day: "$d", campaign: "$c", property: "$p", placement: "$pl", creative: "$cr", country: "$cc", region: "$cc", format: "$f", platform: "$pf", device: "$dv",
}
const DELIVERY_SUMS = { imp: { $sum: "$m.imp" }, view: { $sum: "$m.view" }, clk: { $sum: "$m.clk" }, vs: { $sum: "$m.vs" }, vc: { $sum: "$m.vc" }, conv: { $sum: "$m.conv" }, cost: { $sum: "$m.costMicros" } }
const SUPPLY_SUMS = { req: { $sum: "$m.req" }, elig: { $sum: "$m.elig" }, err: { $sum: "$m.err" } }

interface DeliveryAgg { _id: unknown; imp: number; view: number; clk: number; vs: number; vc: number; conv: number; cost: unknown }
interface SupplyAgg { _id: unknown; req: number; elig: number; err: number }

const n = (v: unknown) => (v == null ? 0 : Number(v))
const active = (f: Filters) => (Object.entries(f) as [FilterKey, string[] | undefined][]).filter(([, v]) => v && v.length) as [FilterKey, string[]][]

export function resolveRange(r: RangeInput, now: Date): Range {
  if ("days" in r) {
    const to = todayKey(REPORTING_TZ, now)
    return { from: addDays(to, -(r.days - 1)), to }
  }
  if (r.from > r.to) throw badRequest("The range must start on or before its end.", [{ path: "range.from", message: "After range.to" }])
  if (daysBetween(r.from, r.to) + 1 > MAX_RANGE_DAYS) throw badRequest(`Ranges are limited to ${MAX_RANGE_DAYS} days.`, [{ path: "range", message: "Too long" }])
  return { from: r.from, to: r.to }
}

export function previousRange(r: Range): Range {
  const len = daysBetween(r.from, r.to) + 1
  const to = addDays(r.from, -1)
  return { from: addDays(to, -(len - 1)), to }
}

/** Supply metrics exist only for supply dimensions. */
export function supplyAvailable(filters: Filters, groupBy: Dimension | null) {
  return active(filters).every(([k]) => SUPPLY_DIMENSIONS.includes(k)) && (groupBy == null || SUPPLY_DIMENSIONS.includes(groupBy))
}

const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}` // spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const CSV_COLUMNS = ["key", "label", "sub", "req", "elig", "err", "imp", "view", "clk", "vs", "vc", "conv", "cost", "ctr", "fill", "ecpm", "vcr", "viewRate", "share"] as const

export function analyticsService(deps: Pick<Deps, "redis" | "env" | "log" | "now">, repo: AnalyticsRepo) {
  let regionCache: { at: number; byCode: Map<string, Lean>; byRegion: Map<string, string[]> } | null = null
  async function countryMaps() {
    if (!regionCache || Date.now() - regionCache.at > 60_000) {
      const rows = await repo.countries()
      const byRegion = new Map<string, string[]>()
      for (const c of rows) byRegion.set(c.region, [...(byRegion.get(c.region) ?? []), c._id])
      regionCache = { at: Date.now(), byCode: new Map(rows.map((c) => [c._id as string, c])), byRegion }
    }
    return regionCache
  }

  /** `$match` with real Date bounds (aggregate() doesn't cast) and the hint for the chosen index. */
  async function matchFor(range: Range, filters: Filters, kind: "delivery" | "supply"): Promise<{ match: Lean; hint: Hint }> {
    const match: Lean = { d: trusted({ $gte: dayStart(range.from), $lt: dayStart(addDays(range.to, 1)) }) }
    const f = Object.fromEntries(active(filters)) as Partial<Record<FilterKey, string[]>>
    const $in = (xs: string[]) => trusted({ $in: [...new Set(xs)] })
    if (f.campaign && kind === "delivery") match.c = $in(f.campaign)
    if (f.property) match.p = $in(f.property)
    if (f.placement) match.pl = $in(f.placement)
    if (f.creative && kind === "delivery") match.cr = $in(f.creative)
    if (f.format && kind === "delivery") match.f = $in(f.format)
    if (f.platform) match.pf = $in(f.platform.map((x) => PLATFORM_CODE[x as Platform] ?? x))
    if (f.device) match.dv = $in(f.device.map((x) => DEVICE_CODE[x as Device] ?? x))
    let cc: string[] | null = f.country ? f.country.map((x) => x.toUpperCase()) : null
    if (f.region) {
      const { byRegion } = await countryMaps()
      const inRegions = new Set(f.region.flatMap((r) => byRegion.get(r) ?? []))
      cc = cc ? cc.filter((x) => inRegions.has(x)) : [...inRegions]
    }
    if (cc) match.cc = $in(cc)
    const hint: Hint = kind === "delivery" ? (match.c ? { c: 1, d: 1 } : match.p ? { p: 1, d: 1 } : match.cr ? { cr: 1, d: 1 } : { d: 1 }) : match.p ? { p: 1, d: 1 } : { d: 1 }
    return { match, hint }
  }

  /** Grouped raw sums keyed by the dimension value (region keys are mapped after grouping by country). */
  async function grouped(range: Range, filters: Filters, groupBy: Dimension | null, withSupply: boolean) {
    const id = groupBy ? GROUP_FIELD[groupBy] : null
    const dm = await matchFor(range, filters, "delivery")
    const sm = withSupply ? await matchFor(range, filters, "supply") : null
    const [del, sup] = await Promise.all([
      repo.delivery<DeliveryAgg>([{ $match: dm.match }, { $group: { _id: id, ...DELIVERY_SUMS } }] as PipelineStage[], dm.hint),
      sm ? repo.supply<SupplyAgg>([{ $match: sm.match }, { $group: { _id: id, ...SUPPLY_SUMS } }] as PipelineStage[], sm.hint) : Promise.resolve(null),
    ])
    const keyOf = async (raw: unknown): Promise<string> => {
      if (groupBy === "day") return dateKeyInTz(raw as Date, REPORTING_TZ)
      if (groupBy === "region") return ((await countryMaps()).byCode.get(String(raw))?.region as string) ?? "Other"
      if (groupBy === "platform") return PLATFORM_FROM_CODE[String(raw)] ?? String(raw)
      if (groupBy === "device") return DEVICE_FROM_CODE[String(raw)] ?? String(raw)
      return raw == null ? "total" : String(raw)
    }
    const out = new Map<string, RawTotals>()
    const get = (k: string) => {
      let t = out.get(k)
      if (!t) out.set(k, (t = { req: withSupply ? 0 : null, elig: withSupply ? 0 : null, err: withSupply ? 0 : null, imp: 0, view: 0, clk: 0, vs: 0, vc: 0, conv: 0, costMicros: 0 }))
      return t
    }
    for (const r of del) {
      const t = get(await keyOf(r._id))
      t.imp += n(r.imp); t.view += n(r.view); t.clk += n(r.clk); t.vs += n(r.vs); t.vc += n(r.vc); t.conv += n(r.conv); t.costMicros += n(r.cost)
    }
    for (const r of sup ?? []) {
      const t = get(await keyOf(r._id))
      t.req = (t.req ?? 0) + n(r.req); t.elig = (t.elig ?? 0) + n(r.elig); t.err = (t.err ?? 0) + n(r.err)
    }
    return out
  }

  const sum = (rows: Iterable<RawTotals>, withSupply: boolean): RawTotals => {
    const t: RawTotals = { req: withSupply ? 0 : null, elig: withSupply ? 0 : null, err: withSupply ? 0 : null, imp: 0, view: 0, clk: 0, vs: 0, vc: 0, conv: 0, costMicros: 0 }
    for (const r of rows) {
      if (withSupply) { t.req! += r.req ?? 0; t.elig! += r.elig ?? 0; t.err! += r.err ?? 0 }
      t.imp += r.imp; t.view += r.view; t.clk += r.clk; t.vs += r.vs; t.vc += r.vc; t.conv += r.conv; t.costMicros += r.costMicros
    }
    return t
  }

  /** Labels, subtitles and links for grouped rows. */
  async function labels(groupBy: Dimension, keys: string[]): Promise<Map<string, { label: string; sub: string | null; href: string | null }>> {
    const out = new Map<string, { label: string; sub: string | null; href: string | null }>()
    const byId = (rows: Lean[]) => new Map(rows.map((r) => [r._id as string, r]))
    if (groupBy === "campaign") {
      const m = byId(await repo.campaignNames(keys))
      for (const k of keys) out.set(k, { label: m.get(k)?.name ?? k, sub: m.get(k) ? CAMPAIGN_STATUS_LABEL[m.get(k)!.status as keyof typeof CAMPAIGN_STATUS_LABEL] : null, href: `/campaigns/${k}` })
    } else if (groupBy === "property") {
      const m = byId(await repo.propertyNames(keys))
      for (const k of keys) out.set(k, { label: m.get(k)?.name ?? k, sub: m.get(k) ? PLATFORM_LABEL[m.get(k)!.platform as Platform] : null, href: `/properties/${k}` })
    } else if (groupBy === "placement") {
      const m = byId(await repo.placementNames(keys))
      const props = byId(await repo.propertyNames([...new Set([...m.values()].map((p) => p.propertyId as string))]))
      for (const k of keys) out.set(k, { label: m.get(k)?.name ?? k, sub: props.get(m.get(k)?.propertyId)?.name ?? null, href: `/placements/${k}` })
    } else if (groupBy === "creative") {
      const m = byId(await repo.creativeNames(keys))
      for (const k of keys) out.set(k, { label: m.get(k)?.name ?? k, sub: m.get(k) ? FORMAT_LABEL[m.get(k)!.format as AdFormat] : null, href: `/creatives/${k}` })
    } else if (groupBy === "country") {
      const { byCode } = await countryMaps()
      for (const k of keys) out.set(k, { label: byCode.get(k)?.name ?? k, sub: byCode.get(k)?.region ?? null, href: null })
    } else if (groupBy === "day") {
      for (const k of keys) out.set(k, { label: new Date(`${k}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), sub: WEEKDAY_LABEL[weekdayOfKey(k)], href: null })
    } else {
      const L: Record<string, string> = groupBy === "format" ? FORMAT_LABEL : groupBy === "platform" ? PLATFORM_LABEL : groupBy === "device" ? DEVICE_LABEL : {}
      for (const k of keys) out.set(k, { label: L[k] ?? k, sub: null, href: null })
    }
    return out
  }

  async function computeDelivery(q: DeliveryQueryIn, range: Range): Promise<DeliveryResult> {
    const withSupply = supplyAvailable(q.filters, q.groupBy)
    const prevRange = q.compare === "previous_period" ? previousRange(range) : null
    const [cur, prev] = await Promise.all([grouped(range, q.filters, q.groupBy, withSupply), prevRange ? grouped(prevRange, q.filters, null, withSupply) : Promise.resolve(null)])
    const totalsRaw = sum(cur.values(), withSupply)
    const totals = deriveMetrics(totalsRaw)
    let rows: Row[] = []
    if (q.groupBy) {
      let keys = [...cur.keys()]
      if (q.groupBy === "day") {
        keys = dateKeys(range.from, range.to)
        for (const k of keys) if (!cur.has(k)) cur.set(k, sum([], withSupply))
      } else {
        keys.sort((a, b) => cur.get(b)!.imp - cur.get(a)!.imp || (cur.get(b)!.req ?? 0) - (cur.get(a)!.req ?? 0) || a.localeCompare(b))
        keys = keys.slice(0, q.limit)
      }
      const lab = await labels(q.groupBy, keys)
      rows = keys.map((k) => ({ key: k, ...lab.get(k)!, ...deriveMetrics(cur.get(k)!), share: totalsRaw.imp ? cur.get(k)!.imp / totalsRaw.imp : 0 }))
    }
    return {
      range, previousRange: prevRange, supplyAvailable: withSupply, totals,
      previous: prev ? deriveMetrics(sum(prev.values(), withSupply)) : null,
      rows,
    }
  }

  return {
    async delivery(q: DeliveryQueryIn): Promise<DeliveryResult> {
      const range = resolveRange(q.range, deps.now())
      return cached(deps, "delivery", { ...q, range }, CACHE_TTL_SEC, () => computeDelivery(q, range))
    },

    /** Weekday × hour (reporting time zone) from the `h.imp` / `h.clk` arrays (§6.7). */
    async heatmap(q: { range: RangeInput; filters: Filters; metric: "imp" | "clk" }): Promise<HeatmapResult> {
      const range = resolveRange(q.range, deps.now())
      return cached(deps, "heatmap", { ...q, range }, CACHE_TTL_SEC, async () => {
        const { match, hint } = await matchFor(range, q.filters, "delivery")
        const rows = await repo.delivery<{ _id: { wd: number; hour: number }; v: number }>(
          [
            { $match: match },
            { $project: { wd: { $isoDayOfWeek: { date: "$d", timezone: REPORTING_TZ } }, h: `$h.${q.metric}` } },
            { $unwind: { path: "$h", includeArrayIndex: "hour" } },
            { $group: { _id: { wd: "$wd", hour: "$hour" }, v: { $sum: "$h" } } },
          ] as PipelineStage[],
          hint,
        )
        const matrix = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
        for (const r of rows) if (r._id.wd >= 1 && r._id.wd <= 7 && r._id.hour >= 0 && r._id.hour < 24) matrix[r._id.wd - 1][r._id.hour] += n(r.v)
        return { matrix, tz: REPORTING_TZ }
      })
    },

    /** No-fill reasons (sum of `m.nf.*`) and the worst latency percentiles (percentiles can't be summed; §6.5). */
    async noFill(q: { range: RangeInput; filters: Filters }) {
      const range = resolveRange(q.range, deps.now())
      return cached(deps, "nofill", { ...q, range }, CACHE_TTL_SEC, async () => {
        if (!supplyAvailable(q.filters, null)) return { reasons: [], latencyP50: null, latencyP99: null }
        const { match, hint } = await matchFor(range, q.filters, "supply")
        const [reasons, lat] = await Promise.all([
          repo.supply<{ _id: string; count: number }>(
            [{ $match: match }, { $project: { nf: { $objectToArray: { $ifNull: ["$m.nf", {}] } } } }, { $unwind: "$nf" }, { $group: { _id: "$nf.k", count: { $sum: "$nf.v" } } }, { $sort: { count: -1 } }] as PipelineStage[],
            hint,
          ),
          repo.supply<{ p50: number | null; p99: number | null }>([{ $match: match }, { $group: { _id: null, p50: { $max: "$m.latP50" }, p99: { $max: "$m.latP99" } } }] as PipelineStage[], hint),
        ])
        return { reasons: reasons.filter((r) => n(r.count) > 0).map((r) => ({ reason: r._id, count: n(r.count) })), latencyP50: lat[0]?.p50 ?? null, latencyP99: lat[0]?.p99 ?? null }
      })
    },

    /** CSV rows (header first). The controller streams them. */
    async csv(q: DeliveryQueryIn): Promise<{ filename: string; lines: string[] }> {
      const r = await this.delivery(q)
      const rows: (Partial<Row> & Metrics)[] = r.rows.length ? r.rows : [{ key: "total", label: "Total", sub: null, share: 1, ...r.totals }]
      const lines = [CSV_COLUMNS.join(","), ...rows.map((row) => CSV_COLUMNS.map((c) => csvCell(row[c as keyof typeof row])).join(","))]
      return { filename: `orbit-${q.groupBy ?? "totals"}-${r.range.from}-to-${r.range.to}.csv`, lines }
    },
  }
}
export type AnalyticsService = ReturnType<typeof analyticsService>
