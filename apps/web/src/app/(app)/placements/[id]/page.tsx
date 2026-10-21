"use client"

import { ApiError, useApiMutation, useApiQuery } from "@orbit/api-client/react"
import { compat, CREATIVE_STATUS_LABEL, FORMAT_LABEL, PLATFORM_LABEL, sizeLabel, type Placement } from "@orbit/domain"
import { CircleCheck, Pause, Pencil, Play, TriangleAlert } from "lucide-react"
import { useParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { confirm } from "@/components/confirm-dialog"
import { MissingState } from "@/components/creatives/creative-bits"
import { PlacementDialog } from "@/components/domain/placement-dialog"
import { KeyValue, KpiCard, RequestsChart } from "@/components/domain/widgets"
import { GuardedLink } from "@/components/nav-guard"
import { PageContainer, PageHeader } from "@/components/page-header"
import { eligibleCampaigns, freqLabel, refreshLabel, requestSeries, sizeMatters, useDelivery, useMutationError } from "@/components/placements/placement-utils"
import { ScreenState } from "@/components/screen-state"
import { PlatformBadge, StatusBadge } from "@/components/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { fmt } from "@/lib/format"
import { useCan, useCreatives } from "@/lib/hooks"

export default function PlacementDetailPage() {
  const { id } = useParams<{ id: string }>()
  const q = useApiQuery("getPlacement", { params: { id } })
  if (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400)) {
    return (
      <PageContainer>
        <MissingState title="Placement not found" description="It may have been removed, or the link is incorrect." href="/placements" label="Back to placements" />
      </PageContainer>
    )
  }
  return (
    <PageContainer>
      <ScreenState query={q} loading={<div className="flex flex-col gap-6"><Skeleton className="h-4 w-28" /><Skeleton className="h-8 w-72" /><Skeleton className="h-24 w-full" /><Skeleton className="h-72 w-full" /></div>}>
        {q.data && <Detail pl={q.data} />}
      </ScreenState>
    </PageContainer>
  )
}

