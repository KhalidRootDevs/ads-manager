"use client"

import { useApiQuery } from "@orbit/api-client/react"
import { ruleSummary, type Property } from "@orbit/domain"
import { ArrowRight, CircleCheck, CircleDashed, CircleX, TriangleAlert } from "lucide-react"
import { KpiCard, RequestsChart } from "@/components/domain/widgets"
import { GuardedLink } from "@/components/nav-guard"
import { requestSeries, useDelivery } from "@/components/placements/placement-utils"
import { StatusBadge } from "@/components/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { fmt } from "@/lib/format"

const HEALTH = {
  healthy: { icon: CircleCheck, cls: "border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300", title: "SDK healthy" },
  degraded: { icon: TriangleAlert, cls: "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200", title: "SDK degraded" },
  heartbeat_missing: { icon: CircleX, cls: "border-red-500/30 bg-red-500/5 text-red-800 dark:text-red-300", title: "Heartbeat missing" },
  not_integrated: { icon: CircleDashed, cls: "border-blue-500/30 bg-blue-500/5 text-blue-900 dark:text-blue-200", title: "Not integrated yet" },
} as const

export function OverviewTab({ p, onTab }: { p: Property; onTab: (t: string) => void }) {
  const filters = { property: [p.id] }
  const a7 = useDelivery(filters, 7)
  const d14 = useDelivery(filters, 14, "day")
  const campsQ = useApiQuery("listCampaigns", { query: { propertyId: p.id, limit: 100 } })
  const camps = (campsQ.data?.items ?? []).filter((c) => c.status !== "archived" && c.targets.some((t) => t.propertyId === p.id))
  const t = a7.data?.totals
  const req = t?.req ?? 0
  const errRate = req ? (t?.err ?? 0) / req : 0
  const series = requestSeries(d14.data?.rows)
  const hasData = series.some((d) => d.req || d.imp)
  const isWeb = p.platform === "web"
  const state = p.sdk.state
  const h = HEALTH[state]
  const ver = p.sdk.version ?? "—"
  const body = {
    healthy: "Heartbeats arrive every minute and the error rate is normal.",
    degraded: `Error rate is above 1% on ${isWeb ? "tag" : "SDK"} ${ver}. Open Diagnostics to see which requests fail, and upgrade to the latest ${isWeb ? "web tag" : "SDK"}.`,
    heartbeat_missing: `No heartbeat since ${fmt.ago(p.sdk.lastHeartbeatAt).toLowerCase()}. Check that the latest release still initializes the SDK.`,
    not_integrated: `Add the ${isWeb ? "web tag" : "SDK"} using the Integration tab, then send a test request.`,
  }[state]
  const kpi = (v: string) => (a7.data ? v : "…")

  return (
    <div className="flex flex-col gap-6">
      <Alert className={h.cls}>
        <h.icon />
        <AlertTitle>{h.title}</AlertTitle>
        <AlertDescription className="text-current/80">
          <p>{body}</p>
          {state !== "healthy" && (
            <Button size="sm" variant="outline" className="mt-2 bg-background text-foreground" onClick={() => onTab(state === "not_integrated" ? "integration" : "diagnostics")}>
              {state === "not_integrated" ? "Go to integration" : "Open diagnostics"} <ArrowRight />
            </Button>
          )}
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label={isWeb ? "Tag version" : "SDK version"} value={ver} />
        <KpiCard label="Last heartbeat" value={fmt.ago(p.sdk.lastHeartbeatAt)} />
        <KpiCard label="Requests · 7d" value={kpi(fmt.compact(req))} tip="Ad requests the SDK or tag sent to the ad server." />
        <KpiCard label="Impressions · 7d" value={kpi(fmt.compact(t?.imp))} tip="Ads actually rendered on screen." />
        <KpiCard label="Fill rate · 7d" value={kpi(req ? fmt.pct(t?.fill, 1) : "—")} tip="Impressions ÷ requests." />
        <KpiCard label="Error rate · 7d" value={kpi(req ? fmt.pct(errRate, 2) : "—")} tip="Requests that failed with a timeout or server error." />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader>
            <CardTitle>Requests vs impressions</CardTitle>
            <CardDescription>Last 14 days · production traffic (test requests excluded)</CardDescription>
          </CardHeader>
          <CardContent>
            {d14.isPending ? <Skeleton className="h-64 w-full" /> : hasData ? <RequestsChart data={series} /> : (
              <div className="grid h-64 place-items-center rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                {d14.isError ? "Delivery data couldn’t be loaded right now." : "No ad requests yet. Data appears once a campaign serves here."}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Campaigns targeting this property</CardTitle>
            <CardDescription>Country rule applied on {p.name}</CardDescription>
          </CardHeader>
          <CardContent>
            {campsQ.isPending ? (
              <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : camps.length ? (
              <ul className="divide-y">
                {camps.map((c) => {
                  const tg = c.targets.find((x) => x.propertyId === p.id)!
                  return (
                    <li key={c.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <GuardedLink href={`/campaigns/${c.id}`} className="block truncate text-sm font-medium hover:underline">{c.name}</GuardedLink>
                        <div className="truncate text-xs text-muted-foreground">{ruleSummary(tg.countryRule)}</div>
                      </div>
                      <StatusBadge status={c.status} />
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No campaigns target {p.name} yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
