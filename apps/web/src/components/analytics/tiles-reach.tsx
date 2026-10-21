"use client"

import { useApiQuery } from "@orbit/api-client/react"
import { METRIC_DEFS, WEEKDAY_LABEL, WEEKDAYS, type MetricKey } from "@orbit/domain"
import { useMemo, useState } from "react"
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { GeoMap } from "@/components/domain/geo-map"
import { KeyValue } from "@/components/domain/widgets"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmt, metricFmt } from "@/lib/format"
import { cn } from "@/lib/utils"
import { BarRow, MetricInfo, Tile, TileState } from "./tile"
import { regroup, SUPPLY_NOTE, useDelivery, type AnalyticsState, type Scope } from "./use-analytics"

type GeoMetric = "imp" | "clk" | "ctr" | "conv"
const GEO_METRICS: { k: GeoMetric; l: string }[] = [{ k: "imp", l: "Views" }, { k: "clk", l: "Clicks" }, { k: "ctr", l: "CTR" }, { k: "conv", l: "Conversions" }]
const DAY_NAMES = WEEKDAYS.map((d) => WEEKDAY_LABEL[d])

/** Country rows (≤ 250 countries): one request shared by the map, the ranking and Insights. */
export function useCountryRows(scope: Scope) {
  return useDelivery(scope, "country", { limit: 250 })
}

/** Heatmap request shared by the heatmap tile and Insights. */
export function useHeatmap(scope: Scope) {
  return useApiQuery("analyticsHeatmap", { body: { range: scope.range, filters: scope.filters, metric: "imp" } })
}

/** World map + ranked countries/regions. Clicking a country filters the whole dashboard. */
export function GeoTiles({ a }: { a: AnalyticsState }) {
  const [metric, setMetric] = useState<GeoMetric>("imp")
  const [mode, setMode] = useState<"fill" | "bubbles">("fill")
  const [view, setView] = useState<"country" | "region">("country")
  const q = useCountryRows(a.scope)
  const countries = useMemo(() => q.data?.rows ?? [], [q.data])
  const regions = useMemo(() => regroup(countries, (r) => r.sub ?? "Other"), [countries])
  const label = metric === "imp" ? "Views" : METRIC_DEFS[metric].label
  const format = (v: number) => metricFmt(metric, v)
  const data = countries.map((r) => ({ code: r.key, name: r.label, value: r[metric], detail: [["Views", fmt.compact(r.imp)], ["Clicks", fmt.compact(r.clk)], ["CTR", fmt.pct(r.ctr)], ["Conversions", fmt.int(r.conv)]] as [string, string][] }))
  const list = (view === "country" ? countries : regions).slice().sort((x, y) => y[metric] - x[metric])
  const maxV = Math.max(...list.map((r) => r[metric]), 1)
  const selected = a.filters.country ?? []
  const served = countries.filter((r) => r.imp > 0).length

  return (
    <>
      <Tile
        className="col-span-2 md:col-span-6 xl:col-span-8"
        title="Where your ads were seen"
        description={`${served} ${served === 1 ? "country" : "countries"} · ${fmt.compact(a.totals?.imp)} views in the last ${a.days} days`}
        action={
          <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as "fill" | "bubbles")} aria-label="Map style" className="hidden sm:flex">
            <ToggleGroupItem value="fill" className="px-2.5">Fill</ToggleGroupItem>
            <ToggleGroupItem value="bubbles" className="px-2.5">Bubbles</ToggleGroupItem>
          </ToggleGroup>
        }
      >
        <Tabs value={metric} onValueChange={(v) => setMetric(v as GeoMetric)} className="mb-3">
          <TabsList>{GEO_METRICS.map((x) => <TabsTrigger key={x.k} value={x.k}>{x.l}</TabsTrigger>)}</TabsList>
        </Tabs>
        <TileState q={q} skeleton="aspect-[2/1] h-auto">
          <GeoMap data={data} mode={mode} valueLabel={label} format={format} selected={selected} onSelect={(c) => a.toggle("country", c)} />
        </TileState>
      </Tile>

      <Tile
        className="col-span-2 md:col-span-6 xl:col-span-4"
        title={view === "country" ? "Top countries" : "Regions"}
        description={`Ranked by ${metric === "imp" ? "views" : label.toLowerCase()}`}
        action={
          <ToggleGroup type="single" size="sm" variant="outline" value={view} onValueChange={(v) => v && setView(v as "country" | "region")} aria-label="Group by">
            <ToggleGroupItem value="country" className="px-2.5">Country</ToggleGroupItem>
            <ToggleGroupItem value="region" className="px-2.5">Region</ToggleGroupItem>
          </ToggleGroup>
        }
        contentClassName="flex flex-col"
      >
        <TileState q={q} isEmpty={list.length === 0} skeleton="h-72">
          <div className="flex flex-col">
            {list.slice(0, 10).map((r, i) => (
              <BarRow
                key={r.key}
                label={<><span className="mr-2 inline-block w-4 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>{r.label}</>}
                sub={view === "country" ? r.key : undefined}
                value={format(r[metric])}
                right={metric === "imp" ? <span className="text-xs text-muted-foreground">{fmt.pct(r.share, 1)}</span> : undefined}
                share={r[metric] / maxV}
                active={view === "country" ? selected.includes(r.key) : !!a.filters.region?.includes(r.key)}
                onClick={view === "country" ? () => a.toggle("country", r.key) : () => a.toggle("region", r.key)}
              />
            ))}
          </div>
        </TileState>
      </Tile>
    </>
  )
}

