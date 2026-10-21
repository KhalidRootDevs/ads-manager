"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { fmt } from "@/lib/format"

const config = {
  // Lighter tint baked into the color (not bar opacity) so the legend swatch matches the bars.
  req: { label: "Ad requests", color: "color-mix(in oklab, var(--chart-2) 45%, transparent)" },
  imp: { label: "Impressions served", color: "var(--chart-1)" },
} satisfies ChartConfig

const TOP = 8

/**
 * Horizontal requests-vs-impressions bars for the top rows of a breakdown (same colors as the daily chart).
 * Without supply data (campaign, creative or format breakdowns) it shows impressions only.
 */
export function DimensionChart({ rows }: { rows: { key: string; label: string; req: number | null; imp: number }[] }) {
  const supply = rows.every((r) => r.req != null)
  const data = [...rows].sort((a, b) => (supply ? (b.req ?? 0) - (a.req ?? 0) : b.imp - a.imp)).slice(0, TOP).map((r) => ({ name: r.label, ...(supply ? { req: r.req } : {}), imp: r.imp }))
  const short = (s: string) => (s.length > 19 ? s.slice(0, 18) + "…" : s)
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-xs text-muted-foreground">
        {supply
          ? <>Top {Math.min(TOP, rows.length)} of {rows.length} by ad requests · upper bar is ad requests, lower bar is impressions served</>
          : <>Top {Math.min(TOP, rows.length)} of {rows.length} by impressions served · ad requests aren’t recorded per campaign, creative or format</>}
      </figcaption>
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height: data.length * (supply ? 44 : 30) + 56 }}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12, top: 0 }} barGap={2} barCategoryGap={8}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" tickLine={false} axisLine={false} tickCount={4} minTickGap={16} tickFormatter={(v: number) => fmt.compact(v)} />
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={132} tickFormatter={short} tick={{ fontSize: 12 }} />
          <ChartTooltip
            cursor={{ fillOpacity: 0.4 }}
            content={
              <ChartTooltipContent
                formatter={(v, n) => (
                  <div className="flex w-full justify-between gap-4">
                    <span className="text-muted-foreground">{config[n as "req" | "imp"]?.label}</span>
                    <span className="font-mono font-medium tabular-nums">{Number(v).toLocaleString()}</span>
                  </div>
                )}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} verticalAlign="top" itemSorter={null} />
          {supply && <Bar isAnimationActive={false} dataKey="req" fill="var(--color-req)" radius={[0, 4, 4, 0]} />}
          <Bar isAnimationActive={false} dataKey="imp" fill="var(--color-imp)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ChartContainer>
    </figure>
  )
}
