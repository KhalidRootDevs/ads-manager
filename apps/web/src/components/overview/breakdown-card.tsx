"use client"

import { useState } from "react"
import { TileState } from "@/components/analytics/tile"
import { useDelivery, type Scope } from "@/components/analytics/use-analytics"
import { Meter } from "@/components/domain/widgets"
import { GuardedLink } from "@/components/nav-guard"
import { DIM_LABEL, type Dim } from "@/components/reports/dimensions"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmt } from "@/lib/format"

const DIMS: Dim[] = ["campaign", "property", "country", "format", "platform"]
const TOP = 8

/** Top rows of one grouping. Only the selected dimension is requested. */
export function BreakdownCard({ scope, className }: { scope: Scope; className?: string }) {
  const [dim, setDim] = useState<Dim>("campaign")
  const q = useDelivery(scope, dim, { limit: 100 })
  const all = (q.data?.rows ?? []).filter((r) => r.imp > 0 || (r.req ?? 0) > 0)
  const list = all.slice(0, TOP)

  return (
    <Card className={className}>
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Performance by {DIM_LABEL[dim].toLowerCase()}</CardTitle>
          <CardDescription>
            {all.length > TOP ? `Top ${TOP} of ${all.length} by impressions` : "Ranked by impressions"} · bar shows share of impressions
          </CardDescription>
        </div>
        <CardAction>
          <Button variant="outline" size="sm" asChild>
            <GuardedLink href="/reports">Full report</GuardedLink>
          </Button>
        </CardAction>
        <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={dim} onValueChange={(v) => v && setDim(v as Dim)} aria-label="Breakdown dimension" className="flex-wrap">
          {DIMS.map((d) => (
            <ToggleGroupItem key={d} value={d} className="data-[state=on]:bg-primary/10 data-[state=on]:text-primary">
              {DIM_LABEL[d]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardHeader>
      <CardContent>
        <TileState q={q} isEmpty={list.length === 0} skeleton="h-72" empty={<span className="block rounded-lg border border-dashed p-6">No delivery matches these filters.</span>}>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[42%] text-xs text-muted-foreground sm:w-[36%]">{DIM_LABEL[dim]}</TableHead>
                <TableHead className="text-xs text-muted-foreground">Impressions</TableHead>
                <TableHead className="hidden w-20 text-right text-xs text-muted-foreground sm:table-cell">Clicks</TableHead>
                <TableHead className="hidden w-16 text-right text-xs text-muted-foreground sm:table-cell">CTR</TableHead>
                <TableHead className="w-20 text-right text-xs text-muted-foreground">Spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="py-2.5 whitespace-normal">
                    <div className="flex min-w-0 flex-col">
                      {r.href ? (
                        <GuardedLink href={r.href} className="line-clamp-2 font-medium break-words hover:text-primary hover:underline sm:truncate" title={r.label}>{r.label}</GuardedLink>
                      ) : (
                        <span className="line-clamp-2 font-medium break-words sm:truncate" title={r.label}>{r.label}</span>
                      )}
                      {(r.sub || dim === "country") && <span className="truncate text-xs text-muted-foreground">{dim === "country" ? r.key : r.sub}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-2 tabular-nums">
                        <span>{fmt.compact(r.imp)}</span>
                        <span className="text-xs text-muted-foreground">{fmt.pct(r.share, 1)}</span>
                      </div>
                      <Meter value={r.share} />
                    </div>
                  </TableCell>
                  <TableCell className="hidden py-2.5 text-right tabular-nums sm:table-cell">{fmt.compact(r.clk)}</TableCell>
                  <TableCell className="hidden py-2.5 text-right tabular-nums sm:table-cell">{fmt.pct(r.ctr)}</TableCell>
                  <TableCell className="py-2.5 text-right tabular-nums">{fmt.usd(r.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TileState>
      </CardContent>
    </Card>
  )
}
