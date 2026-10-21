"use client"

import { AlertTriangle, Info, RotateCw, TrendingDown, TrendingUp } from "lucide-react"
import { Area, AreaChart } from "recharts"
import type { QueryLike } from "@/components/screen-state"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { errorMessage } from "@/lib/hooks"
import { cn } from "@/lib/utils"

/** Bento tile: a card with a compact header. `className` carries the grid spans. */
export function Tile({ title, description, action, children, className, contentClassName }: { title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; contentClassName?: string }) {
  return (
    <Card className={cn("min-w-0 gap-4 py-5", className)}>
      {(title || action) && (
        <CardHeader className="px-5">
          {title && <CardTitle className="text-sm font-semibold">{title}</CardTitle>}
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
          {action && <CardAction>{action}</CardAction>}
        </CardHeader>
      )}
      <CardContent className={cn("min-w-0 px-5", contentClassName)}>{children}</CardContent>
    </Card>
  )
}

export function Delta({ value, invert, className }: { value: number | null; invert?: boolean; className?: string }) {
  if (value === null) return <span className={cn("text-xs text-muted-foreground", className)}>New</span>
  const good = invert ? value < -0.005 : value > 0.005
  const bad = invert ? value > 0.005 : value < -0.005
  const Icon = value >= 0 ? TrendingUp : TrendingDown
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums", good ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : bad ? "bg-red-500/10 text-red-700 dark:text-red-400" : "bg-muted text-muted-foreground", className)}>
      {Math.abs(value) >= 0.005 && <Icon className="size-3" />}
      {(value >= 0 ? "+" : "") + (value * 100).toFixed(1)}%
    </span>
  )
}

export function MetricInfo({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="rounded-full text-muted-foreground/70 hover:text-foreground" aria-label={text}><Info className="size-3.5" /></button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  )
}

/** Small sparkline (no axes). */
export function Spark({ data, dataKey, color = "var(--chart-1)", className }: { data: Record<string, unknown>[]; dataKey: string; color?: string; className?: string }) {
  const config = { [dataKey]: { label: dataKey, color } } satisfies ChartConfig
  const id = `spark-${dataKey}`
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-12 w-full", className)}>
      <AreaChart data={data} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.3} />
            <stop offset="100%" stopColor={`var(--color-${dataKey})`} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area isAnimationActive={false} dataKey={dataKey} type="monotone" stroke={`var(--color-${dataKey})`} strokeWidth={1.75} fill={`url(#${id})`} dot={false} />
      </AreaChart>
    </ChartContainer>
  )
}

/** Compact KPI tile: label, value, change vs previous period, sparkline. */
export function KpiTile({ label, value, delta, invert, tip, spark, sparkKey, className }: { label: string; value: string; delta?: number | null; invert?: boolean; tip?: string; spark?: Record<string, unknown>[]; sparkKey?: string; className?: string }) {
  return (
    <Card className={cn("min-w-0 gap-0 py-0", className)}>
      <CardContent className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
          <span className="truncate">{label}</span>
          {tip && <MetricInfo text={tip} />}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
          {delta !== undefined && <Delta value={delta} invert={invert} />}
        </div>
        {spark && sparkKey && <Spark data={spark} dataKey={sparkKey} className="mt-auto" />}
      </CardContent>
    </Card>
  )
}

/** Ranked list row with share bar. */
export function BarRow({ label, sub, value, share, onClick, active, right }: { label: React.ReactNode; sub?: React.ReactNode; value: string; share: number; onClick?: () => void; active?: boolean; right?: React.ReactNode }) {
  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 truncate text-sm">
          <span className={cn("font-medium", active && "text-primary")}>{label}</span>
          {sub && <span className="ml-1.5 text-xs text-muted-foreground">{sub}</span>}
        </div>
        <div className="flex shrink-0 items-baseline gap-2 text-sm tabular-nums">{right}<span className="font-medium">{value}</span></div>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", active ? "bg-primary" : "bg-primary/70")} style={{ width: Math.max(1.5, share * 100) + "%" }} />
      </div>
    </>
  )
  if (onClick) return <button type="button" onClick={onClick} className="-mx-2 w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60" aria-pressed={active}>{inner}</button>
  return <div className="py-1.5">{inner}</div>
}

/** Compact loading / error / empty states inside one tile (the page keeps working if one query fails). */
export function TileState({ q, isEmpty, empty = "No delivery for these filters.", skeleton = "h-40", children }: { q: QueryLike | QueryLike[]; isEmpty?: boolean; empty?: React.ReactNode; skeleton?: string; children: React.ReactNode }) {
  const qs = Array.isArray(q) ? q : [q]
  const failed = qs.find((x) => x.isError)
  if (failed)
    return (
      <div role="alert" className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
        <AlertTriangle className="size-4 text-amber-600" aria-hidden />
        <span>Couldn’t load this tile. {errorMessage(failed.error)}</span>
        <Button variant="outline" size="sm" onClick={() => qs.forEach((x) => x.isError && x.refetch())}><RotateCw /> Retry</Button>
      </div>
    )
  if (qs.some((x) => x.isPending)) return <Skeleton className={cn("w-full", skeleton)} aria-busy="true" aria-label="Loading" />
  if (isEmpty) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
  return <>{children}</>
}
