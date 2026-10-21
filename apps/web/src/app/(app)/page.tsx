"use client"

import { useApiQuery } from "@orbit/api-client/react"
import { delta, METRIC_DEFS, type Metrics } from "@orbit/domain"
import { BarChart3, Plus, RotateCcw } from "lucide-react"
import { useMemo, useState } from "react"
import { TileState } from "@/components/analytics/tile"
import { SUPPLY_NOTE, useDailySeries, useDebounced, type Scope } from "@/components/analytics/use-analytics"
import { KpiCard, RequestsChart, TrendChart } from "@/components/domain/widgets"
import { GuardedLink } from "@/components/nav-guard"
import { ActivityCard } from "@/components/overview/activity-card"
import { AlertsCard } from "@/components/overview/alerts-card"
import { BreakdownCard } from "@/components/overview/breakdown-card"
import { PageContainer, PageHeader } from "@/components/page-header"
import { FilterSelect, toFilters, useFilterOptions } from "@/components/reports/filter-select"
import { ScreenState } from "@/components/screen-state"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmt, metricFmt } from "@/lib/format"
import { useCan, useIndex } from "@/lib/hooks"

type Metric = "imp" | "req" | "clk" | "ctr" | "cost" | "conv" | "fill"
const METRICS: { key: Metric; label: string; supply?: boolean }[] = [
  { key: "imp", label: "Impressions" },
  { key: "req", label: "Requests", supply: true },
  { key: "clk", label: "Clicks" },
  { key: "ctr", label: "CTR" },
  { key: "cost", label: "Spend" },
  { key: "conv", label: "Conversions" },
  { key: "fill", label: "Fill rate", supply: true },
]

const KPIS: { key: keyof Metrics; label: string; tip: string }[] = [
  { key: "imp", label: "Impressions", tip: "Ads actually rendered and counted by the SDK impression beacon. Not the same as ad requests." },
  { key: "clk", label: "Clicks", tip: "Taps or clicks on a served ad that reached the click tracker." },
  { key: "ctr", label: "CTR", tip: "Clicks divided by impressions." },
  { key: "cost", label: "Spend", tip: "Internal spend: cost allocated against team and campaign budgets (see Billing & budgets). No money changes hands." },
  { key: "ecpm", label: "eCPM", tip: "Internal spend per 1,000 impressions." },
  { key: "fill", label: "Fill rate", tip: "Impressions divided by ad requests. Low fill means requests arrived but no eligible campaign served." },
  { key: "conv", label: "Conversions", tip: "Tracked conversion events attributed to an ad click within 7 days." },
]

const DEFAULT_FILTER = { days: "14", platform: "all", property: "all", country: "all", campaign: "all" }