type SeriesKey = Extract<MetricKey, "imp" | "clk" | "cost" | "conv" | "req" | "fill">
const TREND_SETS: Record<string, { a: SeriesKey; b: SeriesKey; label: string; supply?: boolean }> = {
  engagement: { a: "imp", b: "clk", label: "Views & clicks" },
  outcomes: { a: "cost", b: "conv", label: "Spend & conversions" },
  supply: { a: "req", b: "fill", label: "Requests & fill rate", supply: true },
}

/** Dual-axis daily trend. */
export function TrendTile({ a }: { a: AnalyticsState }) {
  const [set, setSet] = useState("engagement")
  const s = TREND_SETS[set]
  const config = { [s.a]: { label: METRIC_DEFS[s.a].label, color: "var(--chart-1)" }, [s.b]: { label: METRIC_DEFS[s.b].label, color: "var(--chart-2)" } } satisfies ChartConfig
  const blocked = s.supply && !a.supplyAvailable
  return (
    <Tile className="col-span-2 md:col-span-6 xl:col-span-8" title="Daily performance" description={`Last ${a.days} days · today is partial`}>
      <Tabs value={set} onValueChange={setSet} className="mb-3">
        <TabsList className="max-w-full overflow-x-auto">{Object.entries(TREND_SETS).map(([k, v]) => <TabsTrigger key={k} value={k} className="text-xs">{v.label}</TabsTrigger>)}</TabsList>
      </Tabs>
      <TileState q={a.dayQ} skeleton="h-72" isEmpty={blocked} empty={<>Requests and fill rate aren’t available for these filters. <span className="block text-xs">{SUPPLY_NOTE}</span></>}>
        <ChartContainer config={config} className="aspect-auto h-72 w-full">
          <ComposedChart data={a.series} margin={{ left: 0, right: 0, top: 8 }}>
            <defs>
              <linearGradient id="trend-a" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`var(--color-${s.a})`} stopOpacity={0.28} />
                <stop offset="100%" stopColor={`var(--color-${s.a})`} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} />
            <YAxis yAxisId="a" tickLine={false} axisLine={false} width={48} tickFormatter={(v) => metricFmt(s.a, v)} />
            <YAxis yAxisId="b" orientation="right" tickLine={false} axisLine={false} width={48} tickFormatter={(v) => metricFmt(s.b, v)} />
            <ChartTooltip content={<ChartTooltipContent indicator="line" formatter={(v, n) => <div className="flex w-full justify-between gap-4"><span className="text-muted-foreground">{METRIC_DEFS[n as MetricKey]?.label}</span><span className="font-mono font-medium tabular-nums">{metricFmt(n as MetricKey, Number(v))}</span></div>} />} />
            <Area yAxisId="a" isAnimationActive={false} dataKey={s.a} type="monotone" stroke={`var(--color-${s.a})`} strokeWidth={2} fill="url(#trend-a)" />
            <Line yAxisId="b" isAnimationActive={false} dataKey={s.b} type="monotone" stroke={`var(--color-${s.b})`} strokeWidth={2} dot={false} />
            <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
          </ComposedChart>
        </ChartContainer>
      </TileState>
    </Tile>
  )
}

