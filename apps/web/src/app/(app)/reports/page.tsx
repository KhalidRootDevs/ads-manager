"use client"

import { METRIC_DEFS, todayKey } from "@orbit/domain"
import { Download, FileBarChart, RotateCcw, SearchX } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { TileState } from "@/components/analytics/tile"
import { deliveryBody, SUPPLY_NOTE, useDailySeries, useDebounced, useDelivery, type Scope } from "@/components/analytics/use-analytics"
import { KpiCard, RequestsChart, TrendChart } from "@/components/domain/widgets"
import { PageContainer, PageHeader } from "@/components/page-header"
import { BreakdownTable } from "@/components/reports/breakdown-table"
import { DIM_LABEL, type Dim } from "@/components/reports/dimensions"
import { DimensionChart } from "@/components/reports/dimension-chart"
import { ExportDialog } from "@/components/reports/export-dialog"
import { FilterSelect, toFilters, useFilterOptions } from "@/components/reports/filter-select"
import { Funnel, METRIC_TIPS } from "@/components/reports/funnel"
import { ScreenState } from "@/components/screen-state"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fmt, metricFmt } from "@/lib/format"
import { useCan } from "@/lib/hooks"

const DIMS: Dim[] = ["day", "campaign", "country", "property", "creative", "placement", "format", "device"]

interface ReportFilter {
  days: string
  campaign: string
  creative: string
  property: string
  platform: string
  country: string
  placement: string
  format: string
}
const DEFAULT: ReportFilter = { days: "14", campaign: "all", creative: "all", property: "all", platform: "all", country: "all", placement: "all", format: "all" }
const FILTER_KEYS = (Object.keys(DEFAULT) as (keyof ReportFilter)[]).filter((k) => k !== "days")

