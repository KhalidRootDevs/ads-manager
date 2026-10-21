"use client"

import { Check, Info, TrendingDown, TrendingUp } from "lucide-react"
import { useEffect, useRef } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/** KPI tile with optional delta and a definition tooltip. */
export function KpiCard({ label, value, delta, deltaLabel, tip, className }: { label: string; value: string; delta?: number | null; deltaLabel?: string; tip?: string; className?: string }) {
  const up = (delta ?? 0) > 0.005, down = (delta ?? 0) < -0.005
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardContent className="flex flex-col gap-1.5 p-4">
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="truncate">{label}</span>
          {tip && (
            <Tooltip>
              <TooltipTrigger asChild><button type="button" className="rounded-full text-muted-foreground/70 hover:text-foreground" aria-label={tip}><Info className="size-3.5" /></button></TooltipTrigger>
              <TooltipContent className="max-w-64">{tip}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        {delta !== undefined && (
          <div className={cn("flex items-center gap-1 text-xs", up ? "text-emerald-600 dark:text-emerald-400" : down ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
            {delta === null ? <span>New</span> : (
              <>
                {up ? <TrendingUp className="size-3.5" /> : down ? <TrendingDown className="size-3.5" /> : null}
                <span className="font-medium">{(delta >= 0 ? "+" : "") + (delta * 100).toFixed(1)}%</span>
              </>
            )}
            {deltaLabel && <span className="text-muted-foreground">{deltaLabel}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Area chart of one metric over days. `data` rows need `day` plus the metric key. */
export function TrendChart({ data, dataKey, label, format, className }: { data: Record<string, unknown>[]; dataKey: string; label: string; format?: (v: number) => string; className?: string }) {
  const config = { [dataKey]: { label, color: "var(--chart-1)" } } satisfies ChartConfig
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-64 w-full", className)}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.25} />
            <stop offset="95%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} />
        <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v) => (format ? format(v) : String(v))} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" formatter={(v) => <span className="font-mono font-medium tabular-nums">{format ? format(Number(v)) : String(v)}</span>} />} />
        <Area isAnimationActive={false} dataKey={dataKey} type="monotone" fill={`url(#fill-${dataKey})`} stroke={`var(--color-${dataKey})`} strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  )
}

/** Requests vs impressions per day — keeps ad requests visibly distinct from served impressions. */
export function RequestsChart({ data, className }: { data: { day: string; req: number; imp: number }[]; className?: string }) {
  const config = { req: { label: "Ad requests", color: "color-mix(in oklab, var(--chart-2) 45%, transparent)" }, imp: { label: "Impressions served", color: "var(--chart-1)" } } satisfies ChartConfig
  const compact = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? Math.round(v / 1e3) + "K" : String(v))
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-64 w-full", className)}>
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }} barGap={2}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={compact} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v, n) => <div className="flex w-full justify-between gap-4"><span className="text-muted-foreground">{config[n as "req" | "imp"]?.label}</span><span className="font-mono font-medium tabular-nums">{Number(v).toLocaleString()}</span></div>} />} />
        <Bar isAnimationActive={false} dataKey="req" fill="var(--color-req)" radius={[3, 3, 0, 0]} />
        <Bar isAnimationActive={false} dataKey="imp" fill="var(--color-imp)" radius={[3, 3, 0, 0]} />
        <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
      </BarChart>
    </ChartContainer>
  )
}

/** Horizontal step indicator for wizards. Steps up to `maxStep` are clickable. */
export function Stepper({ steps, current, maxStep, onStep, errorSteps = [] }: { steps: string[]; current: number; maxStep: number; onStep: (n: number) => void; errorSteps?: number[] }) {
  const navRef = useRef<HTMLElement>(null)
  // Keep the current step visible when the step bar scrolls horizontally (narrow screens).
  useEffect(() => {
    const nav = navRef.current
    const el = nav?.querySelector<HTMLElement>("[aria-current=step]")
    if (!nav || !el) return
    const left = el.offsetLeft - nav.offsetLeft
    if (left < nav.scrollLeft || left + el.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: Math.max(0, left - 16), behavior: "smooth" })
  }, [current])
  return (
    <nav ref={navRef} aria-label="Progress" className="-mx-1 overflow-x-auto pb-1">
      <ol className="flex min-w-max items-center gap-1 px-1">
        {steps.map((label, i) => {
          const n = i + 1, cur = n === current, done = n < current || (n <= maxStep && !cur), err = errorSteps.includes(n)
          return (
            <li key={label} className="flex items-center gap-1">
              {i > 0 && <span className="h-px w-4 bg-border sm:w-6" aria-hidden />}
              <button
                type="button"
                disabled={n > maxStep}
                onClick={() => onStep(n)}
                aria-current={cur ? "step" : undefined}
                className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50", cur ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                <span className={cn("grid size-6 place-items-center rounded-full text-xs font-semibold", cur ? "bg-primary text-primary-foreground" : err ? "bg-red-500/15 text-red-600" : done ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                  {done && !cur && !err ? <Check className="size-3.5" /> : n}
                </span>
                <span className={cn(!cur && "sr-only md:not-sr-only")}>{label}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Simple label/value list. */
export function KeyValue({ items, className }: { items: { k: React.ReactNode; v: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("divide-y text-sm", className)}>
      {items.map((x, i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="shrink-0 text-muted-foreground">{x.k}</dt>
          <dd className="min-w-0 text-right font-medium break-words">{x.v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Thin progress bar with tone. */
export function Meter({ value, tone = "primary", className }: { value: number; tone?: "primary" | "warning" | "danger" | "success"; className?: string }) {
  const c = { primary: "bg-primary", warning: "bg-amber-500", danger: "bg-red-500", success: "bg-emerald-500" }[tone]
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-all", c)} style={{ width: Math.max(0, Math.min(100, value * 100)) + "%" }} />
    </div>
  )
}