/** Delivery funnel: requests → eligible → views → clicks → conversions. */
export function FunnelTile({ a }: { a: AnalyticsState }) {
  const t = a.totals
  const supply = !!t && t.req != null
  const steps: { k: string; label: string; v: number | null; rel?: string }[] = t
    ? [
        { k: "req", label: "Ad requests", v: t.req },
        { k: "elig", label: "Eligible", v: t.elig, rel: t.req && t.elig != null ? fmt.pct(t.elig / t.req, 1) + " of requests" : "" },
        { k: "imp", label: "Views", v: t.imp, rel: t.elig ? fmt.pct(t.imp / t.elig, 1) + " of eligible" : "" },
        { k: "clk", label: "Clicks", v: t.clk, rel: t.imp ? fmt.pct(t.clk / t.imp) + " CTR" : "" },
        { k: "conv", label: "Conversions", v: t.conv, rel: t.clk ? fmt.pct(t.conv / t.clk, 1) + " of clicks" : "" },
      ]
    : []
  const top = Math.max(supply ? (t?.req ?? 0) : (t?.imp ?? 0), 1)
  return (
    <Tile className="col-span-2 md:col-span-6 xl:col-span-4" title="Delivery funnel" description="An ad request only counts as a view when an ad renders.">
      <TileState q={a.dayQ} skeleton="h-56">
        <div className="flex flex-col gap-3.5">
          {steps.map((s, i) => {
            // log scale so clicks and conversions stay visible next to millions of requests
            const w = s.v != null && s.v > 0 ? 6 + (Math.log10(s.v + 1) / Math.log10(top + 1)) * 94 : 0
            return (
              <div key={s.k} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted-foreground"><span className="mr-2 font-semibold text-foreground tabular-nums">{s.v == null ? "—" : fmt.compact(s.v)}</span>{s.rel}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: w + "%", background: `color-mix(in oklab, var(--chart-1) ${100 - i * 15}%, var(--chart-2))` }} />
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          {supply && t
            ? `${fmt.compact((t.req ?? 0) - t.imp)} requests (${fmt.pct(t.req ? 1 - t.imp / t.req : 0, 1)}) returned no ad or failed to render. Bar widths use a log scale.`
            : SUPPLY_NOTE}
        </p>
      </TileState>
    </Tile>
  )
}

/** Weekday × hour heatmap of views from the hourly arrays in the daily rollups (reporting time zone). */
export function HeatmapTile({ a }: { a: AnalyticsState }) {
  const q = useHeatmap(a.scope)
  const m = useMemo(() => q.data?.matrix ?? [], [q.data])
  const max = Math.max(...m.flat(), 1)
  const best = peakOf(m)
  const tz = q.data?.tz ?? "Asia/Dhaka"
  return (
    <Tile
      className="col-span-2 md:col-span-6 xl:col-span-8"
      title="When ads are seen"
      description={best ? `Views by weekday and hour · peak ${DAY_NAMES[best.d]} ${String(best.h).padStart(2, "0")}:00 (${tz})` : `Views by weekday and hour (${tz})`}
      action={<MetricInfo text={`Counted per hour of the reporting time zone (${tz}) from the hourly impression counts stored with each daily rollup. Each cell sums every matching day in the range.`} />}
    >
      <TileState q={q} isEmpty={!best} skeleton="h-56">
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[3px]">
              <div />
              {Array.from({ length: 24 }, (_, h) => <div key={h} className="text-center text-[10px] text-muted-foreground">{h % 3 === 0 ? String(h).padStart(2, "0") : ""}</div>)}
              {m.map((row, d) => (
                <div key={d} className="contents">
                  <div className="flex items-center text-[11px] text-muted-foreground">{DAY_NAMES[d]}</div>
                  {row.map((v, h) => (
                    <div
                      key={h}
                      title={`${DAY_NAMES[d]} ${String(h).padStart(2, "0")}:00 · ${fmt.compact(v)} views`}
                      className={cn("aspect-square rounded-[3px]", best && d === best.d && h === best.h && "ring-2 ring-foreground/60")}
                      style={{ background: `color-mix(in oklab, var(--chart-1) ${Math.round(6 + (v / max) * 94)}%, var(--muted))` }}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Fewer views</span>
              {[10, 30, 55, 80, 100].map((p) => <span key={p} className="size-3 rounded-[3px]" style={{ background: `color-mix(in oklab, var(--chart-1) ${p}%, var(--muted))` }} />)}
              <span>More</span>
            </div>
          </div>
        </div>
      </TileState>
    </Tile>
  )
}

export function peakOf(m: number[][]) {
  let best = { d: 0, h: 0, v: 0 }
  m.forEach((row, d) => row.forEach((v, h) => { if (v > best.v) best = { d, h, v } }))
  return best.v ? best : null
}

const NOFILL_LABEL: Record<string, { label: string; hint: string }> = {
  no_candidates: { label: "No eligible campaign", hint: "No live campaign targets this property, placement, country or device." },
  capped: { label: "Frequency capped", hint: "Every eligible campaign hit its frequency cap for this user." },
  paced: { label: "Held back by pacing", hint: "Even pacing skipped the request to spread budget over the flight." },
  paused_placement: { label: "Placement paused", hint: "The placement was paused when the request arrived." },
  app_version: { label: "App version too old", hint: "The app is below the placement’s or campaign’s minimum version." },
  country: { label: "Country not available", hint: "The country is disabled or excluded for this property." },
  no_compatible_creative: { label: "No compatible creative", hint: "No creative matched the placement’s format and size." },
}

/** Why requests went unfilled, plus serving latency. Supply data only, so it needs supply-compatible filters. */
export function NoFillTile({ a }: { a: AnalyticsState }) {
  const q = useApiQuery("analyticsNoFill", a.supplyAvailable ? { body: { range: a.scope.range, filters: a.scope.filters } } : null)
  const reasons = q.data?.reasons ?? []
  const total = reasons.reduce((s, r) => s + r.count, 0)
  const max = Math.max(...reasons.map((r) => r.count), 1)
  return (
    <Tile className="col-span-2 md:col-span-6 xl:col-span-6" title="Why requests went unfilled" description="No-fill reasons and ad server latency">
      {!a.supplyAvailable ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{SUPPLY_NOTE}</p>
      ) : (
        <TileState q={q} isEmpty={total === 0} empty="Every request in this period was filled." skeleton="h-48">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col">
              {reasons.slice(0, 6).map((r) => {
                const l = NOFILL_LABEL[r.reason] ?? { label: r.reason.replace(/_/g, " "), hint: "" }
                return (
                  <BarRow
                    key={r.reason}
                    label={<span title={l.hint}>{l.label}</span>}
                    value={fmt.compact(r.count)}
                    right={<span className="text-xs text-muted-foreground">{fmt.pct(r.count / total, 0)}</span>}
                    share={r.count / max}
                  />
                )
              })}
            </div>
            <KeyValue
              className="border-t pt-3"
              items={[
                { k: "Unfilled requests", v: fmt.int(total) },
                { k: "Latency p50", v: q.data?.latencyP50 == null ? "—" : `${fmt.int(q.data.latencyP50)} ms` },
                { k: "Latency p99", v: q.data?.latencyP99 == null ? "—" : `${fmt.int(q.data.latencyP99)} ms` },
              ]}
            />
            <p className="text-xs text-muted-foreground">Latency shows the highest value across apps and days: percentiles can’t be added up.</p>
          </div>
        </TileState>
      )}
    </Tile>
  )
}
