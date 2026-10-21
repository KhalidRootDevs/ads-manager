"use client"

import { useApiMutation, useApiQuery } from "@orbit/api-client/react"
import { AUDIENCE_STATUS_LABEL, EVENT_SOURCE_LABEL, type Audience } from "@orbit/domain"
import { Info, Plus, Trash2, UsersRound } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { ruleText } from "@/components/audiences/rule-text"
import { SegmentDialog } from "@/components/audiences/segment-dialog"
import { useAllCampaigns } from "@/components/billing/use-all-campaigns"
import { confirm } from "@/components/confirm-dialog"
import { KeyValue } from "@/components/domain/widgets"
import { GuardedLink } from "@/components/nav-guard"
import { PageContainer, PageHeader } from "@/components/page-header"
import { ScreenState } from "@/components/screen-state"
import { StatusBadge } from "@/components/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { fmt } from "@/lib/format"
import { toastError, useCan } from "@/lib/hooks"

export default function AudiencesPage() {
  const q = useApiQuery("listAudiences", {}, { select: (r) => r.items })
  const eventsQ = useApiQuery("listEvents", {}, { select: (r) => r.items })
  const campaigns = useAllCampaigns()
  const canWrite = useCan("audiences.write")
  const [open, setOpen] = useState(false)
  const [dialogKey, setDialogKey] = useState(0)
  const del = useApiMutation("deleteAudience", { onError: (e) => toastError(e, "Couldn’t delete the segment") })

  const audiences = useMemo(() => q.data ?? [], [q.data])
  const sourceOf = useMemo(() => Object.fromEntries((eventsQ.data ?? []).map((e) => [e.key, EVENT_SOURCE_LABEL[e.source]])), [eventsQ.data])
  const attached = (a: Audience) => (campaigns.data ?? []).filter((c) => c.status !== "archived" && c.constraints.audienceIds.includes(a.id))

  const openNew = () => {
    setDialogKey((k) => k + 1)
    setOpen(true)
  }

  const remove = async (a: Audience) => {
    const n = attached(a).length
    const ok = await confirm({
      title: `Delete “${a.name}”?`,
      description: `${n ? `${n} ${n === 1 ? "campaign references" : "campaigns reference"} it and will no longer list it. ` : ""}This can’t be undone.`,
      confirmLabel: "Delete segment",
      destructive: true,
    })
    if (!ok) return
    del.mutate({ params: { id: a.id } }, { onSuccess: () => toast.success("Segment deleted", { description: a.name }) })
  }

  const newButton = canWrite ? <Button onClick={openNew}><Plus /> New segment</Button> : undefined

  return (
    <PageContainer>
      <PageHeader
        title="Audiences"
        badges={<Badge variant="secondary">Future-ready</Badge>}
        description="Segments built from your own first-party events. Saved now, enforced once the event pipeline ships."
        actions={newButton}
      />

      <Alert>
        <Info />
        <AlertTitle>Saved, not enforced yet</AlertTitle>
        <AlertDescription>
          Segments can be attached to campaigns today, but targeting isn’t applied until user-level events flow from the SDKs into the warehouse. Sizes are estimates.
        </AlertDescription>
      </Alert>

      <ScreenState
        query={q}
        isEmpty={audiences.length === 0}
        empty={{
          icon: <UsersRound />,
          title: "No audience segments yet",
          description: "Build a segment from a tracked event, such as users who installed an app in the last 30 days.",
          action: newButton,
        }}
        loading={<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-60" />)}</div>}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {audiences.map((a) => {
            const used = attached(a)
            const n = used.length
            const deleting = del.isPending && del.variables?.params.id === a.id
            return (
              <Card key={a.id} className="min-w-0">
                <CardHeader>
                  <CardTitle className="break-words">{a.name}</CardTitle>
                  <CardDescription className="font-mono text-xs break-words">{ruleText(a.rule)}</CardDescription>
                  <CardAction><StatusBadge status={AUDIENCE_STATUS_LABEL[a.status]} /></CardAction>
                </CardHeader>
                <CardContent className="flex-1">
                  <KeyValue
                    items={[
                      { k: "Estimated size", v: a.estimate ? <span title={`Estimated ${fmt.dateTime(a.estimate.at)}`}>~{fmt.compact(a.estimate.size)} users</span> : <span className="font-normal text-muted-foreground">Not estimated yet</span> },
                      { k: "Source", v: sourceOf[a.rule.event] ?? "—" },
                      {
                        k: "Attached to",
                        v: campaigns.isPending ? <Skeleton className="h-4 w-24" /> : n === 0 ? (
                          <span className="font-normal text-muted-foreground">No campaigns yet</span>
                        ) : (
                          <span className="flex flex-col items-end gap-0.5">
                            {used.slice(0, 2).map((c) => (
                              <GuardedLink key={c.id} href={`/campaigns/${c.id}`} className="text-primary hover:underline">{c.name}</GuardedLink>
                            ))}
                            {n > 2 && <span className="text-xs font-normal text-muted-foreground">+{n - 2} more</span>}
                          </span>
                        ),
                      },
                      { k: "Created", v: fmt.date(a.createdAt) },
                    ]}
                  />
                </CardContent>
                {canWrite && (
                  <CardFooter className="justify-end">
                    <Button variant="destructive" size="sm" onClick={() => remove(a)} disabled={deleting} aria-label={`Delete segment ${a.name}`}>
                      <Trash2 /> {deleting ? "Deleting…" : "Delete"}
                    </Button>
                  </CardFooter>
                )}
              </Card>
            )
          })}
        </div>
      </ScreenState>

      {canWrite && <SegmentDialog key={dialogKey} open={open} onOpenChange={setOpen} existingNames={audiences.map((a) => a.name)} />}
    </PageContainer>
  )
}
