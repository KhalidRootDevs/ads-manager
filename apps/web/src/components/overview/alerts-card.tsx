"use client"

import { useApiMutation } from "@orbit/api-client/react"
import { ALERT_SEVERITY_LABEL, type Alert, type AlertType } from "@orbit/domain"
import { AlertTriangle, ArrowRight, Check, CircleCheck, OctagonAlert } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { TileState } from "@/components/analytics/tile"
import { GuardedLink } from "@/components/nav-guard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { fmt } from "@/lib/format"
import { toastError, useAlerts, useCan } from "@/lib/hooks"
import { cn } from "@/lib/utils"

const VISIBLE = 3

/** Short category and call to action per alert type. */
const ALERT_TYPE: Record<AlertType, { label: string; action: string }> = {
  creative_rejected: { label: "Creative rejected", action: "Review creative" },
  not_delivering: { label: "Not delivering", action: "Open campaign" },
  country_conflict: { label: "Targeting conflict", action: "Fix targeting" },
  sdk_heartbeat_missing: { label: "SDK heartbeat missing", action: "Open diagnostics" },
  sdk_degraded: { label: "SDK degraded", action: "Open diagnostics" },
  budget_exhausted: { label: "Budget spent", action: "Review budget" },
  behind_pace: { label: "Behind pace", action: "Open campaign" },
}

/** Open alerts maintained by the jobs worker. Acknowledging hides an alert until it re-fires. */
export function AlertsCard({ className }: { className?: string }) {
  const q = useAlerts()
  const canAck = useCan("alerts.ack")
  const [expanded, setExpanded] = useState(false)
  const ack = useApiMutation("ackAlert", {
    onSuccess: (a) => toast.success("Alert acknowledged", { description: a.title }),
    onError: (e) => toastError(e, "Couldn’t acknowledge the alert"),
  })
  const alerts = (q.data ?? []).filter((a) => a.status === "open")
  const critical = alerts.filter((a) => a.severity === "critical").length
  // Critical first, then most recent, so the collapsed list shows what blocks delivery.
  const sorted = [...alerts].sort((x, y) => Number(y.severity === "critical") - Number(x.severity === "critical") || y.lastSeenAt.localeCompare(x.lastSeenAt))
  const list = expanded ? sorted : sorted.slice(0, VISIBLE)

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Delivery alerts</CardTitle>
        <CardDescription>
          {alerts.length ? `${critical} critical · ${alerts.length - critical} warning` : "Campaigns, creatives, targeting and SDK health"}
        </CardDescription>
        {alerts.length > 0 && (
          <CardAction>
            <Badge variant="destructive">{alerts.length} open</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        <TileState q={q} skeleton="h-48">
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
              <CircleCheck className="size-4 shrink-0" />
              All campaigns and SDKs are healthy.
            </div>
          ) : (
            <>
              <ul className="flex flex-col gap-2.5">
                {list.map((a) => <AlertItem key={a.id} a={a} canAck={canAck} acking={ack.isPending && ack.variables?.params.id === a.id} onAck={() => ack.mutate({ params: { id: a.id } })} />)}
              </ul>
              {alerts.length > VISIBLE && (
                <Button variant="ghost" size="sm" className="self-start" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
                  {expanded ? "Show fewer" : `Show ${alerts.length - VISIBLE} more`}
                </Button>
              )}
            </>
          )}
        </TileState>
      </CardContent>
    </Card>
  )
}

function AlertItem({ a, canAck, acking, onAck }: { a: Alert; canAck: boolean; acking: boolean; onAck: () => void }) {
  const crit = a.severity === "critical"
  const Icon = crit ? OctagonAlert : AlertTriangle
  const meta = ALERT_TYPE[a.type]
  return (
    <li className={cn("flex gap-3 rounded-lg border border-l-4 p-3", crit ? "border-l-destructive bg-destructive/5" : "border-l-amber-500 bg-amber-500/5")}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", crit ? "text-destructive" : "text-amber-600 dark:text-amber-400")} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn("text-xs font-medium tracking-wide uppercase", crit ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
          <span className="sr-only">{ALERT_SEVERITY_LABEL[a.severity]}: </span>
          {meta?.label ?? a.type}
        </span>
        <span className="text-sm font-medium break-words">{a.title}</span>
        <p className="text-sm text-muted-foreground">{a.message}</p>
        <span className="text-xs text-muted-foreground">
          <time dateTime={a.firstSeenAt} title={fmt.dateTime(a.firstSeenAt)}>Since {fmt.ago(a.firstSeenAt)}</time>
        </span>
        <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
          <GuardedLink href={a.href} className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline">
            {meta?.action ?? "Open"} <ArrowRight className="size-3.5" />
          </GuardedLink>
          {canAck && (
            <Button variant="ghost" size="xs" onClick={onAck} disabled={acking} aria-label={`Acknowledge alert: ${a.title}`} title="Hide this alert until it fires again">
              <Check /> {acking ? "Acknowledging…" : "Acknowledge"}
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}
