"use client"

import { ApiError, useApiMutation, useApiQuery } from "@orbit/api-client/react"
import { APP_ONLY_FORMATS, creativeChecks, FORMAT_LABEL, isVideoCreative, SERVABLE_CAMPAIGN_STATUSES, sizeLabel, utmString, type Creative } from "@orbit/domain"
import { Archive, ArchiveRestore, CircleAlert, Copy, Ellipsis, Info, Loader2, Monitor, Pencil, Send, Smartphone, ThumbsDown, ThumbsUp } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { confirm } from "@/components/confirm-dialog"
import { CheckList, MissingState } from "@/components/creatives/creative-bits"
import { fileSize } from "@/components/creatives/creative-draft"
import { RejectDialog } from "@/components/creatives/reject-dialog"
import { AdPreview, adOf } from "@/components/domain/ad-preview"
import { KeyValue, KpiCard } from "@/components/domain/widgets"
import { GuardedLink } from "@/components/nav-guard"
import { PageContainer, PageHeader } from "@/components/page-header"
import { useDelivery, useMutationError } from "@/components/placements/placement-utils"
import { ScreenState } from "@/components/screen-state"
import { StatusBadge } from "@/components/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmt } from "@/lib/format"
import { useCan, useUserName } from "@/lib/hooks"

export default function CreativeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const q = useApiQuery("getCreative", { params: { id } })
  if (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400)) {
    return (
      <PageContainer>
        <MissingState title="Creative not found" description="It may have been removed, or the link is incorrect." href="/creatives" label="Back to creatives" />
      </PageContainer>
    )
  }
  return (
    <PageContainer>
      <ScreenState query={q} loading={<div className="flex flex-col gap-6"><Skeleton className="h-4 w-28" /><Skeleton className="h-8 w-80" /><div className="grid gap-6 xl:grid-cols-2"><Skeleton className="h-[560px]" /><Skeleton className="h-[560px]" /></div></div>}>
        {q.data && <Detail c={q.data} />}
      </ScreenState>
    </PageContainer>
  )
}

