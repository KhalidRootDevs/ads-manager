"use client"

import { useApiQuery } from "@orbit/api-client/react"
import { GuardedLink } from "@/components/nav-guard"
import { TileState } from "@/components/analytics/tile"
import { activityText, auditHref } from "@/components/settings/audit-utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { fmt } from "@/lib/format"

/** Latest five audit entries (the same feed as Settings → Audit log). */
export function ActivityCard({ className }: { className?: string }) {
  const q = useApiQuery("listAudit", { query: { limit: 5 } }, { refetchInterval: 60_000 })
  const items = q.data?.items ?? []
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Changes made by your team</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" asChild>
            <GuardedLink href="/settings?tab=audit">Audit log</GuardedLink>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <TileState q={q} isEmpty={items.length === 0} empty="No activity yet." skeleton="h-56">
          <ol className="flex flex-col gap-4">
            {items.map((a) => {
              const href = auditHref(a.target)
              const system = !a.actor.id
              return (
                <li key={a.id} className="flex gap-3">
                  <Avatar size="sm" className="mt-0.5">
                    <AvatarFallback className="text-[10px] font-medium">{system ? "SY" : fmt.initials(a.actor.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug break-words">
                      <span className="font-medium">{a.actor.name}</span> <span className="text-muted-foreground">{activityText(a.action)}</span>{" "}
                      {a.action === "member.joined" ? null : href ? (
                        <GuardedLink href={href} className="font-medium text-primary hover:underline">{a.target.name}</GuardedLink>
                      ) : (
                        <span className="font-medium">{a.target.name}</span>
                      )}
                    </p>
                    {a.detail && <p className="truncate text-xs text-muted-foreground" title={a.detail}>{a.detail}</p>}
                    <time dateTime={a.at} title={fmt.dateTime(a.at)} className="text-xs text-muted-foreground">{fmt.ago(a.at)}</time>
                  </div>
                </li>
              )
            })}
          </ol>
        </TileState>
      </CardContent>
    </Card>
  )
}