export default function ReportsPage() {
  const opts = useFilterOptions()
  const params = useSearchParams()
  const canExport = useCan("reports.export")

  // Preselect ?campaign=<id> (campaign detail pages link here). Re-sync when the param changes.
  const qCampaign = params.get("campaign")
  const fromParam = (q: string | null) => ({ ...DEFAULT, campaign: q && /^cmp_/.test(q) ? q : "all" })
  const [f, setF] = useState<ReportFilter>(() => fromParam(qCampaign))
  const [seenParam, setSeenParam] = useState(qCampaign)
  if (qCampaign !== seenParam) {
    setSeenParam(qCampaign)
    setF(fromParam(qCampaign))
  }

  const [dim, setDim] = useState<Dim>("day")
  const [exportOpen, setExportOpen] = useState(false)
  const update = (patch: Partial<ReportFilter>) => setF((x) => ({ ...x, ...patch }))
  const reset = () => setF((x) => ({ ...DEFAULT, days: x.days }))
  const activeFilters = FILTER_KEYS.filter((k) => f[k] !== "all").length
  const days = Number(f.days)

  // A campaign filter from a link may point at a campaign not in the option list yet; keep it selectable.
  const campaignOpts = f.campaign !== "all" && !opts.campaign.some((o) => o.value === f.campaign) ? [...opts.campaign, { value: f.campaign, label: f.campaign }] : opts.campaign

  const live = useMemo<Scope>(() => {
    const { days: d, ...rest } = f
    return { range: { days: Number(d) }, filters: toFilters(rest) }
  }, [f])
  const scope = useDebounced(live)
  const { q, series } = useDailySeries(scope)
  // The day tab reuses the daily request; other tabs fetch their own grouping.
  const bq = useDelivery(scope, dim, { limit: 500, enabled: dim !== "day" })
  const t = q.data?.totals
  const range = q.data?.range
  const supply = q.data?.supplyAvailable ?? true
  const table = useMemo(() => (dim === "day" ? [...(q.data?.rows ?? [])].reverse() : (bq.data?.rows ?? [])), [dim, q.data, bq.data])
  const updating = JSON.stringify(live) !== JSON.stringify(scope) || q.isPlaceholderData || (dim !== "day" && bq.isPlaceholderData)

  const filename = `orbit_report_${dim}_${days}d_${todayKey()}.csv`
  const summary = `Breakdown by ${DIM_LABEL[dim].toLowerCase()}, last ${days} days${activeFilters ? `, ${activeFilters} filter${activeFilters > 1 ? "s" : ""} applied` : ""}.`
  const hasData = !!t && (t.imp > 0 || (t.req ?? 0) > 0)

  const cards = t
    ? [
        { label: "Fill rate", value: metricFmt("fill", t.fill), tip: t.fill == null ? `${METRIC_TIPS.fill} ${SUPPLY_NOTE}` : METRIC_TIPS.fill },
        { label: "CTR", value: fmt.pct(t.ctr), tip: METRIC_TIPS.ctr },
        { label: "Video starts", value: fmt.compact(t.vs), tip: METRIC_TIPS.vs },
        { label: "Completion rate", value: t.vs ? fmt.pct(t.vcr, 1) : "—", tip: METRIC_TIPS.vcr },
        { label: "eCPM", value: fmt.usd2(t.ecpm), tip: METRIC_TIPS.ecpm },
        { label: "Errors", value: t.err == null ? "—" : fmt.int(t.err), tip: t.err == null ? `${METRIC_TIPS.err} ${SUPPLY_NOTE}` : METRIC_TIPS.err },
      ]
    : []

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        description="Requests are ad calls from SDKs and tags. Impressions are ads actually served."
        actions={
          <>
            <Button variant="outline" onClick={reset} disabled={!activeFilters}><RotateCcw /> Reset filters</Button>
            {canExport && <Button onClick={() => setExportOpen(true)} disabled={!hasData}><Download /> Export CSV</Button>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FilterSelect label="Date range" value={f.days} options={opts.range} onChange={(v) => update({ days: v })} active={false} />
        <FilterSelect label="Campaign" value={f.campaign} options={campaignOpts} onChange={(v) => update({ campaign: v })} />
        <FilterSelect label="Creative" value={f.creative} options={opts.creative} onChange={(v) => update({ creative: v })} />
        <FilterSelect label="App / site" value={f.property} options={opts.property} onChange={(v) => update({ property: v })} />
        <FilterSelect label="Platform" value={f.platform} options={opts.platform} onChange={(v) => update({ platform: v })} />
        <FilterSelect label="Country" value={f.country} options={opts.country} onChange={(v) => update({ country: v })} />
        <FilterSelect label="Placement" value={f.placement} options={opts.placement} onChange={(v) => update({ placement: v })} />
        <FilterSelect label="Format" value={f.format} options={opts.format} onChange={(v) => update({ format: v })} />
      </div>

      <ScreenState
        query={q}
        isEmpty={!hasData && activeFilters === 0}
        empty={{
          icon: <FileBarChart />,
          title: "No events in the warehouse yet",
          description: "Reports fill in once SDKs start sending requests and impressions through the event pipeline.",
        }}
        loading={<ReportsSkeleton />}
      >
        {!hasData || !t ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon"><SearchX /></EmptyMedia>
              <EmptyTitle>No data for these filters</EmptyTitle>
              <EmptyDescription>Try a longer date range or remove a filter. Some combinations (for example a web placement with an app creative) never serve.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={reset}><RotateCcw /> Reset filters</Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="flex flex-col gap-6" aria-busy={updating || undefined}>
            <section aria-label="Delivery funnel" className="flex flex-col gap-2">
              <Funnel a={t} />
              <p className="text-xs text-muted-foreground">
                {supply && t.req != null
                  ? `An ad request is not an impression: ${fmt.compact(t.req - t.imp)} of ${fmt.compact(t.req)} requests (${fmt.pct(t.req ? 1 - t.imp / t.req : 0, 1)}) returned no ad or failed to render.`
                  : SUPPLY_NOTE}
              </p>
            </section>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {cards.map((c) => <KpiCard key={c.label} label={c.label} value={c.value} tip={c.tip} />)}
            </div>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{supply ? "Requests vs impressions per day" : "Impressions per day"}</CardTitle>
                <CardDescription>
                  {range ? fmt.range(range.from, range.to) : ""}
                  {supply ? " · left bar of each day is ad requests, right bar is impressions served" : " · requests aren’t recorded per campaign, creative or format"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {supply ? (
                  <RequestsChart data={series.map((x) => ({ day: x.day, req: x.req ?? 0, imp: x.imp }))} />
                ) : (
                  <TrendChart data={series} dataKey="imp" label={METRIC_DEFS.imp.label} format={(v) => fmt.compact(v)} />
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Breakdown by {DIM_LABEL[dim].toLowerCase()}</CardTitle>
                <CardDescription>
                  {dim === "day" || bq.data ? `${table.length} ${table.length === 1 ? "row" : "rows"} · ` : ""}sort any column · scroll sideways for all metrics
                  {updating && <span role="status"> · updating…</span>}
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0">
                <Tabs value={dim} onValueChange={(v) => setDim(v as Dim)} className="gap-4">
                  <TabsList aria-label="Break down by" className="grid h-auto! w-full grid-cols-4 sm:inline-flex sm:h-8! sm:w-fit">
                    {DIMS.map((d) => <TabsTrigger key={d} value={d} className="h-7 sm:px-2.5">{DIM_LABEL[d]}</TabsTrigger>)}
                  </TabsList>
                  <TabsContent value={dim} className="flex min-w-0 flex-col gap-6">
                    <TileState q={dim === "day" ? q : bq} skeleton="h-96">
                      {dim !== "day" && table.length > 1 && <DimensionChart rows={table} />}
                      {/* Totals come from the breakdown response: supply columns are null when it can't be split this way. */}
                      <BreakdownTable key={dim} rows={table} total={(dim === "day" ? q.data?.totals : bq.data?.totals) ?? t} dimLabel={DIM_LABEL[dim]} chronological={dim === "day"} />
                    </TileState>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        )}
      </ScreenState>

      {canExport && <ExportDialog open={exportOpen} onOpenChange={setExportOpen} filename={filename} body={deliveryBody(scope, dim, { limit: 500 })} summary={summary} />}
    </PageContainer>
  )
}

function ReportsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading report">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className={i === 0 ? "col-span-2 h-32 sm:col-span-1" : "h-32"} />)}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <Skeleton className="h-80" />
      <Skeleton className="h-96" />
    </div>
  )
}
