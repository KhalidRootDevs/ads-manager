"use client"

import { useApiQuery } from "@orbit/api-client/react"
import { deriveMetrics, derivedRatios, type DeliveryQuery, type Metrics, type Row, type Dimension, type FilterKey, type Filters, type RangeInput } from "@orbit/domain"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useIndex } from "@/lib/hooks"
import { fmt } from "@/lib/format"

export const RANGES = [7, 14, 30] as const
/** Filters that round-trip through the URL (`/analytics?days=14&campaign=cmp_…&country=BD`). */
export const URL_FILTERS: FilterKey[] = ["campaign", "country", "platform", "device", "format", "property", "placement", "creative", "region"]

/** Filter changes are applied to queries after this pause, so rapid clicks cost one request per tile. */
const DEBOUNCE_MS = 350

/** Debounce a value by its JSON identity. */
export function useDebounced<T>(value: T, ms = DEBOUNCE_MS): T {
  const key = JSON.stringify(value)
  const [state, setState] = useState({ key, value })
  const latest = useRef(value)
  useEffect(() => {
    latest.current = value
  })
  useEffect(() => {
    if (key === state.key) return
    const t = setTimeout(() => setState({ key, value: latest.current }), ms)
    return () => clearTimeout(t)
  }, [key, ms, state.key])
  return state.value
}

/** Drop empty filters and sort values so equal filters produce equal query keys (shared cache entries). */
export function normFilters(f: Filters): Filters {
  const out: Filters = {}
  for (const k of Object.keys(f).sort() as FilterKey[]) {
    const v = f[k]
    if (v && v.length) out[k] = [...new Set(v)].sort()
  }
  return out
}

export interface Scope {
  range: RangeInput
  filters: Filters
}

/** Body for one `analyticsDelivery` call. Every tile that needs the same grouping shares one request via the query cache. */
export function deliveryBody(scope: Scope, groupBy: Dimension | null, opts: { compare?: boolean; limit?: number; range?: RangeInput } = {}): DeliveryQuery {
  return { range: opts.range ?? scope.range, compare: opts.compare ? "previous_period" : null, filters: scope.filters, groupBy, limit: opts.limit ?? 100 }
}

export function useDelivery(scope: Scope | null, groupBy: Dimension | null, opts: { compare?: boolean; limit?: number; range?: RangeInput; enabled?: boolean } = {}) {
  const body = scope ? deliveryBody(scope, groupBy, opts) : null
  return useApiQuery("analyticsDelivery", body ? { body } : null, { enabled: opts.enabled !== false && !!body })
}

/** Daily series with chart-friendly fields (`day` label, conversion rate, cost per conversion). */
export function useDailySeries(scope: Scope | null) {
  const q = useDelivery(scope, "day", { compare: true, limit: 400 })
  const series = useMemo(
    () =>
      (q.data?.rows ?? []).map((r) => {
        const d = derivedRatios(r)
        return { ...r, day: fmt.day(r.key), cvr: d.cvr, cpa: d.cpa }
      }),
    [q.data],
  )
  return { q, series }
}

/**
 * Dashboard state lives in the URL (?days=14&campaign=cmp_1,cmp_2&country=BD) so every view is shareable.
 * Queries use a debounced copy of it; tiles share requests by grouping through the query cache.
 */
export function useAnalytics() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const idx = useIndex()

  const days = RANGES.includes(Number(sp.get("days")) as (typeof RANGES)[number]) ? Number(sp.get("days")) : 30
  const filtersKey = URL_FILTERS.map((k) => sp.get(k) ?? "").join("|")
  const filters: Filters = useMemo(() => {
    const f: Filters = {}
    const parts = filtersKey.split("|")
    URL_FILTERS.forEach((k, i) => {
      if (parts[i]) f[k] = parts[i].split(",").filter(Boolean)
    })
    return normFilters(f)
  }, [filtersKey])

  const live = useMemo<Scope>(() => ({ range: { days }, filters }), [days, filters])
  const scope = useDebounced(live)
  const { q: dayQ, series } = useDailySeries(scope)

  const write = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp.toString())
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [sp, router, pathname],
  )

  const setDays = (d: number) => write({ days: d === 30 ? null : String(d) })
  const setFilter = (k: FilterKey, values: string[]) => write({ [k]: values.length ? values.join(",") : null })
  /** Add/remove a single value — click-to-filter on charts, the map and tables. */
  const toggle = (k: FilterKey, value: string) => {
    const cur = filters[k] ?? []
    setFilter(k, cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value])
  }
  const reset = () => write(Object.fromEntries(URL_FILTERS.map((k) => [k, null])))
  const activeCount = Object.values(filters).reduce((a, v) => a + (v?.length ?? 0), 0)

  const data = dayQ.data
  return {
    days,
    filters,
    /** Debounced scope that queries use. */
    scope,
    dayQ,
    series,
    totals: data?.totals ?? null,
    previous: data?.previous ?? null,
    range: data?.range ?? null,
    previousRange: data?.previousRange ?? null,
    supplyAvailable: data?.supplyAvailable ?? true,
    /** True while new filters are pending or loading (previous data stays on screen). */
    updating: JSON.stringify(live) !== JSON.stringify(scope) || dayQ.isPlaceholderData,
    idx,
    setDays,
    setFilter,
    toggle,
    reset,
    activeCount,
  }
}

export type AnalyticsState = ReturnType<typeof useAnalytics>

/** Shown wherever supply metrics are null. */
export const SUPPLY_NOTE = "Ad requests aren’t recorded per campaign, creative or format (they happen before an ad is chosen). Remove those filters to see requests and fill rate."

/** Combine grouped rows into one total (e.g. countries → region). Ratios are re-derived with the domain maths. */
export function sumRows(rows: Row[]): Metrics {
  const has = rows.every((r) => r.req != null)
  const sum = (k: "imp" | "view" | "clk" | "vs" | "vc" | "conv" | "cost") => rows.reduce((s, r) => s + r[k], 0)
  const sumN = (k: "req" | "elig" | "err") => (has ? rows.reduce((s, r) => s + (r[k] ?? 0), 0) : null)
  return deriveMetrics({ req: sumN("req"), elig: sumN("elig"), err: sumN("err"), imp: sum("imp"), view: sum("view"), clk: sum("clk"), vs: sum("vs"), vc: sum("vc"), conv: sum("conv"), costMicros: Math.round(sum("cost") * 1e6) })
}

/** Group rows by a derived key and sum each group. */
export function regroup(rows: Row[], keyOf: (r: Row) => string | undefined, labelOf: (k: string) => string = (k) => k): Row[] {
  const g = new Map<string, Row[]>()
  for (const r of rows) {
    const k = keyOf(r)
    if (k) g.set(k, [...(g.get(k) ?? []), r])
  }
  const total = rows.reduce((s, r) => s + r.imp, 0)
  return [...g.entries()]
    .map(([key, rs]) => {
      const m = sumRows(rs)
      return { ...m, key, label: labelOf(key), sub: null, href: null, share: total ? m.imp / total : 0 }
    })
    .sort((x, y) => y.imp - x.imp)
}
