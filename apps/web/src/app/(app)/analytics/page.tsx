"use client"

import { delta, derivedRatios, METRIC_DEFS, todayKey } from "@orbit/domain"
import { BarChart3, Download } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { FilterBar } from "@/components/analytics/filter-bar"
import { Delta, KpiTile, MetricInfo, Spark } from "@/components/analytics/tile"
import { CampaignsTile, CreativesTile, DeviceTile, FormatTile, InsightsTile, InventoryTile, PlatformTile } from "@/components/analytics/tiles-breakdown"
import { FunnelTile, GeoTiles, HeatmapTile, NoFillTile, TrendTile } from "@/components/analytics/tiles-reach"
import { deliveryBody, SUPPLY_NOTE, useAnalytics, useDelivery } from "@/components/analytics/use-analytics"
import { GuardedLink } from "@/components/nav-guard"
import { PageContainer, PageHeader } from "@/components/page-header"
import { ScreenState } from "@/components/screen-state"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { fmt } from "@/lib/format"
import { toastError, useCan } from "@/lib/hooks"

export default function AnalyticsPage() {
  const a = useAnalytics()
  const canExport = useCan("reports.export")
  const [exporting, setExporting] = useState(false)
  const t = a.totals, p = a.previous
  const d = t ? derivedRatios(t) : null, dp = p ? derivedRatios(p) : null
  const series = a.series
  const best = series.reduce<(typeof series)[number] | null>((m, s) => (!m || s.imp > m.imp ? s : m), null)
  // Same args as the campaign leaderboard, so this shares its request.
  const campaigns = useDelivery(a.scope, "campaign", { limit: 50 })
  const delivering = campaigns.data?.rows.filter((r) => r.imp > 0).length

  const exportCsv = async () => {
    setExporting(true)
    try {
      const fileName = `orbit_analytics_campaigns_${a.days}d_${todayKey()}.csv`
      await api.download("analyticsExport", deliveryBody(a.scope, "campaign", { limit: 500 }), fileName)
      toast.success(`Downloaded ${fileName}`, { description: "One row per campaign · respects the current filters." })
    } catch (e) {
      toastError(e, "Export failed")
    } finally {
      setExporting(false)
    }
  }

  const isEmpty = !!t && t.imp === 0 && !t.req && a.activeCount === 0

  return (
    <PageContainer>
      <PageHeader
        title="Analytics"
        description="Campaign performance across every app, website and country."
        actions={
          <>
            <Button variant="outline" asChild><GuardedLink href="/reports">Detailed reports</GuardedLink></Button>
            {canExport && <Button onClick={exportCsv} disabled={exporting || !t}><Download /> {exporting ? "Exporting…" : "Export"}</Button>}
          </>
        }
      />
      <FilterBar a={a} />

      <ScreenState
        query={a.dayQ}
        isEmpty={isEmpty}
        empty={{ icon: <BarChart3 />, title: "No delivery data yet", description: "Analytics appear once a published campaign serves its first impressions." }}
        loading={<div className="grid grid-cols-2 gap-4 md:grid-cols-6 xl:grid-cols-12">{Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className={i === 0 ? "col-span-2 h-72 md:col-span-6 xl:col-span-4 xl:row-span-2" : "h-34 md:col-span-3 xl:col-span-2"} />)}<Skeleton className="col-span-2 h-96 md:col-span-6 xl:col-span-12" /></div>}
      >
        {t && d && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-6 xl:grid-cols-12" aria-busy={a.updating || undefined}>
            {/* Hero: views */}
            <Card className="col-span-2 gap-0 overflow-hidden py-0 md:col-span-6 xl:col-span-4 xl:row-span-2">
              <CardContent className="flex h-full flex-col p-5">
                <div className="flex items-center justify-between text-sm font-medium text-muted-foreground">
                  <span>Views (impressions)</span>
                  <MetricInfo text={METRIC_DEFS.imp.def} />
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-2">
                  <span className="text-4xl font-semibold tracking-tight tabular-nums">{fmt.compact(t.imp)}</span>
                  <Delta value={delta(t.imp, p?.imp)} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmt.int(t.imp)} in the last {a.days} days{delivering != null ? ` · ${delivering} ${delivering === 1 ? "campaign" : "campaigns"} delivering` : ""}
                </p>
                <div className="relative mt-4 min-h-36 flex-1">
                  <Spark data={series} dataKey="imp" className="absolute inset-0 h-full" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 border-t pt-3 text-xs">
                  <div><div className="text-muted-foreground">Daily avg</div><div className="mt-0.5 font-semibold tabular-nums">{fmt.compact(t.imp / a.days)}</div></div>
                  <div><div className="text-muted-foreground">Best day</div><div className="mt-0.5 font-semibold tabular-nums">{best && best.imp > 0 ? best.day : "—"}</div></div>
                  <div>
                    <div className="flex items-center gap-1 text-muted-foreground">Fill rate{t.fill == null && <MetricInfo text={SUPPLY_NOTE} />}</div>
                    <div className="mt-0.5 font-semibold tabular-nums">{t.fill == null ? "—" : fmt.pct(t.fill, 1)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <KpiTile className="md:col-span-3 xl:col-span-2" label="Clicks" value={fmt.compact(t.clk)} delta={delta(t.clk, p?.clk)} tip={METRIC_DEFS.clk.def} spark={series} sparkKey="clk" />
            <KpiTile className="md:col-span-3 xl:col-span-2" label="CTR" value={fmt.pct(t.ctr)} delta={delta(t.ctr, p?.ctr)} tip={METRIC_DEFS.ctr.def} spark={series} sparkKey="ctr" />
            <KpiTile className="md:col-span-3 xl:col-span-2" label="Conversions" value={fmt.int(t.conv)} delta={delta(t.conv, p?.conv)} tip={METRIC_DEFS.conv.def} spark={series} sparkKey="conv" />
            <KpiTile className="md:col-span-3 xl:col-span-2" label="Conversion rate" value={fmt.pct(d.cvr, 1)} delta={delta(d.cvr, dp?.cvr)} tip="Conversions ÷ clicks." spark={series} sparkKey="cvr" />
            <KpiTile className="md:col-span-3 xl:col-span-2" label="Spend · internal" value={fmt.usd(t.cost)} delta={delta(t.cost, p?.cost)} tip={METRIC_DEFS.cost.def} spark={series} sparkKey="cost" />
            <KpiTile className="md:col-span-3 xl:col-span-2" label="eCPM" value={fmt.usd2(t.ecpm)} delta={delta(t.ecpm, p?.ecpm)} invert tip={METRIC_DEFS.ecpm.def} spark={series} sparkKey="ecpm" />
            <KpiTile className="md:col-span-3 xl:col-span-2" label="Cost per conversion" value={d.cpa ? fmt.usd2(d.cpa) : "—"} delta={delta(d.cpa, dp?.cpa)} invert tip="Internal spend ÷ conversions. Lower is better." spark={series} sparkKey="cpa" />
            <KpiTile className="md:col-span-3 xl:col-span-2" label="Video completion" value={t.vs ? fmt.pct(t.vcr, 1) : "—"} delta={t.vs ? delta(t.vcr, p?.vcr) : undefined} tip={METRIC_DEFS.vcr.def} spark={t.vs ? series : undefined} sparkKey="vcr" />

            <GeoTiles a={a} />
            <TrendTile a={a} />
            <FunnelTile a={a} />
            <DeviceTile a={a} />
            <PlatformTile a={a} />
            <FormatTile a={a} />
            <HeatmapTile a={a} />
            <CreativesTile a={a} />
            <CampaignsTile a={a} />
            <InventoryTile a={a} />
            <NoFillTile a={a} />
            <InsightsTile a={a} />
          </div>
        )}
      </ScreenState>
    </PageContainer>
  )
}
