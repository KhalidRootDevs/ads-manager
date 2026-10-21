/**
 * Analytics contract (guideline §7.2, DATA_MODEL.md §4) and the canonical metric catalogue.
 *
 * Delivery metrics (impressions, clicks, video, conversions, spend) come from `delivery_daily`.
 * Supply metrics (requests, eligible, errors, fill) come from `supply_daily`, which has no campaign,
 * creative or format dimension. When a query filters or groups by one of those, supply metrics are `null`.
 */
import { z } from "zod"
import { zDateKey } from "./schemas"

export const DIMENSIONS = ["day", "campaign", "property", "placement", "creative", "country", "region", "format", "platform", "device"] as const
export type Dimension = (typeof DIMENSIONS)[number]
export const FILTER_KEYS = ["campaign", "property", "placement", "creative", "country", "region", "format", "platform", "device"] as const
export type FilterKey = (typeof FILTER_KEYS)[number]
/** Dimensions that exist on supply rows. Filtering or grouping by anything else makes supply metrics unavailable. */
export const SUPPLY_DIMENSIONS: Dimension[] = ["day", "property", "placement", "country", "region", "platform", "device"]

export const zRange = z.union([
  z.object({ days: z.number().int().min(1).max(400) }),
  z.object({ from: zDateKey, to: zDateKey }),
])
export type RangeInput = z.infer<typeof zRange>

export const zFilters = z.partialRecord(z.enum(FILTER_KEYS), z.array(z.string().max(60)).max(200))
export type Filters = z.infer<typeof zFilters>

export const zDeliveryQuery = z.strictObject({
  range: zRange,
  compare: z.enum(["previous_period"]).nullable().default(null),
  filters: zFilters.default({}),
  groupBy: z.enum(DIMENSIONS).nullable().default(null),
  limit: z.number().int().min(1).max(500).default(100),
})
export type DeliveryQuery = z.input<typeof zDeliveryQuery>

export const zMetrics = z.object({
  req: z.number().nullable(), elig: z.number().nullable(), err: z.number().nullable(),
  imp: z.number(), view: z.number(), clk: z.number(), vs: z.number(), vc: z.number(), conv: z.number(),
  /** USD (derived from micros at the API edge; reporting only). */
  cost: z.number(),
  ctr: z.number(), fill: z.number().nullable(), ecpm: z.number(), vcr: z.number(), viewRate: z.number(),
})
export type Metrics = z.infer<typeof zMetrics>

export const zRow = zMetrics.extend({ key: z.string(), label: z.string(), sub: z.string().nullable(), href: z.string().nullable(), share: z.number() })
export type Row = z.infer<typeof zRow>

export const zDeliveryResult = z.object({
  range: z.object({ from: zDateKey, to: zDateKey }),
  previousRange: z.object({ from: zDateKey, to: zDateKey }).nullable(),
  supplyAvailable: z.boolean(),
  totals: zMetrics,
  previous: zMetrics.nullable(),
  rows: z.array(zRow),
})
export type DeliveryResult = z.infer<typeof zDeliveryResult>

export const zHeatmapQuery = z.strictObject({ range: zRange, filters: zFilters.default({}), metric: z.enum(["imp", "clk"]).default("imp") })
/** 7 × 24 matrix, rows Monday→Sunday, columns hour 0–23 in the reporting time zone. */
export const zHeatmapResult = z.object({ matrix: z.array(z.array(z.number())), tz: z.string() })
export type HeatmapResult = z.infer<typeof zHeatmapResult>

export const zNoFillQuery = z.strictObject({ range: zRange, filters: zFilters.default({}) })
export const zNoFillResult = z.object({ reasons: z.array(z.object({ reason: z.string(), count: z.number() })), latencyP50: z.number().nullable(), latencyP99: z.number().nullable() })

// ---------- metric maths ----------
export interface RawTotals {
  req: number | null
  elig: number | null
  err: number | null
  imp: number
  view: number
  clk: number
  vs: number
  vc: number
  conv: number
  costMicros: number
}

export const EMPTY_TOTALS: RawTotals = { req: 0, elig: 0, err: 0, imp: 0, view: 0, clk: 0, vs: 0, vc: 0, conv: 0, costMicros: 0 }

/** Raw sums → derived metrics. Ratios are never stored (DATA_MODEL.md §3). */
export function deriveMetrics(t: RawTotals): Metrics {
  const cost = t.costMicros / 1_000_000
  return {
    req: t.req, elig: t.elig, err: t.err, imp: t.imp, view: t.view, clk: t.clk, vs: t.vs, vc: t.vc, conv: t.conv, cost,
    ctr: t.imp ? t.clk / t.imp : 0,
    fill: t.req == null ? null : t.req ? t.imp / t.req : 0,
    ecpm: t.imp ? (cost / t.imp) * 1000 : 0,
    vcr: t.vs ? t.vc / t.vs : 0,
    viewRate: t.imp ? t.view / t.imp : 0,
  }
}

/** Conversion rate, cost per conversion and cost per click from totals. */
export function derivedRatios(m: Pick<Metrics, "clk" | "conv" | "cost">) {
  return { cvr: m.clk ? m.conv / m.clk : 0, cpa: m.conv ? m.cost / m.conv : 0, cpc: m.clk ? m.cost / m.clk : 0 }
}

export function delta(cur: number | null, prev: number | null | undefined): number | null {
  if (cur == null || !prev) return null
  return (cur - prev) / prev
}

export type MetricKey = keyof Metrics
export const METRIC_DEFS: Record<MetricKey, { label: string; short?: string; def: string; kind: "count" | "pct" | "usd" | "usd2" }> = {
  req: { label: "Ad requests", short: "Requests", def: "Ad calls received from SDKs and web tags, whether or not an ad was returned.", kind: "count" },
  elig: { label: "Eligible requests", short: "Eligible", def: "Requests that matched at least one live campaign’s property, placement, country and constraints.", kind: "count" },
  err: { label: "Errors", def: "Requests that failed: timeouts, invalid keys or SDK errors.", kind: "count" },
  imp: { label: "Impressions", def: "Ads rendered and counted by the impression beacon (the “views” of an ad).", kind: "count" },
  view: { label: "Viewable impressions", short: "Viewable", def: "Impressions with ≥ 50% of pixels on screen for ≥ 1 s (2 s for video), per MRC.", kind: "count" },
  clk: { label: "Clicks", def: "Taps or clicks on a served ad recorded by the click tracker.", kind: "count" },
  vs: { label: "Video starts", def: "Video ads that began playing.", kind: "count" },
  vc: { label: "Video completions", def: "Video ads played to the end.", kind: "count" },
  conv: { label: "Conversions", def: "Tracked conversion events attributed to an ad click within 7 days.", kind: "count" },
  cost: { label: "Spend", def: "Internal cost allocated against campaign budgets (no money changes hands).", kind: "usd" },
  ctr: { label: "CTR", def: "Clicks ÷ impressions.", kind: "pct" },
  fill: { label: "Fill rate", def: "Impressions ÷ ad requests. Not available when filtered by campaign, creative or format.", kind: "pct" },
  ecpm: { label: "eCPM", def: "Internal spend per 1,000 impressions.", kind: "usd2" },
  vcr: { label: "Completion rate", def: "Video completions ÷ video starts.", kind: "pct" },
  viewRate: { label: "Viewability", def: "Viewable impressions ÷ impressions.", kind: "pct" },
}
