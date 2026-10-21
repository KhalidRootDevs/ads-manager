"use client"

import { apiKey, useApi, useApiMutation, useApiQuery } from "@orbit/api-client/react"
import {
  addDays, compat, conflictsFor, DEVICE_LABEL, finalCountries, FORMAT_LABEL, GOAL_TYPE_LABEL, needsAttention, OBJECTIVE_LABEL, PACING_LABEL_TEXT, pacing,
  PRIORITY_LABEL, ruleSummary, sizeLabel, todayKey, type CampaignListItem, type DeliveryQuery, type Metrics, type Row,
} from "@orbit/domain"
import { keepPreviousData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { Archive, BarChart3, ChartPie, Copy, Globe2, Info, Loader2, MoreHorizontal, Pause, Pencil, Play, RotateCcw } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { CampaignNotFound } from "@/components/campaigns/campaign-not-found"
import { daysLabel, displayStatus, flight, freqLabel, goalValue, hoursLabel, lifetime, plural } from "@/components/campaigns/campaign-utils"
import { Notice, type NoticeTone } from "@/components/campaigns/notice"
import { confirm } from "@/components/confirm-dialog"
import { CreativeThumb } from "@/components/domain/ad-preview"
import { TargetingMatrix } from "@/components/domain/targeting"
import { KeyValue, KpiCard, Meter, TrendChart } from "@/components/domain/widgets"
import { PageContainer, PageHeader } from "@/components/page-header"
import { ScreenState } from "@/components/screen-state"
import { PlatformBadge, StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmt, metricFmt } from "@/lib/format"
import { toastError, useCan, useIndex, useUserName } from "@/lib/hooks"
import { cn } from "@/lib/utils"

const TABS = [
  { value: "summary", label: "Summary" },
  { value: "targeting", label: "Countries" },
  { value: "placements", label: "Creatives & placements" },
  { value: "performance", label: "Performance" },
  { value: "activity", label: "Activity" },
] as const

export function CampaignDetail({ id }: { id: string }) {
  const q = useApiQuery("getCampaign", { params: { id } })
  const ix = useIndex()
  const qc = useQueryClient()
  if (q.error?.status === 404) return <CampaignNotFound id={id} />
  if (!q.data || !ix.ready) {
    const indexQuery = { isPending: !ix.ready && !ix.isError, isError: ix.isError, refetch: () => qc.invalidateQueries() }
    const skeleton = (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-16 w-full max-w-lg" />
        <Skeleton className="h-9 w-full max-w-xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-72 w-full" />
      </div>
    )
    return (
      <PageContainer>
        <ScreenState query={[q, indexQuery]} loading={skeleton}>{skeleton}</ScreenState>
      </PageContainer>
    )
  }
  return <Detail c={q.data} />
}

type Status = CampaignListItem["status"]

function Detail({ c }: { c: CampaignListItem }) {
  const router = useRouter()
  const sp = useSearchParams()
  const qc = useQueryClient()
  const { propById, countries } = useIndex()
  // Clock read once per mount (render stays pure).
  const [mountedAt] = useState(() => Date.now())
  const userName = useUserName()
  const canWrite = useCan("campaigns.write")
  const canPublish = useCan("campaigns.publish")

  const rawTab = sp.get("tab")
  const tab = TABS.some((t) => t.value === rawTab) ? (rawTab as string) : "summary"
  const setTab = (v: string) => router.replace(`/campaigns/${c.id}${v === "summary" ? "" : `?tab=${v}`}`, { scroll: false })

  // ---------- lifecycle mutations ----------
  const detailKey = apiKey("getCampaign", { params: { id: c.id } })
  /** Pause/resume are cheap toggles: update the badge right away and roll back on failure (§3.4). */
  const optimistic = (status: Status, done: string) => ({
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: detailKey })
      const prev = qc.getQueryData<CampaignListItem>(detailKey)
      qc.setQueryData<CampaignListItem>(detailKey, (old) => (old ? { ...old, status } : old))
      return { prev }
    },
    onError: (e: unknown, _v: unknown, ctx?: { prev?: CampaignListItem }) => {
      if (ctx?.prev) qc.setQueryData(detailKey, ctx.prev)
      toastError(e, "Couldn’t update the campaign")
      void qc.invalidateQueries({ queryKey: ["campaigns"] })
    },
    onSuccess: () => { toast.success(done) },
  })
  const pauseM = useApiMutation("pauseCampaign", optimistic("paused", "Campaign paused. Delivery stops within a few seconds."))
  const resumeM = useApiMutation("resumeCampaign", optimistic("active", "Campaign resumed"))
  const onFail = (title: string) => (e: unknown) => { toastError(e, title); void qc.invalidateQueries({ queryKey: ["campaigns"] }) }
  const archiveM = useApiMutation("archiveCampaign", { onSuccess: () => { toast.success("Campaign archived") }, onError: onFail("Couldn’t archive") })
  const restoreM = useApiMutation("restoreCampaign", { onSuccess: () => { toast.success("Restored as draft") }, onError: onFail("Couldn’t restore") })
  const duplicateM = useApiMutation("duplicateCampaign", {
    onSuccess: (d) => {
      toast.success("Duplicated as a draft. Nothing serves until you publish it.")
      router.push(`/campaigns/${d.id}`)
    },
    onError: onFail("Couldn’t duplicate"),
  })
  const busy = pauseM.isPending || resumeM.isPending || archiveM.isPending || restoreM.isPending || duplicateM.isPending

  const pause = () => pauseM.mutate({ params: { id: c.id }, body: { rev: c.rev } })
  const resume = () => resumeM.mutate({ params: { id: c.id }, body: { rev: c.rev } })
  const onDuplicate = () => duplicateM.mutate({ params: { id: c.id } })
  const onArchive = async () => {
    const ok = await confirm({
      title: `Archive “${c.name}”?`,
      description: "Archiving stops delivery right away and removes the campaign from active lists. Reporting history is kept. You can restore it as a draft later.",
      confirmLabel: "Archive campaign",
      destructive: true,
    })
    if (ok) archiveM.mutate({ params: { id: c.id }, body: { rev: c.rev } })
  }
  const onRestore = () => restoreM.mutate({ params: { id: c.id }, body: { rev: c.rev } })

  const canPause = canPublish && (c.status === "active" || c.status === "scheduled")
  const canResume = canPublish && c.status === "paused"
  const canEdit = canWrite && c.status !== "archived" && c.status !== "completed"

  // ---------- contextual notice (most important first) ----------
  const conflicts = conflictsFor(c.targets, propById, countries)
  let notice: { tone: NoticeTone; title: string; body: React.ReactNode; action?: React.ReactNode } | null = null
  if (needsAttention(c)) {
    const crIssue = c.health.issues.find((x) => x.creativeId)
    const ctryIssue = c.health.issues.some((x) => x.code === "country_conflict")
    notice = {
      tone: "danger",
      title: c.health.issues.some((x) => x.code === "creative_not_ready" || x.code === "creative_rejected" || x.code === "no_compatible_placement") ? "Some of this campaign can’t serve" : "Needs attention",
      body: (
        <ul className="flex list-disc flex-col gap-0.5 pl-4">
          {c.health.issues.map((x, i) => <li key={i}>{x.message}</li>)}
          {c.health.checkedAt && <li className="list-none text-xs text-muted-foreground">Checked {fmt.ago(c.health.checkedAt)}</li>}
        </ul>
      ),
      action: crIssue ? (
        <Button size="sm" variant="outline" asChild><Link href={`/creatives/${crIssue.creativeId}`}>Open creative</Link></Button>
      ) : ctryIssue && tab !== "targeting" ? (
        <Button size="sm" variant="outline" onClick={() => setTab("targeting")}>Review targeting</Button>
      ) : undefined,
    }
  } else if (conflicts.length && c.status !== "archived" && c.status !== "completed")
    notice = {
      tone: "warning",
      title: "Country targeting conflict",
      body: `${conflicts.map((x) => `${x.countryName} on ${x.propertyName}`).join(", ")} won’t serve because ${conflicts.length === 1 ? "it isn’t" : "they aren’t"} available in the property’s country defaults.`,
      action: tab !== "targeting" ? <Button size="sm" variant="outline" onClick={() => setTab("targeting")}>Review targeting</Button> : undefined,
    }
  else if (c.status === "paused")
    notice = { tone: "warning", title: "Paused", body: "No impressions are served while paused. Resume to continue delivery from the remaining budget.", action: canResume ? <Button size="sm" onClick={resume} disabled={busy}><Play /> Resume</Button> : undefined }
  else if (c.status === "scheduled")
    notice = { tone: "info", title: "Scheduled", body: `Delivery starts ${fmt.date(c.flight.start)} (${c.flight.tz}). You can still edit everything.` }
  else if (c.status === "draft")
    notice = { tone: "info", title: "Draft", body: "This campaign isn’t published. Finish setup and publish to start delivery.", action: canEdit ? <Button size="sm" asChild><Link href={`/campaigns/${c.id}/edit`}>Continue setup</Link></Button> : undefined }
  else if (c.status === "archived")
    notice = { tone: "info", title: "Archived", body: `Archived ${fmt.ago(c.archivedAt)}. It doesn’t serve and its name is free for other campaigns. Reporting history is kept.`, action: canPublish ? <Button size="sm" variant="outline" onClick={onRestore} disabled={busy}><RotateCcw /> Restore as draft</Button> : undefined }
  else if (c.status === "completed")
    notice = { tone: "info", title: "Completed", body: `The flight ended ${fmt.date(c.flight.end)}. Duplicate it to run it again.` }
  else if (c.status === "active" && c.publishedAt && mountedAt - new Date(c.publishedAt).getTime() < 86_400_000)
    notice = { tone: "success", title: "Live", body: `Published ${fmt.ago(c.publishedAt)}. The ad server is serving this version.`, action: <Button size="sm" variant="outline" asChild><Link href={`/reports?campaign=${c.id}`}>View report</Link></Button> }

  return (
    <PageContainer>
      <PageHeader
        backHref="/campaigns"
        backLabel="Campaigns"
        title={c.name}
        badges={<StatusBadge status={displayStatus(c)} />}
        description={`${OBJECTIVE_LABEL[c.objective]} · ${flight(c)} · ${userName(c.ownerId)}`}
        actions={
          <>
            {canPause && <Button variant="outline" onClick={pause} disabled={busy}><Pause /> Pause</Button>}
            {canResume && <Button variant="outline" onClick={resume} disabled={busy}><Play /> Resume</Button>}
            {canEdit && <Button variant="outline" asChild><Link href={`/campaigns/${c.id}/edit`}><Pencil /> Edit</Link></Button>}
            <Button variant="outline" asChild><Link href={`/analytics?campaign=${c.id}`}><ChartPie /> Analytics</Link></Button>
            <Button variant="outline" asChild><Link href={`/reports?campaign=${c.id}`}><BarChart3 /> View report</Link></Button>
            {(canWrite || canPublish) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More campaign actions" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {canWrite && <DropdownMenuItem onSelect={onDuplicate}><Copy /> Duplicate as draft</DropdownMenuItem>}
                  {canWrite && canPublish && <DropdownMenuSeparator />}
                  {canPublish && (c.status === "archived" ? (
                    <DropdownMenuItem onSelect={onRestore}><RotateCcw /> Restore as draft</DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem variant="destructive" onSelect={() => setTimeout(() => void onArchive(), 0)}><Archive /> Archive</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      {notice && <Notice tone={notice.tone} title={notice.title} action={notice.action}>{notice.body}</Notice>}

      <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-4">
        <div className="-mx-1 overflow-x-auto border-b px-1">
          <TabsList variant="line" aria-label="Campaign sections">
            {TABS.map((t) => <TabsTrigger key={t.value} value={t.value} className="px-2.5">{t.label}</TabsTrigger>)}
          </TabsList>
        </div>
        <TabsContent value="summary"><SummaryTab c={c} /></TabsContent>
        <TabsContent value="targeting"><TargetingTab c={c} canEdit={canEdit} /></TabsContent>
        <TabsContent value="placements"><PlacementsTab c={c} /></TabsContent>
        <TabsContent value="performance"><PerformanceTab c={c} /></TabsContent>
        <TabsContent value="activity"><ActivityTab c={c} /></TabsContent>
      </Tabs>
    </PageContainer>
  )
}

/** Delivery since the flight started (capped at the API's 400-day range), or null before it starts. */
function flightRange(c: CampaignListItem) {
  const today = todayKey()
  const to = c.flight.end < today ? c.flight.end : today
  const earliest = addDays(today, -399)
  const from = c.flight.start > earliest ? c.flight.start : earliest
  return from <= to ? { from, to } : null
}

function SummaryTab({ c }: { c: CampaignListItem }) {
  const { propById, plcById, crById } = useIndex()
  const crs = c.creativeIds.map((x) => crById[x]).filter(Boolean)
  const audiences = useApiQuery("listAudiences", {}, { select: (r) => r.items })
  const range = flightRange(c)
  const byProp = useApiQuery("analyticsDelivery", range ? { body: { range, filters: { campaign: [c.id] }, groupBy: "property" } } : null)
  const propImp = (id: string) => (byProp.isPending && range ? <Skeleton className="ml-auto h-4 w-10" /> : fmt.compact(byProp.data?.rows.find((r) => r.key === id)?.imp ?? 0))

  const l = lifetime(c.stats)
  const gv = goalValue(c, c.stats)
  const goal = c.budget.goal
  const goalPct = goal ? gv / goal.value : 0
  const bp = c.budget.amountMicros ? l.costMicros / c.budget.amountMicros : 0
  const pace = pacing(c, l.costMicros)
  const paceText =
    pace.label === "behind" ? `Behind pace by ${Math.round(-pace.diff * 100)} pts` : pace.label === "ahead" ? `Ahead of pace by ${Math.round(pace.diff * 100)} pts` : PACING_LABEL_TEXT[pace.label]
  const unit = GOAL_TYPE_LABEL[goal?.type ?? "impressions"].toLowerCase()
  const placementNames = (ids: string[]) => ids.map((x) => plcById[x]?.name).filter(Boolean).join(", ") || "No placement"
  const allocated = c.targets.some((t) => t.allocationPct != null)
  const dests = c.targets.filter((t) => t.destinationOverride).length

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Impressions" value={fmt.compact(l.imp)} tip="Ads actually rendered. Ad requests are counted separately." />
        <KpiCard label="Clicks" value={fmt.compact(l.clk)} />
        <KpiCard label="CTR" value={fmt.pct(l.imp ? l.clk / l.imp : 0)} tip="Clicks ÷ impressions." />
        <KpiCard label="Conversions" value={fmt.int(l.conv)} />
        <KpiCard label="Spend · internal" value={fmt.money(l.costMicros)} tip="Internal cost allocated against the budget since launch. Not a payment." />
        <KpiCard label="eCPM" value={fmt.usd2(l.imp ? (l.costMicros / 1e6 / l.imp) * 1000 : 0)} tip="Internal cost per 1,000 impressions." />
      </div>
      {c.stats?.updatedAt && <p className="-mt-3 text-xs text-muted-foreground">Lifetime totals · updated {fmt.ago(c.stats.updatedAt)}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Properties</CardTitle>
              <CardDescription>Each app or website has its own country rule and placements.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {c.targets.length === 0 && <p className="px-4 text-sm text-muted-foreground">No properties selected yet.</p>}
              {/* Phones: stacked rows instead of a cramped table */}
              <ul className="divide-y border-t sm:hidden">
                {c.targets.map((t) => {
                  const p = propById[t.propertyId]
                  if (!p) return null
                  return (
                    <li key={t.propertyId} className="flex flex-col gap-1 px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/properties/${p.id}`} className="min-w-0 truncate font-medium hover:underline">{p.name}</Link>
                        <span className="flex shrink-0 items-center gap-1 tabular-nums">{propImp(p.id)} <span className="text-xs text-muted-foreground">impr.</span></span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5"><PlatformBadge type={p.platform} /><StatusBadge status={p.sdk.state} /></div>
                      <div className="text-muted-foreground">{ruleSummary(t.countryRule)}</div>
                      <div className="text-xs text-muted-foreground">{placementNames(t.placementIds)}</div>
                    </li>
                  )
                })}
              </ul>
              {c.targets.length > 0 && (
                <Table className="hidden sm:table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Property</TableHead>
                      <TableHead>Countries</TableHead>
                      <TableHead>Placements</TableHead>
                      <TableHead className="pr-4 text-right">Impressions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {c.targets.map((t) => {
                      const p = propById[t.propertyId]
                      if (!p) return null
                      return (
                        <TableRow key={t.propertyId}>
                          <TableCell className="pl-4 align-top">
                            <div className="flex flex-col items-start gap-1">
                              <div className="flex items-center gap-2">
                                <Link href={`/properties/${p.id}`} className="font-medium whitespace-nowrap hover:underline">{p.name}</Link>
                                <PlatformBadge type={p.platform} />
                              </div>
                              <StatusBadge status={p.sdk.state} />
                            </div>
                          </TableCell>
                          <TableCell className="min-w-36 align-top whitespace-normal">{ruleSummary(t.countryRule)}</TableCell>
                          <TableCell className="min-w-32 align-top whitespace-normal text-muted-foreground">{placementNames(t.placementIds)}</TableCell>
                          <TableCell className="pr-4 text-right align-top tabular-nums">{propImp(p.id)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Creatives in rotation</CardTitle>
              <CardDescription>{plural(crs.length, "creative")} · creatives are shared with other campaigns</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col divide-y">
              {crs.length === 0 && <p className="text-sm text-muted-foreground">No creatives selected.</p>}
              {crs.map((cr) => (
                <div key={cr.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <CreativeThumb c={cr} className="h-14 w-24 shrink-0 p-1.5 [&>span:first-child]:hidden [&>span:last-child]:hidden [&>span:nth-child(2)]:text-[11px]" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/creatives/${cr.id}`} className="block truncate font-medium hover:underline">{cr.name}</Link>
                    <div className="truncate text-xs text-muted-foreground">{FORMAT_LABEL[cr.format]}{cr.size ? ` · ${sizeLabel(cr.size)}` : ""}</div>
                  </div>
                  <StatusBadge status={cr.status} />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid min-w-0 items-start gap-6 md:grid-cols-2 lg:flex lg:flex-col lg:items-stretch">
          <Card>
            <CardHeader>
              <CardTitle>Delivery &amp; budget</CardTitle>
              <CardAction><StatusBadge status={pace.label} /></CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Goal · {unit}</span>
                  <span className="font-medium tabular-nums">{goal ? fmt.pct(Math.min(1, goalPct), 0) : "No goal"}</span>
                </div>
                <Meter value={goalPct} tone={goalPct >= 1 ? "success" : "primary"} />
                <div className="text-xs text-muted-foreground tabular-nums">{goal ? `${fmt.int(gv)} of ${fmt.int(goal.value)} ${unit}` : `${fmt.int(gv)} delivered · no goal set`}</div>
              </div>
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Internal budget</span>
                  <span className="font-medium tabular-nums">{fmt.pct(Math.min(1, bp), 0)}</span>
                </div>
                <Meter value={bp} tone={bp > 0.9 ? "warning" : "primary"} />
                <div className="text-xs text-muted-foreground tabular-nums">{fmt.money(l.costMicros)} of {fmt.money(c.budget.amountMicros)} spent</div>
              </div>
              <KeyValue
                items={[
                  { k: "Pacing", v: <span className={cn(pace.label === "behind" && "text-amber-700 dark:text-amber-400", pace.label === "on_pace" && "text-emerald-700 dark:text-emerald-400")}>{paceText}</span> },
                  { k: "Flight elapsed", v: `${Math.round(pace.elapsed * 100)}%` },
                  { k: "Remaining budget", v: fmt.money(Math.max(0, c.budget.amountMicros - l.costMicros)) },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Setup</CardTitle></CardHeader>
            <CardContent>
              <KeyValue
                items={[
                  { k: "Objective", v: OBJECTIVE_LABEL[c.objective] },
                  { k: "Flight", v: flight(c) },
                  { k: "Timezone", v: c.flight.tz },
                  { k: "Priority", v: PRIORITY_LABEL[c.priority] },
                  { k: "Team", v: c.team },
                  { k: "Pacing", v: c.budget.pacing === "asap" ? "As fast as possible" : "Even" },
                  { k: "Frequency cap", v: freqLabel(c.constraints.freqCap) },
                  { k: "Days", v: daysLabel(c.constraints.days) },
                  { k: "Hours", v: hoursLabel(c.constraints.hours) },
                  { k: "Devices", v: c.constraints.devices.map((d) => DEVICE_LABEL[d]).join(", ") || "—" },
                  { k: "Min app version", v: c.constraints.minAppVersion || "Any" },
                  {
                    k: "Audiences",
                    v: c.constraints.audienceIds.length ? (
                      <span>{c.constraints.audienceIds.map((x) => audiences.data?.find((a) => a.id === x)?.name ?? x).join(", ")} <span className="font-normal text-muted-foreground">(not enforced)</span></span>
                    ) : "None",
                  },
                  { k: "Budget split", v: allocated ? c.targets.map((t) => `${propById[t.propertyId]?.name ?? t.propertyId} ${t.allocationPct ?? 0}%`).join(", ") : "Shared across properties" },
                  { k: "Destination overrides", v: dests ? plural(dests, "property", "properties") : "None" },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** Shared by the Countries tab (matrix columns) and the Performance tab. */
const topCountryQuery = (id: string, days: number): DeliveryQuery => ({ range: { days }, compare: "previous_period", filters: { campaign: [id] }, groupBy: "country", limit: 20 })

function TargetingTab({ c, canEdit }: { c: CampaignListItem; canEdit: boolean }) {
  const { propById, ctryByCode, countries } = useIndex()
  const canTarget = useCan("campaigns.targeting")
  const top = useApiQuery("analyticsDelivery", { body: topCountryQuery(c.id, 30) })
  const conflicts = conflictsFor(c.targets, propById, countries)
  return (
    <div className="flex flex-col gap-6">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Targeting matrix</CardTitle>
          <CardDescription>Final countries per property, after each property’s own country defaults are applied.</CardDescription>
          {canEdit && canTarget && (
            <CardAction>
              <Button variant="outline" size="sm" asChild><Link href={`/campaigns/${c.id}/edit?step=4`}><Globe2 /> Edit countries</Link></Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent><TargetingMatrix targets={c.targets} topCountries={top.data?.rows.slice(0, 8).map((r) => r.key)} /></CardContent>
      </Card>
      {c.targets.length === 0 && <p className="text-sm text-muted-foreground">No properties selected yet.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {c.targets.map((t) => {
          const p = propById[t.propertyId]
          if (!p) return null
          const fin = finalCountries(t.countryRule, p.countryRule, countries)
          const cf = conflicts.filter((x) => x.propertyId === p.id)
          const rule = t.countryRule
          return (
            <Card key={t.propertyId} size="sm" className="min-w-0">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2"><Link href={`/properties/${p.id}`} className="hover:underline">{p.name}</Link> <PlatformBadge type={p.platform} /></CardTitle>
                <CardDescription>{rule.mode === "all" ? "All available countries" : rule.mode === "include" ? "Include only" : "Exclude"} · serves in {plural(fin.length, "country", "countries")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {rule.countries.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {rule.countries.map((cc) => {
                      const conf = cf.some((x) => x.country === cc)
                      return (
                        <Badge
                          key={cc}
                          variant="secondary"
                          className={cn("font-normal", rule.mode === "exclude" && "bg-red-500/10 text-red-700 line-through decoration-red-700/40 dark:text-red-400", conf && "bg-amber-500/15 text-amber-800 dark:text-amber-300")}
                        >
                          <span className="font-mono text-[11px]">{cc}</span> {ctryByCode[cc]?.name ?? cc}
                        </Badge>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Uses every country {p.name} allows by default.</p>
                )}
                {cf.length > 0 && (
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    {cf.map((x) => x.countryName).join(", ")} {cf.length === 1 ? "is" : "are"} excluded by the property’s defaults and won’t serve.
                  </p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function PlacementsTab({ c }: { c: CampaignListItem }) {
  const { propById, plcById, crById } = useIndex()
  const crs = c.creativeIds.map((x) => crById[x]).filter(Boolean)
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Creatives</h2>
        {crs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No creatives selected.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {crs.map((cr) => (
              <Link key={cr.id} href={`/creatives/${cr.id}`} className="group flex flex-col gap-2 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40">
                <CreativeThumb c={cr} className="h-28" />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium group-hover:underline">{cr.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{FORMAT_LABEL[cr.format]}{cr.size ? ` · ${sizeLabel(cr.size)}` : ""}</div>
                  </div>
                  <StatusBadge status={cr.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Placements by property</h2>
        {c.targets.length === 0 && <p className="text-sm text-muted-foreground">No properties selected yet.</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {c.targets.map((t) => {
            const p = propById[t.propertyId]
            if (!p) return null
            const pls = t.placementIds.map((x) => plcById[x]).filter(Boolean)
            return (
              <Card key={t.propertyId} size="sm" className="min-w-0">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">{p.name} <PlatformBadge type={p.platform} /></CardTitle>
                  <CardDescription>{plural(pls.length, "placement")}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col divide-y">
                  {pls.length === 0 && <p className="text-sm text-muted-foreground">No placement selected, so this property can’t serve.</p>}
                  {pls.map((pl) => {
                    const ok = crs.filter((cr) => compat(cr, pl).ok)
                    return (
                      <div key={pl.id} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/placements/${pl.id}`} className="truncate text-sm font-medium hover:underline">{pl.name}</Link>
                          <span className="min-w-0 shrink truncate font-mono text-xs text-muted-foreground">{pl.id}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{FORMAT_LABEL[pl.format]} · {sizeLabel(pl.size)}{pl.status !== "active" ? " · Paused" : ""}</div>
                        <div className={cn("text-xs", ok.length ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
                          {ok.length ? `Serves ${ok.map((x) => x.name).join(", ")}` : crs[0] ? `No compatible creative · ${compat(crs[0], pl).reason}` : "No compatible creative"}
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>
    </div>
  )
}

const RANGES = [7, 30, 90] as const
const TREND_METRICS = [
  { key: "imp", label: "Impressions" },
  { key: "clk", label: "Clicks" },
  { key: "cost", label: "Spend" },
] as const

function PerformanceTab({ c }: { c: CampaignListItem }) {
  const [days, setDays] = useState<number>(30)
  const [metric, setMetric] = useState<(typeof TREND_METRICS)[number]["key"]>("imp")
  const q = (groupBy: DeliveryQuery["groupBy"], limit = 20): { body: DeliveryQuery } => ({ body: { range: { days }, compare: "previous_period", filters: { campaign: [c.id] }, groupBy, limit } })
  const byDay = useApiQuery("analyticsDelivery", q("day", 400))
  const byProp = useApiQuery("analyticsDelivery", q("property"))
  const byCountry = useApiQuery("analyticsDelivery", { body: topCountryQuery(c.id, days) })
  const byCreative = useApiQuery("analyticsDelivery", q("creative"))
  const byDevice = useApiQuery("analyticsDelivery", q("device"))

  const t = byDay.data?.totals
  const prev = byDay.data?.previous
  const delta = (k: keyof Metrics) => {
    const cur = t?.[k] as number | null | undefined, p = prev?.[k] as number | null | undefined
    return cur == null || !p ? (cur ? null : undefined) : (cur - p) / p
  }
  const series = (byDay.data?.rows ?? []).map((r) => ({ day: fmt.day(r.key), imp: r.imp, clk: r.clk, cost: r.cost }))
  const fmtMetric = metric === "cost" ? fmt.usd : fmt.compact

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" variant="outline" size="sm" value={String(days)} onValueChange={(v) => v && setDays(Number(v))} aria-label="Date range">
          {RANGES.map((d) => <ToggleGroupItem key={d} value={String(d)} className="px-3">Last {d} days</ToggleGroupItem>)}
        </ToggleGroup>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden />
          Ad requests and fill rate aren’t attributed to campaigns, so they’re hidden here. See Analytics for supply metrics.
        </p>
      </div>

      <ScreenState query={byDay} loading={<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>}>
        {t && t.imp === 0 && !prev?.imp ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            No delivery in the last {days} days. Performance appears here once the campaign serves.
          </div>
        ) : t ? (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <KpiCard label="Impressions" value={metricFmt("imp", t.imp)} delta={delta("imp")} deltaLabel="vs previous" />
              <KpiCard label="Clicks" value={metricFmt("clk", t.clk)} delta={delta("clk")} deltaLabel="vs previous" />
              <KpiCard label="CTR" value={metricFmt("ctr", t.ctr)} delta={delta("ctr")} deltaLabel="vs previous" />
              <KpiCard label="Conversions" value={fmt.int(t.conv)} delta={delta("conv")} deltaLabel="vs previous" />
              <KpiCard label="Spend · internal" value={metricFmt("cost", t.cost)} delta={delta("cost")} deltaLabel="vs previous" />
              <KpiCard label="Viewability" value={metricFmt("viewRate", t.viewRate)} tip="Viewable impressions ÷ impressions." />
            </div>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{TREND_METRICS.find((m) => m.key === metric)?.label} per day</CardTitle>
                <CardDescription>{byDay.data ? fmt.range(byDay.data.range.from, byDay.data.range.to) : ""} · reporting time zone</CardDescription>
                <CardAction>
                  <ToggleGroup type="single" variant="outline" size="sm" value={metric} onValueChange={(v) => v && setMetric(v as typeof metric)} aria-label="Chart metric">
                    {TREND_METRICS.map((m) => <ToggleGroupItem key={m.key} value={m.key} className="px-2.5">{m.label}</ToggleGroupItem>)}
                  </ToggleGroup>
                </CardAction>
              </CardHeader>
              <CardContent><TrendChart data={series} dataKey={metric} label={TREND_METRICS.find((m) => m.key === metric)!.label} format={fmtMetric} /></CardContent>
            </Card>
          </div>
        ) : null}
      </ScreenState>

      <div className="grid gap-6 lg:grid-cols-2">
        <BreakdownTable title="By property" col="Property" q={byProp} />
        <BreakdownTable title="Top countries" col="Country" q={byCountry} limit={8} code />
        <BreakdownTable title="By creative" col="Creative" q={byCreative} />
        <BreakdownTable title="By device" col="Device" q={byDevice} label={(r) => DEVICE_LABEL[r.key as keyof typeof DEVICE_LABEL] ?? r.label} />
      </div>
    </div>
  )
}

function BreakdownTable({ title, col, q, limit = 20, code, label }: {
  title: string
  col: string
  q: { data?: { rows: Row[] }; isPending: boolean; isError: boolean; error?: unknown; refetch: () => unknown }
  limit?: number
  code?: boolean
  label?: (r: Row) => string
}) {
  const rows = (q.data?.rows ?? []).filter((r) => r.imp > 0).slice(0, limit)
  return (
    <Card className="min-w-0">
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="px-0">
        <ScreenState query={q} loading={<div className="flex flex-col gap-2 px-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>}>
          {rows.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">No delivery in this range.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{col}</TableHead>
                  <TableHead className="text-right">Impr.</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Conv.</TableHead>
                  <TableHead className="pr-4 text-right">Spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="max-w-56 truncate pl-4 whitespace-nowrap">
                      {code && <span className="mr-1.5 font-mono text-xs text-muted-foreground">{r.key}</span>}
                      {r.href ? <Link href={r.href} className="hover:underline">{label ? label(r) : r.label}</Link> : (label ? label(r) : r.label)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt.compact(r.imp)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt.int(r.clk)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt.pct(r.ctr)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt.int(r.conv)}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{fmt.usd(r.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScreenState>
      </CardContent>
    </Card>
  )
}

const VERB: Record<string, string> = {
  "campaign.created": "created", "campaign.updated": "edited", "campaign.published": "published", "campaign.scheduled": "scheduled",
  "campaign.paused": "paused", "campaign.resumed": "resumed", "campaign.archived": "archived", "campaign.restored": "restored",
  "campaign.duplicated": "created", "campaign.completed": "completed",
}

function ActivityTab({ c }: { c: CampaignListItem }) {
  const api = useApi()
  const query = { targetId: c.id, limit: 25 }
  const audit = useInfiniteQuery({
    queryKey: [...apiKey("listAudit", { query }), "infinite"],
    queryFn: ({ pageParam, signal }) => api.call("listAudit", { query: { ...query, ...(pageParam ? { cursor: pageParam } : {}) }, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  })
  const revisions = useApiQuery("campaignRevisions", { params: { id: c.id } })
  const items = (audit.data?.pages ?? []).flatMap((p) => p.items)

  return (
    <div className="grid items-start gap-6 lg:grid-cols-3">
      <Card className="min-w-0 lg:col-span-2">
        <CardHeader><CardTitle>Activity</CardTitle><CardDescription>Every change to this campaign, newest first.</CardDescription></CardHeader>
        <CardContent>
          <ScreenState query={audit}>
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">No activity recorded for this campaign yet.</div>
            ) : (
              <div className="flex flex-col gap-3">
                <ol className="flex flex-col divide-y">
                  {items.map((x) => (
                    <li key={x.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground" aria-hidden>
                        {x.actor.id ? fmt.initials(x.actor.name) : "SY"}
                      </span>
                      <div className="min-w-0 flex-1 text-sm">
                        <p>
                          <span className="font-medium">{x.actor.name}</span> {VERB[x.action] ?? x.action.split(".").pop()} <span className="font-medium">{x.target.name}</span>
                          {x.action === "campaign.duplicated" && " as a copy"}
                        </p>
                        {x.detail && <p className="break-words text-muted-foreground">{x.detail}</p>}
                        <p className="text-xs text-muted-foreground" title={fmt.dateTime(x.at)}>{fmt.ago(x.at)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                {audit.hasNextPage && (
                  <Button variant="outline" size="sm" className="self-center" onClick={() => void audit.fetchNextPage()} disabled={audit.isFetchingNextPage}>
                    {audit.isFetchingNextPage && <Loader2 className="animate-spin" />} Load older activity
                  </Button>
                )}
              </div>
            )}
          </ScreenState>
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader><CardTitle>Publish history</CardTitle><CardDescription>Each publish saves a revision.</CardDescription></CardHeader>
        <CardContent>
          <ScreenState query={revisions} loading={<Skeleton className="h-24 w-full" />}>
            {!revisions.data?.items.length ? (
              <p className="text-sm text-muted-foreground">Not published yet.</p>
            ) : (
              <ol className="flex flex-col divide-y">
                {revisions.data.items.map((r, i) => (
                  <li key={r.id} className="flex flex-col gap-1 py-2.5 text-sm first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">Revision {r.rev}{i === 0 && <Badge variant="secondary" className="ml-2">Latest</Badge>}</span>
                      <span className="text-xs text-muted-foreground" title={fmt.dateTime(r.at)}>{fmt.ago(r.at)}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">by {r.publishedByName ?? "System"}</span>
                    {r.diff.length > 0 ? (
                      <ul className="list-disc pl-4 text-xs text-muted-foreground">{r.diff.slice(0, 6).map((d, j) => <li key={j} className="break-words">{d}</li>)}</ul>
                    ) : (
                      <span className="text-xs text-muted-foreground">{i === revisions.data.items.length - 1 ? "First publish" : "No setting changes"}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </ScreenState>
        </CardContent>
      </Card>
    </div>
  )
}
