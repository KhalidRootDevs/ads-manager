"use client"

import { delta, METRIC_DEFS, PLATFORM_LABEL, WEEKDAY_LABEL, WEEKDAYS, type Platform } from "@orbit/domain"
import { Clock, Filter, Globe2, Layers, Rocket, TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"
import { Bar, BarChart, Cell, Label, Pie, PieChart, XAxis, YAxis } from "recharts"
import { useAllCampaigns } from "@/components/billing/use-all-campaigns"
import { CreativeThumb } from "@/components/domain/ad-preview"
import { Meter } from "@/components/domain/widgets"
import { GuardedLink } from "@/components/nav-guard"
import { PlatformBadge, StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fmt, metricFmt } from "@/lib/format"
import { cn } from "@/lib/utils"
import { BarRow, Delta, Tile, TileState } from "./tile"
import { peakOf, useCountryRows, useHeatmap } from "./tiles-reach"
import { regroup, useDelivery, type AnalyticsState, type Scope } from "./use-analytics"

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]

// Shared requests (same args → one cached query per grouping).
const useCampaignRows = (scope: Scope) => useDelivery(scope, "campaign", { limit: 50 })
const useCampaignPrevRows = (a: AnalyticsState) => useDelivery(a.scope, "campaign", { limit: 50, range: a.previousRange ?? undefined, enabled: !!a.previousRange })
const usePropertyRows = (scope: Scope) => useDelivery(scope, "property", { limit: 200 })

/** Donut of views by device, with CTR per device. */
export function DeviceTile({ a }: { a: AnalyticsState }) {
  const q = useDelivery(a.scope, "device", { limit: 10 })
  const rows = q.data?.rows ?? []
  const config = Object.fromEntries(rows.map((r, i) => [r.key, { label: r.label, color: PALETTE[i % PALETTE.length] }])) satisfies ChartConfig
  const data = rows.map((r) => ({ name: r.key, value: r.imp, fill: `var(--color-${r.key})` }))
  return (
    <Tile className="col-span-2 md:col-span-3 xl:col-span-4" title="Devices" description="Share of views and CTR by device">
      <TileState q={q} isEmpty={rows.length === 0} skeleton="h-36">
        <div className="flex items-center gap-4">
          <ChartContainer config={config} className="aspect-square h-36 shrink-0">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="name" formatter={(v, n) => <div className="flex w-full justify-between gap-4"><span>{config[String(n)]?.label ?? n}</span><span className="font-mono tabular-nums">{fmt.compact(Number(v))}</span></div>} />} />
              <Pie isAnimationActive={false} data={data} dataKey="value" nameKey="name" innerRadius={44} outerRadius={64} strokeWidth={3} stroke="var(--card)">
                <Label content={({ viewBox }) => viewBox && "cx" in viewBox ? (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-lg font-semibold">{fmt.compact(q.data?.totals.imp)}</tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 18} className="fill-muted-foreground text-[10px]">views</tspan>
                  </text>
                ) : null} />
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {rows.map((r, i) => (
              <button key={r.key} type="button" onClick={() => a.toggle("device", r.key)} aria-pressed={!!a.filters.device?.includes(r.key)} className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted/60", a.filters.device?.includes(r.key) && "bg-muted")}>
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{r.label}</span>
                  <span className="block text-[11px] text-muted-foreground tabular-nums">{fmt.pct(r.ctr)} CTR</span>
                </span>
                <span className="font-semibold tabular-nums">{fmt.pct(r.share, 0)}</span>
              </button>
            ))}
          </div>
        </div>
      </TileState>
    </Tile>
  )
}

/** Views, CTR and fill by platform (Android / iOS / Web). */
export function PlatformTile({ a }: { a: AnalyticsState }) {
  const q = usePropertyRows(a.scope)
  const { propById } = a.idx
  // Derived from the property rows (one request fewer); a property has exactly one platform.
  const rows = useMemo(() => regroup(q.data?.rows ?? [], (r) => propById[r.key]?.platform, (k) => PLATFORM_LABEL[k as Platform]), [q.data, propById])
  return (
    <Tile className="col-span-2 md:col-span-3 xl:col-span-4" title="Platforms" description="Apps vs web">
      <TileState q={q} isEmpty={rows.length === 0} skeleton="h-28">
        <div className="flex flex-col gap-4">
          <div className="flex h-3 overflow-hidden rounded-full">
            {rows.map((r, i) => <div key={r.key} style={{ width: r.share * 100 + "%", background: PALETTE[i] }} title={`${r.label} ${fmt.pct(r.share, 1)}`} />)}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {rows.map((r, i) => (
              <button key={r.key} type="button" onClick={() => a.toggle("platform", r.key)} aria-pressed={!!a.filters.platform?.includes(r.key)} className={cn("min-w-0 rounded-lg border p-2.5 text-left transition-colors hover:bg-muted/50", a.filters.platform?.includes(r.key) && "border-primary")}>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2 rounded-sm" style={{ background: PALETTE[i] }} />{r.label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{fmt.compact(r.imp)}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">{fmt.pct(r.ctr)} CTR · {r.fill == null ? "—" : fmt.pct(r.fill, 0)} fill</div>
              </button>
            ))}
          </div>
        </div>
      </TileState>
    </Tile>
  )
}