export default function OverviewPage() {
  const opts = useFilterOptions()
  const { properties } = useIndex()
  const counts = useApiQuery("campaignCounts", {})
  const canCreate = useCan("campaigns.write")

  const [f, setF] = useState(DEFAULT_FILTER)
  const [metric, setMetric] = useState<Metric>("imp")
  const set = (patch: Partial<typeof DEFAULT_FILTER>) => setF((x) => ({ ...x, ...patch }))
  const days = Number(f.days)
  const canReset = f.platform !== "all" || f.property !== "all" || f.country !== "all" || f.campaign !== "all" || f.days !== DEFAULT_FILTER.days

  const live = useMemo<Scope>(() => ({ range: { days }, filters: toFilters({ platform: f.platform, property: f.property, country: f.country, campaign: f.campaign }) }), [days, f.platform, f.property, f.country, f.campaign])
  const scope = useDebounced(live)
  const { q, series } = useDailySeries(scope)
  const t = q.data?.totals, p = q.data?.previous
  const supply = q.data?.supplyAvailable ?? true
  const range = q.data?.range
  const shown = METRICS.find((m) => m.key === metric)
  const chartMetric: Metric = shown?.supply && !supply ? "imp" : metric

  const liveCount = counts.data ? (counts.data.counts.active ?? 0) : null
  const apps = properties.filter((x) => x.platform !== "web").length
  const sites = properties.length - apps
  const isEmpty = !!t && t.imp === 0 && !t.req && live.filters && Object.keys(live.filters).length === 0

  return (
    <PageContainer>
      <PageHeader
        title="Overview"
        description={liveCount == null ? "Delivery across every app and website" : `${liveCount} live ${liveCount === 1 ? "campaign" : "campaigns"} across ${apps} apps and ${sites} websites`}
        actions={
          <>
            <Button variant="outline" asChild>
              <GuardedLink href="/reports"><BarChart3 /> Open reports</GuardedLink>
            </Button>
            {canCreate && (
              <Button asChild>
                <GuardedLink href="/campaigns/new"><Plus /> New campaign</GuardedLink>
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <FilterSelect label="Date range" value={f.days} options={opts.range} onChange={(v) => set({ days: v })} active={false} />
        <FilterSelect label="Platform" value={f.platform} options={opts.platform} onChange={(v) => set({ platform: v })} />
        <FilterSelect label="App / site" value={f.property} options={opts.property} onChange={(v) => set({ property: v })} />
        <FilterSelect label="Country" value={f.country} options={opts.country} onChange={(v) => set({ country: v })} />
        <FilterSelect label="Campaign" value={f.campaign} options={opts.campaign} onChange={(v) => set({ campaign: v })} />
        <Button variant="ghost" size="sm" className="justify-self-start" disabled={!canReset} onClick={() => setF(DEFAULT_FILTER)}>
          <RotateCcw /> Reset filters
        </Button>
      </div>

      <ScreenState
        query={q}
        isEmpty={isEmpty}
        empty={{
          icon: <BarChart3 />,
          title: "No delivery yet",
          description: "Once a campaign is published to a property with a working SDK, impressions and clicks show up here within minutes.",
          action: canCreate ? (
            <Button asChild>
              <GuardedLink href="/campaigns/new"><Plus /> Create your first campaign</GuardedLink>
            </Button>
          ) : undefined,
        }}
        loading={<OverviewSkeleton />}
      >
        <div className="flex flex-col gap-6" aria-busy={q.isPlaceholderData || undefined}>
          <section aria-labelledby="kpi-caption" className="flex flex-col gap-2">
            <p id="kpi-caption" className="text-xs text-muted-foreground">
              {range ? `Totals for ${fmt.range(range.from, range.to)}` : "Totals"} · % change vs the previous {days} days
              {!supply && <> · requests and fill rate aren’t available with a campaign filter</>}
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              {t && KPIS.map((k, i) => {
                const x = t[k.key], y = p?.[k.key]
                return (
                  <KpiCard
                    key={k.key}
                    label={k.label}
                    value={metricFmt(k.key, x)}
                    delta={x == null ? undefined : delta(x, y)}
                    tip={x == null ? `${k.tip} ${SUPPLY_NOTE}` : k.tip}
                    className={i === KPIS.length - 1 ? "col-span-2 xl:col-span-1" : undefined}
                  />
                )
              })}
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-3">
            {/* Below xl the two columns dissolve (display: contents) so order-* interleaves chart, alerts, breakdown, activity. */}
            <div className="contents xl:col-span-2 xl:flex xl:min-w-0 xl:flex-col xl:gap-6">
              <Card className="order-1 min-w-0">
                <CardHeader className="gap-3">
                  <div className="flex flex-col gap-1">
                    <CardTitle>{chartMetric === "req" ? "Requests vs impressions" : `${METRICS.find((m) => m.key === chartMetric)?.label} per day`}</CardTitle>
                    <CardDescription>
                      {range ? fmt.range(range.from, range.to) : ""} · total {metricFmt(chartMetric, t?.[chartMetric])}
                      {chartMetric === "req" && " · left bar is ad requests, right bar is impressions served"}
                    </CardDescription>
                  </div>
                  <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={chartMetric} onValueChange={(v) => v && setMetric(v as Metric)} aria-label="Chart metric" className="flex-wrap">
                    {METRICS.map((m) => (
                      <ToggleGroupItem key={m.key} value={m.key} disabled={m.supply && !supply} title={m.supply && !supply ? SUPPLY_NOTE : undefined} className="data-[state=on]:bg-primary/10 data-[state=on]:text-primary">
                        {m.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </CardHeader>
                <CardContent>
                  <TileState q={q} isEmpty={!t || (t.imp === 0 && !t.req)} skeleton="h-64" empty={<span className="grid h-56 place-items-center rounded-lg border border-dashed">No delivery matches these filters.</span>}>
                    {chartMetric === "req" ? (
                      <RequestsChart data={series.map((x) => ({ day: x.day, req: x.req ?? 0, imp: x.imp }))} className="h-64 xl:h-72" />
                    ) : (
                      <TrendChart data={series} dataKey={chartMetric} label={METRIC_DEFS[chartMetric].label} format={(v) => metricFmt(chartMetric, v)} className="h-64 xl:h-72" />
                    )}
                  </TileState>
                </CardContent>
              </Card>
              <BreakdownCard scope={scope} className="order-3 min-w-0" />
            </div>
            <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-6">
              <AlertsCard className="order-2 min-w-0" />
              <ActivityCard className="order-4 min-w-0" />
            </div>
          </div>
        </div>
      </ScreenState>
    </PageContainer>
  )
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-80 xl:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    </div>
  )
}
