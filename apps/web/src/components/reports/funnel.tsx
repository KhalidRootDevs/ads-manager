"use client"

import { ChevronRight, Info } from "lucide-react"
import { Meter } from "@/components/domain/widgets"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Metrics } from "@orbit/domain"
import { fmt } from "@/lib/format"

export const METRIC_TIPS = {
  req: "Every ad call an SDK or web tag sends, whether or not an ad is returned. Requests are demand for an ad — not ads shown.",
  elig: "Requests that matched at least one live campaign’s property, placement, country and constraints.",
  imp: "Ads actually rendered on screen and counted by the impression beacon. Only these count as served.",
  fill: "Impressions ÷ ad requests. Low fill means requests arrived but no eligible campaign served.",
  clk: "Clicks recorded by the click tracker.",
  ctr: "Clicks ÷ impressions.",
  vs: "Video ads that began playing.",
  vc: "Videos played to the end.",
  vcr: "Completions ÷ video starts.",
  conv: "Tracked conversion events attributed to an ad click within 7 days.",
  ecpm: "Internal spend per 1,000 impressions.",
  err: "Requests that failed: timeouts, invalid keys or SDK errors.",
} as const

export function InfoTip({ tip }: { tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="rounded-full text-muted-foreground/70 hover:text-foreground" aria-label={tip}>
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{tip}</TooltipContent>
    </Tooltip>
  )
}

/** Ad requests → eligible → impressions → clicks → conversions, each with % of the previous stage. */
export function Funnel({ a }: { a: Metrics }) {
  // Without supply data the funnel starts at impressions (requests are null for campaign, creative and format filters).
  const top = a.req ?? a.imp
  const stages: { label: string; value: number | null; prev: number | null | undefined; prevLabel: string; tip: string; kind: string }[] = [
    { label: "Ad requests", value: a.req, prev: null, prevLabel: "", tip: METRIC_TIPS.req, kind: "Demand" },
    { label: "Eligible requests", value: a.elig, prev: a.req, prevLabel: "of requests", tip: METRIC_TIPS.elig, kind: "Demand" },
    { label: "Impressions served", value: a.imp, prev: a.elig ?? undefined, prevLabel: "of eligible", tip: METRIC_TIPS.imp, kind: "Served" },
    { label: "Clicks", value: a.clk, prev: a.imp, prevLabel: "of impressions", tip: METRIC_TIPS.clk, kind: "Engagement" },
    { label: "Conversions", value: a.conv, prev: a.clk, prevLabel: "of clicks", tip: METRIC_TIPS.conv, kind: "Outcome" },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(5,minmax(0,1fr))]">
      {stages.map((s, i) => (
          <Card key={s.label} className={i === 0 ? "col-span-2 gap-0 py-0 sm:col-span-1" : "gap-0 py-0"}>
            <CardContent className="flex h-full flex-col gap-1.5 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{i + 1} · {s.kind}</span>
                <InfoTip tip={s.tip} />
              </div>
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <span className="text-2xl font-semibold tracking-tight tabular-nums">{s.value == null ? "—" : fmt.compact(s.value)}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {s.value == null ? "Not recorded for these filters" : s.prev === null ? "100% · starting point" : s.prev === undefined ? "—" : (
                  <>
                    <ChevronRight className="size-3" aria-hidden />
                    <span className="font-medium text-foreground tabular-nums">{fmt.pct(s.prev ? s.value / s.prev : 0, 1)}</span> {s.prevLabel}
                  </>
                )}
              </span>
              <Meter value={s.value == null ? 0 : top ? Math.max(0.015, s.value / top) : 0} className="mt-auto" tone={i >= 2 ? "success" : "primary"} />
            </CardContent>
          </Card>
      ))}
    </div>
  )
}