function Detail({ c }: { c: Creative }) {
  const router = useRouter()
  const canWrite = useCan("creatives.write")
  const canApprove = useCan("creatives.approve")
  const userName = useUserName()
  const [deviceChoice, setDevice] = useState<"mobile" | "desktop">("mobile")
  const [rejectOpen, setRejectOpen] = useState(false)
  const versionsQ = useApiQuery("creativeVersions", { params: { id: c.id } })
  const usedQ = useApiQuery("listCampaigns", { query: { creativeId: c.id, limit: 100 } })
  const perfQ = useDelivery({ creative: [c.id] }, 60)
  const onError = useMutationError("creatives")
  const body = { params: { id: c.id }, body: { rev: c.rev } }

  const submitM = useApiMutation("submitCreative", {
    onSuccess: (x) => { toast.success(x.status === "ready" ? "Approved. The creative can now serve." : "Submitted for review") },
    onError: (e) => onError(e, "Couldn’t submit"),
  })
  const approveM = useApiMutation("approveCreative", { onSuccess: () => { toast.success("Approved. The creative can now serve.") }, onError: (e) => onError(e, "Couldn’t approve") })
  const rejectM = useApiMutation("rejectCreative", {
    onSuccess: () => { setRejectOpen(false); toast.success("Creative rejected", { description: "The owner has been notified." }) },
    onError: (e) => onError(e, "Couldn’t reject"),
  })
  const archiveM = useApiMutation("archiveCreative", { onSuccess: () => { toast.success("Creative archived") }, onError: (e) => onError(e, "Couldn’t archive") })
  const restoreM = useApiMutation("restoreCreative", { onSuccess: () => { toast.success("Restored as draft") }, onError: (e) => onError(e, "Couldn’t restore") })
  const duplicateM = useApiMutation("duplicateCreative", {
    onSuccess: (x) => { toast.success("Duplicated as a draft"); router.push(`/creatives/${x.id}`) },
    onError: (e) => onError(e, "Couldn’t duplicate"),
  })
  const busy = submitM.isPending || approveM.isPending || rejectM.isPending || archiveM.isPending || restoreM.isPending || duplicateM.isPending

  const checks = creativeChecks(c)
  const failing = checks.filter((x) => !x.ok)
  const used = usedQ.data?.items ?? []
  const live = used.filter((x) => SERVABLE_CAMPAIGN_STATUSES.includes(x.status))
  const appOnly = APP_ONLY_FORMATS.includes(c.format)
  const isVideo = isVideoCreative(c)
  const device = appOnly ? "mobile" : deviceChoice
  const editHref = `/creatives/${c.id}/edit`
  const versions = [...(versionsQ.data?.items ?? [])].sort((a, b) => b.v - a.v)
  const perf = perfQ.data?.totals
  const main = c.assets.find((a) => a.kind === "video") ?? c.assets.find((a) => a.kind === "image")
  const icon = c.assets.find((a) => a.kind === "icon")
  const utm = utmString(c.destination.utm)
  const o = c.options

  const submit = () => {
    if (failing.length) {
      toast.error("Fix the failing checks before submitting for review.", { description: failing.map((x) => x.label).join(", ") })
      return
    }
    submitM.mutate(body)
  }
  const approve = async () => {
    if (failing.length && !(await confirm({ title: "Approve with failing checks?", description: `${failing.length} validation check${failing.length === 1 ? " is" : "s are"} failing (${failing.map((x) => x.label).join(", ")}). The creative may render badly in some placements.`, confirmLabel: "Approve anyway" }))) return
    approveM.mutate(body)
  }
  const archive = async () => {
    const ok = await confirm({
      title: `Archive “${c.name}”?`,
      description: live.length
        ? `It is used by ${live.length} live or scheduled campaign${live.length > 1 ? "s" : ""} (${live.map((x) => x.name).join(", ")}). Remove it from those campaigns or pause them first, otherwise archiving is blocked.`
        : "It isn’t used by any live or scheduled campaign. You can restore it later.",
      confirmLabel: "Archive",
      destructive: true,
    })
    if (ok) archiveM.mutate(body)
  }
  const restore = () => restoreM.mutate(body)
  const duplicate = () => duplicateM.mutate({ params: { id: c.id } })

  const primary = !canWrite ? null
    : c.status === "draft" ? <Button onClick={submit} disabled={busy}>{submitM.isPending ? <Loader2 className="animate-spin" /> : <Send />} {canApprove ? "Submit & approve" : "Submit for review"}</Button>
    : c.status === "in_review" ? (canApprove ? (
      <>
        <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={busy}><ThumbsDown /> Reject</Button>
        <Button onClick={approve} disabled={busy}>{approveM.isPending ? <Loader2 className="animate-spin" /> : <ThumbsUp />} Approve</Button>
      </>
    ) : null)
    : c.status === "rejected" ? <Button onClick={() => router.push(editHref)}><Pencil /> Edit and resubmit</Button>
    : c.status === "archived" ? <Button onClick={restore} disabled={busy}>{restoreM.isPending ? <Loader2 className="animate-spin" /> : <ArchiveRestore />} Restore</Button>
    : null

  const details = [
    { k: "Format", v: FORMAT_LABEL[c.format] },
    { k: "Dimensions", v: <span className="font-mono text-xs">{c.size ? sizeLabel(c.size) : "—"}</span> },
    { k: "File", v: main ? <a href={main.url} target="_blank" rel="noreferrer" className="font-mono text-xs break-all hover:underline">{main.name}</a> : "—" },
    { k: "File size", v: main ? `${fileSize(main.bytes)}${main.width && main.height ? ` · ${main.width}×${main.height}` : ""}${main.durationSec ? ` · ${Math.round(main.durationSec)}s` : ""}` : "—" },
    ...(c.format === "native" ? [{ k: "Icon", v: icon ? <span className="font-mono text-xs break-all">{icon.name}</span> : "—" }] : []),
    ...(c.format === "interstitial" ? [{ k: "Media", v: o.media === "video" ? "Video" : "Image" }] : []),
    { k: "Headline", v: c.copy.headline || "—" },
    { k: "Body", v: c.copy.body || "—" },
    { k: "CTA", v: c.copy.cta || "—" },
    { k: "Click URL", v: c.destination.url ? <span className="font-mono text-xs break-all">{c.destination.url}</span> : "—" },
    { k: "Deep link", v: c.destination.deepLink ? <span className="font-mono text-xs break-all">{c.destination.deepLink}</span> : "—" },
    { k: "Tracking", v: utm ? <span className="font-mono text-xs break-all">{utm}</span> : "—" },
    { k: "Alt text", v: c.altText || "—" },
    ...(c.format === "rewarded_video" ? [{ k: "Reward", v: o.reward || "—" }, { k: "Completion event", v: o.completionEvent ? <span className="font-mono text-xs">{o.completionEvent}</span> : "—" }] : []),
    ...(c.format === "interstitial" ? [{ k: "Close button after", v: `${o.closeDelaySec ?? 0}s` }] : []),
    ...(c.format === "app_open" ? [{ k: "Screen-safe content", v: o.safeArea ? "Confirmed" : "Not confirmed" }] : []),
    ...(c.format === "web_popup" ? [{ k: "Close button", v: o.closeButton !== false ? "Visible" : "Hidden" }, { k: "Frequency notice", v: o.freqNotice !== false ? "Shown" : "Hidden" }] : []),
  ]

  return (
    <>
      <PageHeader
        backHref="/creatives"
        backLabel="Ad creatives"
        title={c.name}
        badges={<StatusBadge status={c.status} />}
        description={<>{FORMAT_LABEL[c.format]}{c.size && <> · <span className="font-mono">{sizeLabel(c.size)}</span></>} · owned by {userName(c.ownerId)} · updated {fmt.date(c.updatedAt)}</>}
        actions={
          canWrite ? (
            <>
              {primary}
              {c.status !== "archived" && c.status !== "rejected" && <Button variant="outline" onClick={() => router.push(editHref)}><Pencil /> Edit</Button>}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More actions" disabled={busy}><Ellipsis /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={duplicate}><Copy /> Duplicate</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {c.status === "archived" ? (
                    <DropdownMenuItem onSelect={restore}><ArchiveRestore /> Restore</DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem variant="destructive" onSelect={archive}><Archive /> Archive</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : undefined
        }
      />

      {c.status === "rejected" && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Rejected in review{c.review.by ? ` by ${userName(c.review.by)}` : ""}</AlertTitle>
          <AlertDescription>
            <p>{c.review.reason || "This creative doesn’t meet the format guidelines."}</p>
          </AlertDescription>
        </Alert>
      )}
      {c.status === "in_review" && (
        <Alert>
          <Info />
          <AlertTitle>Waiting for review</AlertTitle>
          <AlertDescription>Campaigns can’t serve this creative until it is approved.</AlertDescription>
        </Alert>
      )}
      {c.status === "archived" && (
        <Alert>
          <Archive />
          <AlertTitle>Archived</AlertTitle>
          <AlertDescription>Archived creatives don’t serve and are hidden from the library. Restore it to edit or reuse it.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>Placeholder render with the creative’s copy and colour.</CardDescription>
              <CardAction>
                <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={device} onValueChange={(v) => v && setDevice(v as "mobile" | "desktop")} aria-label="Preview device">
                  <ToggleGroupItem value="mobile" aria-label="Mobile preview"><Smartphone /> <span className="hidden sm:inline">Mobile</span></ToggleGroupItem>
                  <ToggleGroupItem value="desktop" aria-label={appOnly ? "Desktop preview (not available for app-only formats)" : "Desktop preview"} disabled={appOnly} title={appOnly ? "App-only format — no desktop placement" : undefined}><Monitor /> <span className="hidden sm:inline">Desktop</span></ToggleGroupItem>
                </ToggleGroup>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-lg bg-muted/40">
                <AdPreview ad={adOf(c)} device={device} />
              </div>
              {appOnly && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Info className="size-3.5 shrink-0" /> {FORMAT_LABEL[c.format]} only runs inside mobile apps, so there is no desktop preview.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Validation</CardTitle>
              <CardDescription>
                {failing.length ? `${failing.length} of ${checks.length} checks failing` : `All ${checks.length} checks pass`} for {FORMAT_LABEL[c.format]}.
              </CardDescription>
              {failing.length > 0 && c.status !== "archived" && canWrite && (
                <CardAction><Button size="sm" variant="outline" onClick={() => router.push(editHref)}>Fix</Button></CardAction>
              )}
            </CardHeader>
            <CardContent><CheckList checks={checks} /></CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Performance</CardTitle>
              <CardDescription>Last 60 days, across all campaigns.</CardDescription>
            </CardHeader>
            <CardContent>
              {perfQ.isPending ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
              ) : perf && perf.imp > 0 ? (
                <div className={`grid grid-cols-2 gap-3 ${isVideo ? "sm:grid-cols-3 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1" : "sm:grid-cols-4"}`}>
                  <KpiCard label="Impressions" value={fmt.compact(perf.imp)} />
                  <KpiCard label="Clicks" value={fmt.compact(perf.clk)} />
                  <KpiCard label="CTR" value={fmt.pct(perf.ctr)} tip="Clicks divided by impressions." />
                  <KpiCard label="Conversions" value={fmt.int(perf.conv)} />
                  {isVideo && <KpiCard label="Completion rate" value={fmt.pct(perf.vcr, 1)} tip="Completed video views divided by video starts." />}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {perfQ.isError ? "Performance data couldn’t be loaded right now." : `No delivery in the last 60 days${c.status !== "ready" ? " — only Ready creatives can serve." : "."}`}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent><KeyValue items={details} /></CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Used in campaigns</CardTitle>
              <CardDescription>{usedQ.isPending ? "Loading…" : used.length ? `${used.length} campaign${used.length === 1 ? "" : "s"} · ${live.length} live or scheduled` : "Not attached to any campaign yet."}</CardDescription>
            </CardHeader>
            {used.length > 0 && (
              <CardContent>
                <ul className="divide-y text-sm">
                  {used.map((x) => (
                    <li key={x.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <GuardedLink href={`/campaigns/${x.id}`} className="block truncate font-medium hover:underline">{x.name}</GuardedLink>
                        <div className="text-xs text-muted-foreground">{fmt.range(x.flight.start, x.flight.end)}</div>
                      </div>
                      <StatusBadge status={x.status} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Version history</CardTitle>
              <CardDescription>Current version v{c.currentVersion}. Every saved edit adds a version.</CardDescription>
            </CardHeader>
            <CardContent>
              {versionsQ.isPending ? (
                <div className="flex flex-col gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : versions.length ? (
                <ol className="relative flex flex-col gap-4 border-l pl-5">
                  {versions.map((v, i) => (
                    <li key={v.id} className="relative text-sm">
                      <span className={`absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-card ${i === 0 ? "bg-primary" : "bg-muted-foreground/40"}`} aria-hidden />
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-mono text-xs font-semibold">v{v.v}</span>
                        <span className="font-medium">{v.note}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{v.byName ?? userName(v.by)} · {fmt.dateTime(v.at)}</div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">{versionsQ.isError ? "Version history couldn’t be loaded." : "No versions recorded."}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        name={c.name}
        liveCount={live.length}
        pending={rejectM.isPending}
        suggested={failing.length ? `Failing checks: ${failing.map((x) => `${x.label} (${x.detail})`).join("; ")}.` : "Does not meet format guidelines — see validation checks."}
        onReject={(reason) => rejectM.mutate({ params: { id: c.id }, body: { reason, rev: c.rev } })}
      />
    </>
  )
}