/** Format comparison bar chart (views or CTR). */
export function FormatTile({ a }: { a: AnalyticsState }) {
  const [metric, setMetric] = useState<"imp" | "ctr">("ctr")
  const q = useDelivery(a.scope, "format", { limit: 20 })
  const rows = useMemo(() => [...(q.data?.rows ?? [])].filter((r) => r.imp > 0).sort((x, y) => y[metric] - x[metric]), [q.data, metric])
  const config = { [metric]: { label: METRIC_DEFS[metric].label, color: "var(--chart-1)" } } satisfies ChartConfig
  return (
    <Tile
      className="col-span-2 md:col-span-6 xl:col-span-4"
      title="Ad formats"
      description={metric === "ctr" ? "Which formats people click" : "Where views come from"}
      action={<Tabs value={metric} onValueChange={(v) => setMetric(v as "imp" | "ctr")}><TabsList><TabsTrigger value="ctr" className="text-xs">CTR</TabsTrigger><TabsTrigger value="imp" className="text-xs">Views</TabsTrigger></TabsList></Tabs>}
    >
      <TileState q={q} isEmpty={rows.length === 0} skeleton="h-40">
        <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(90, rows.length * 34 + 20) }}>
          <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 40 }}>
            <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={104} tick={{ fontSize: 11 }} />
            <XAxis type="number" hide />
            <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent hideIndicator formatter={(v) => <span className="font-mono tabular-nums">{metricFmt(metric, Number(v))}</span>} />} />
            <Bar isAnimationActive={false} dataKey={metric} radius={4} barSize={18} onClick={(d) => a.toggle("format", String((d as { key?: string }).key))} className="cursor-pointer"
              label={{ position: "right", fontSize: 11, fill: "var(--muted-foreground)", formatter: (v: unknown) => metricFmt(metric, Number(v)) }}>
              {rows.map((r) => <Cell key={r.key} fill={a.filters.format?.includes(r.key) ? "var(--primary)" : `var(--color-${metric})`} />)}
            </Bar>
          </BarChart>
        </ChartContainer>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Filter by format">
          {rows.map((r) => (
            <button key={r.key} type="button" onClick={() => a.toggle("format", r.key)} aria-pressed={!!a.filters.format?.includes(r.key)} className={cn("rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted", a.filters.format?.includes(r.key) && "border-primary text-primary")}>
              {r.label}
            </button>
          ))}
        </div>
      </TileState>
    </Tile>
  )
}