function Detail({ pl }: { pl: Placement }) {
  const canWrite = useCan("properties.write")
  const propQ = useApiQuery("getProperty", { params: { id: pl.propertyId } })
  const p = propQ.data
  const creativesQ = useCreatives()
  const campsQ = useApiQuery("listCampaigns", { query: { propertyId: pl.propertyId, limit: 100 } })
  const a7 = useDelivery({ placement: [pl.id] }, 7)
  const d14 = useDelivery({ placement: [pl.id] }, 14, "day")
  const [editOpen, setEditOpen] = useState(false)
  const [testId, setTestId] = useState<string>("")
  const onError = useMutationError("placements")
  const patch = useApiMutation("patchPlacement", {
    onSuccess: (x) => { toast.success(x.status === "paused" ? "Placement paused" : "Placement activated") },
    onError: (e) => onError(e),
  })

  const camps = eligibleCampaigns(pl.id, campsQ.data?.items ?? [])
  const pool = creativesQ.data ?? []
  const crById = Object.fromEntries(pool.map((c) => [c.id, c]))
  const compatible = pool.filter((c) => compat(c, pl).ok)
  const others = pool.filter((c) => !compat(c, pl).ok)
  const test = crById[testId] ?? compatible[0] ?? pool[0]
  const result = test ? compat(test, pl) : null
  const target = `${FORMAT_LABEL[pl.format]}${sizeMatters(pl.format) ? ` at ${sizeLabel(pl.size)}` : ""}`
  const t = a7.data?.totals
  const series = requestSeries(d14.data?.rows)
  const hasData = series.some((d) => d.req || d.imp)
  const kpi = (v: string) => (a7.data ? v : "…")

  const setStatus = async (status: Placement["status"]) => {
    if (status === "paused") {
      const ok = await confirm({
        title: `Pause ${pl.name}?`,
        description: camps.length
          ? `${camps.length} campaign${camps.length === 1 ? " uses" : "s use"} this placement (${camps.map((c) => c.name).join(", ")}). The SDK will get no-fill responses here until you activate it again.`
          : "No live campaigns use this placement. The SDK will get no-fill responses here until you activate it again.",
        confirmLabel: "Pause placement",
        destructive: true,
      })
      if (!ok) return
    }
    patch.mutate({ params: { id: pl.id }, body: { rev: pl.rev, status } })
  }

  return (
    <>
      <PageHeader
        backHref="/placements"
        backLabel="Placements"
        title={pl.name}
        badges={<><StatusBadge status={pl.status} /><span className="font-mono text-xs break-all text-muted-foreground">{pl.id}</span></>}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {p ? <GuardedLink href={`/properties/${p.id}`} className="font-medium text-foreground hover:underline">{p.name}</GuardedLink> : <span className="font-mono text-xs">{pl.propertyId}</span>}
            {p && <PlatformBadge type={p.platform} />}
            <span>· {FORMAT_LABEL[pl.format]} · <span className="font-mono">{sizeLabel(pl.size)}</span></span>
          </span>
        }
        actions={
          canWrite ? (
            <>
              <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button>
              {pl.status === "active" ? (
                <Button variant="outline" onClick={() => setStatus("paused")} disabled={patch.isPending}><Pause /> Pause</Button>
              ) : (
                <Button onClick={() => setStatus("active")} disabled={patch.isPending}><Play /> Activate</Button>
              )}
            </>
          ) : undefined
        }
      />

      {pl.status === "paused" && (
        <Alert>
          <Pause />
          <AlertTitle>This placement is paused</AlertTitle>
          <AlertDescription>Ad requests from this slot get no-fill responses, so {camps.length ? `${camps.length} eligible campaign${camps.length === 1 ? "" : "s"} can’t serve here` : "nothing serves here"}.</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Requests · 7d" value={kpi(fmt.compact(t?.req))} tip="Ad requests the SDK or tag sent for this placement." />
        <KpiCard label="Impressions · 7d" value={kpi(fmt.compact(t?.imp))} tip="Ads actually rendered." />
        <KpiCard label="Fill rate" value={kpi(t?.req ? fmt.pct(t.fill, 1) : "—")} tip="Impressions divided by requests, last 7 days." />
        <KpiCard label="CTR" value={kpi(t?.imp ? fmt.pct(t.ctr) : "—")} tip="Clicks divided by impressions, last 7 days." />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent delivery</CardTitle>
              <CardDescription>Ad requests vs impressions served, last 14 days.</CardDescription>
            </CardHeader>
            <CardContent>
              {d14.isPending ? <Skeleton className="h-64 w-full" /> : hasData ? <RequestsChart data={series} /> : (
                <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{d14.isError ? "Delivery data couldn’t be loaded right now." : "No requests in the last 14 days."}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Eligible campaigns</CardTitle>
              <CardDescription>Scheduled, active or paused campaigns that target this placement.</CardDescription>
            </CardHeader>
            <CardContent>
              {campsQ.isPending ? (
                <div className="flex flex-col gap-2">{[0, 1].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : camps.length ? (
                <ul className="divide-y text-sm">
                  {camps.map((c) => {
                    const ok = c.creativeIds.map((cid) => crById[cid]).filter((x) => x && compat(x, pl).ok)
                    return (
                      <li key={c.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <div className="min-w-0">
                          <GuardedLink href={`/campaigns/${c.id}`} className="block truncate font-medium hover:underline">{c.name}</GuardedLink>
                          {ok.length ? (
                            <div className="text-xs text-muted-foreground">
                              Serves {ok.map((x, i) => (
                                <span key={x.id}>{i > 0 && ", "}<GuardedLink href={`/creatives/${x.id}`} className="hover:text-foreground hover:underline">{x.name}</GuardedLink></span>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                              <TriangleAlert className="size-3.5 shrink-0" /> No compatible creative — needs {target}
                            </div>
                          )}
                        </div>
                        <StatusBadge status={c.status} />
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No live or scheduled campaign targets this placement yet.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Compatibility checker</CardTitle>
              <CardDescription>Check whether a creative can serve here. {creativesQ.data ? `${compatible.length} of ${pool.length} creatives are compatible.` : ""}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="compat-cr">Creative</FieldLabel>
                <Select value={test?.id ?? ""} onValueChange={setTestId} disabled={!pool.length}>
                  <SelectTrigger id="compat-cr" className="w-full"><SelectValue placeholder={creativesQ.isPending ? "Loading creatives…" : "Choose a creative"} /></SelectTrigger>
                  <SelectContent>
                    {compatible.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Compatible</SelectLabel>
                        {compatible.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} <span className="text-muted-foreground">· {sizeLabel(c.size)}</span></SelectItem>)}
                      </SelectGroup>
                    )}
                    {others.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Other creatives</SelectLabel>
                        {others.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} <span className="text-muted-foreground">· {FORMAT_LABEL[c.format]}</span></SelectItem>)}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </Field>
              {test && result && (
                result.ok ? (
                  <Alert className="border-emerald-600/30 bg-emerald-500/5">
                    <CircleCheck className="text-emerald-600 dark:text-emerald-400" />
                    <AlertTitle>Compatible</AlertTitle>
                    <AlertDescription>
                      {test.name} can serve here.
                      {test.status !== "ready" && ` It is ${CREATIVE_STATUS_LABEL[test.status].toLowerCase()}, so it won’t serve until it is Ready.`}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert className="border-amber-500/40 bg-amber-500/5">
                    <TriangleAlert className="text-amber-600 dark:text-amber-400" />
                    <AlertTitle>Not compatible</AlertTitle>
                    <AlertDescription>{result.reason}. Pick a creative with format {target}.</AlertDescription>
                  </Alert>
                )
              )}
              {creativesQ.data && pool.length === 0 && <p className="text-sm text-muted-foreground">No creatives to check yet.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValue
                items={[
                  { k: "Placement ID", v: <span className="font-mono text-xs break-all">{pl.id}</span> },
                  { k: "Property", v: p ? `${p.name} · ${PLATFORM_LABEL[p.platform]}` : <span className="font-mono text-xs break-all">{pl.propertyId}</span> },
                  { k: "Format", v: FORMAT_LABEL[pl.format] },
                  { k: "Dimensions", v: <span className="font-mono text-xs">{sizeLabel(pl.size)}</span> },
                  { k: "Min app version", v: pl.minAppVersion ?? "—" },
                  { k: "Frequency cap", v: freqLabel(pl) || "None" },
                  { k: "Refresh interval", v: refreshLabel(pl) || "—" },
                  { k: "Status", v: <StatusBadge status={pl.status} /> },
                  { k: "Updated", v: fmt.dateTime(pl.updatedAt) },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <PlacementDialog open={editOpen} onOpenChange={setEditOpen} editId={pl.id} />
    </>
  )
}