/** Campaign leaderboard with change vs the previous period, spend and budget use. */
export function CampaignsTile({ a }: { a: AnalyticsState }) {
  const q = useCampaignRows(a.scope)
  const pq = useCampaignPrevRows(a)
  const all = useAllCampaigns()
  const rows = q.data?.rows ?? []
  const prev = useMemo(() => Object.fromEntries((pq.data?.rows ?? []).map((r) => [r.key, r])), [pq.data])
  return (
    <Tile className="col-span-2 md:col-span-6 xl:col-span-12" title="Campaign performance" description={`Ranked by views in this period · change vs the previous ${a.days} days · use the filter button to focus the dashboard`} contentClassName="px-0">
      <TileState q={q} isEmpty={rows.length === 0} skeleton="h-64">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Campaign</TableHead>
              <TableHead className="text-right">Views</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Clicks</TableHead>
              <TableHead className="text-right">CTR</TableHead>
              <TableHead className="hidden text-right md:table-cell">Conv.</TableHead>
              <TableHead className="hidden text-right md:table-cell">Spend</TableHead>
              <TableHead className="hidden w-36 lg:table-cell">Budget used</TableHead>
              <TableHead className="w-12 pr-5"><span className="sr-only">Filter</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 8).map((r) => {
              const c = all.byId[r.key]
              const used = c?.budget.amountMicros ? (c.stats?.lifetime.costMicros ?? 0) / c.budget.amountMicros : 0
              const on = !!a.filters.campaign?.includes(r.key)
              return (
                <TableRow key={r.key} data-state={on ? "selected" : undefined}>
                  <TableCell className="max-w-56 pl-5">
                    <GuardedLink href={`/campaigns/${r.key}`} className="block truncate font-medium hover:underline">{r.label}</GuardedLink>
                    <div className="mt-0.5 flex items-center gap-2">
                      {r.sub && <StatusBadge status={r.sub} className="h-5 text-[11px]" />}
                      {pq.data && <Delta value={delta(r.imp, prev[r.key]?.imp ?? 0)} className="py-0" />}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{fmt.compact(r.imp)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{fmt.compact(r.clk)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt.pct(r.ctr)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{fmt.int(r.conv)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{fmt.usd(r.cost)}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {c ? (
                      <div className="flex items-center gap-2" title="Lifetime spend ÷ campaign budget"><Meter value={used} tone={used > 0.9 ? "warning" : "primary"} className="w-16" /><span className="text-xs text-muted-foreground tabular-nums">{fmt.pct(used, 0)}</span></div>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button variant={on ? "secondary" : "ghost"} size="icon-sm" onClick={() => a.toggle("campaign", r.key)} aria-pressed={on} aria-label={on ? `Remove ${r.label} filter` : `Filter dashboard to ${r.label}`} title={on ? "Remove filter" : "Filter dashboard to this campaign"}>
                      <Filter />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TileState>
    </Tile>
  )
}

/** Best creatives by CTR (min. 1,000 views). */
export function CreativesTile({ a }: { a: AnalyticsState }) {
  const q = useDelivery(a.scope, "creative", { limit: 100 })
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => r.imp >= 1000).sort((x, y) => y.ctr - x.ctr).slice(0, 5), [q.data])
  return (
    <Tile className="col-span-2 md:col-span-6 xl:col-span-4" title="Top creatives" description="Highest CTR · min. 1,000 views">
      <TileState q={q} isEmpty={rows.length === 0} skeleton="h-64">
        <div className="flex flex-col gap-3">
          {rows.map((r, i) => {
            const c = a.idx.crById[r.key]
            return (
              <GuardedLink key={r.key} href={`/creatives/${r.key}`} className="group -m-1 flex items-center gap-3 rounded-lg p-1 hover:bg-muted/60">
                <span className="w-4 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                {c && <CreativeThumb c={c} className="h-11 w-16 shrink-0 p-1.5 [&>span:first-child]:hidden [&>span:last-child]:hidden [&>span:nth-child(2)]:text-[10px]" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium group-hover:underline">{r.label}</div>
                  <div className="text-xs text-muted-foreground">{r.sub} · {fmt.compact(r.imp)} views</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">{fmt.pct(r.ctr)}</div>
                  <div className="text-[11px] text-muted-foreground">CTR</div>
                </div>
              </GuardedLink>
            )
          })}
        </div>
      </TileState>
    </Tile>
  )
}

/** Apps & websites / placements leaderboard. */
export function InventoryTile({ a }: { a: AnalyticsState }) {
  const [dim, setDim] = useState<"property" | "placement">("property")
  const pq = usePropertyRows(a.scope)
  const lq = useDelivery(a.scope, "placement", { limit: 100, enabled: dim === "placement" })
  const q = dim === "property" ? pq : lq
  const rows = (q.data?.rows ?? []).slice(0, 8)
  const max = Math.max(...rows.map((r) => r.imp), 1)
  return (
    <Tile
      className="col-span-2 md:col-span-6 xl:col-span-6"
      title="Inventory"
      description="Views and fill rate by where ads ran"
      action={<Tabs value={dim} onValueChange={(v) => setDim(v as "property" | "placement")}><TabsList><TabsTrigger value="property" className="text-xs">Apps & sites</TabsTrigger><TabsTrigger value="placement" className="text-xs">Placements</TabsTrigger></TabsList></Tabs>}
    >
      <TileState q={q} isEmpty={rows.length === 0} skeleton="h-64">
        <div className="flex flex-col">
          {rows.map((r) => (
            <BarRow
              key={r.key}
              label={r.label}
              sub={dim === "property" ? <PlatformBadge type={r.sub ?? ""} /> : r.sub}
              value={fmt.compact(r.imp)}
              right={<span className={cn("text-xs", r.fill != null && r.fill < 0.8 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{r.fill == null ? "—" : fmt.pct(r.fill, 0)} fill</span>}
              share={r.imp / max}
              onClick={() => a.toggle(dim, r.key)}
              active={!!a.filters[dim]?.includes(r.key)}
            />
          ))}
        </div>
      </TileState>
    </Tile>
  )
}

/** Plain-language findings computed from the same (cached) requests as the other tiles. */
export function InsightsTile({ a }: { a: AnalyticsState }) {
  const cq = useCountryRows(a.scope)
  const fq = useDelivery(a.scope, "format", { limit: 20 })
  const kq = useCampaignRows(a.scope)
  const kpq = useCampaignPrevRows(a)
  const hq = useHeatmap(a.scope)
  const pq = usePropertyRows(a.scope)
  const items = useMemo(() => {
    const out: { icon: React.ElementType; title: string; body: string; tone: string }[] = []
    const countries = (cq.data?.rows ?? []).filter((r) => r.imp > 0)
    if (countries[0]) out.push({ icon: Globe2, title: `${countries[0].label} leads with ${fmt.pct(countries[0].share, 0)} of views`, body: `${countries.length} countries served. Top 3 make up ${fmt.pct(countries.slice(0, 3).reduce((s, r) => s + r.share, 0), 0)} of views.`, tone: "text-blue-600 dark:text-blue-400" })
    const formats = (fq.data?.rows ?? []).filter((r) => r.imp > 2000).sort((x, y) => y.ctr - x.ctr)
    if (formats.length > 1) {
      const hi = formats[0], lo = formats[formats.length - 1]
      out.push({ icon: Layers, title: `${hi.label} gets ${(hi.ctr / Math.max(lo.ctr, 1e-9)).toFixed(1)}× the CTR of ${lo.label}`, body: `${fmt.pct(hi.ctr)} vs ${fmt.pct(lo.ctr)} click-through rate.`, tone: "text-violet-600 dark:text-violet-400" })
    }
    if (kpq.data) {
      const prev = Object.fromEntries(kpq.data.rows.map((r) => [r.key, r.imp]))
      const growth = (kq.data?.rows ?? []).map((r) => ({ r, d: delta(r.imp, prev[r.key] ?? 0) })).filter((x) => x.d !== null && x.r.imp > 5000).sort((x, y) => (y.d ?? 0) - (x.d ?? 0))
      if (growth[0] && (growth[0].d ?? 0) > 0) out.push({ icon: Rocket, title: `${growth[0].r.label} is up ${fmt.pct(growth[0].d ?? 0, 0)}`, body: `Views vs the previous ${a.days} days.`, tone: "text-emerald-600 dark:text-emerald-400" })
    }
    const best = peakOf(hq.data?.matrix ?? [])
    if (best) out.push({ icon: Clock, title: `Peak viewing: ${WEEKDAY_LABEL[WEEKDAYS[best.d]]} around ${String(best.h).padStart(2, "0")}:00`, body: `In ${hq.data?.tz ?? "the reporting time zone"}. Good window for time-sensitive creatives and dayparting.`, tone: "text-amber-600 dark:text-amber-400" })
    const weak = (pq.data?.rows ?? []).filter((r) => (r.req ?? 0) > 5000 && r.fill != null).sort((x, y) => (x.fill ?? 0) - (y.fill ?? 0))[0]
    if (weak && weak.fill != null && weak.fill < 0.82) out.push({ icon: TriangleAlert, title: `${weak.label} fills only ${fmt.pct(weak.fill, 0)} of requests`, body: "Add compatible campaigns or creatives for its placements.", tone: "text-red-600 dark:text-red-400" })
    return out.slice(0, 4)
  }, [cq.data, fq.data, kq.data, kpq.data, hq.data, pq.data, a.days])
  return (
    <Tile className="col-span-2 md:col-span-6 xl:col-span-12" title="Insights" description="Generated from the data on this page">
      <TileState q={[cq, fq, kq, hq, pq]} isEmpty={items.length === 0} skeleton="h-24">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((x) => (
            <div key={x.title} className="flex gap-3 rounded-lg border bg-muted/30 p-3">
              <x.icon className={cn("mt-0.5 size-4 shrink-0", x.tone)} />
              <div className="min-w-0">
                <div className="text-sm leading-snug font-medium">{x.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{x.body}</div>
              </div>
            </div>
          ))}
        </div>
      </TileState>
    </Tile>
  )
}
