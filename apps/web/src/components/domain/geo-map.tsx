"use client"

import { geoCentroid, geoNaturalEarth1, geoPath } from "d3-geo"
import type { Feature, Geometry } from "geojson"
import { useMemo, useState } from "react"
import { feature } from "topojson-client"
import type { GeometryCollection, Topology } from "topojson-specification"
import world from "world-atlas/countries-110m.json"
import { cn } from "@/lib/utils"

/** ISO 3166-1 alpha-2 → numeric (world-atlas ids), for every country the platform serves. */
export const ISO_NUMERIC: Record<string, string> = {
  BD: "050", IN: "356", PK: "586", NP: "524", LK: "144", AE: "784", SA: "682", QA: "634", KW: "414", OM: "512", BH: "048",
  GB: "826", IE: "372", DE: "276", FR: "250", IT: "380", ES: "724", NL: "528", SE: "752", TR: "792", US: "840", CA: "124", MX: "484",
  AU: "036", NZ: "554", MY: "458", SG: "702", ID: "360", PH: "608", TH: "764", VN: "704", JP: "392", KR: "410", BR: "076", AR: "032",
  ZA: "710", NG: "566", KE: "404", EG: "818",
}
/** Countries too small for the 110m map get a fixed centroid [lon, lat]. */
const MANUAL_CENTROID: Record<string, [number, number]> = { BH: [50.55, 26.07], SG: [103.82, 1.35], QA: [51.18, 25.35] }

const W = 960, H = 470

type Shape = { id: string; d: string; centroid: [number, number] }

function useWorld() {
  return useMemo(() => {
    const topo = world as unknown as Topology<{ countries: GeometryCollection }>
    const fc = feature(topo, topo.objects.countries)
    const features = (fc.features as Feature<Geometry, { name: string }>[]).filter((f) => f.id !== "010") // drop Antarctica
    const projection = geoNaturalEarth1().fitExtent([[4, 4], [W - 4, H - 4]], { type: "FeatureCollection", features })
    const path = geoPath(projection)
    const shapes: Shape[] = features.map((f) => ({ id: String(f.id), d: path(f) ?? "", centroid: (projection(geoCentroid(f)) ?? [0, 0]) as [number, number] }))
    const byId = new Map(shapes.map((s) => [s.id, s]))
    return { shapes, byId, projection }
  }, [])
}

export interface GeoDatum {
  code: string
  name: string
  value: number
  /** Extra lines for the tooltip, e.g. [["Clicks","12K"],["CTR","0.8%"]]. */
  detail?: [string, string][]
}

export function GeoMap({
  data, mode = "fill", valueLabel, format, selected, onSelect, className,
}: {
  data: GeoDatum[]
  mode?: "fill" | "bubbles"
  valueLabel: string
  format: (v: number) => string
  selected?: string[]
  onSelect?: (code: string) => void
  className?: string
}) {
  const { shapes, byId, projection } = useWorld()
  const [hover, setHover] = useState<{ d: GeoDatum; x: number; y: number } | null>(null)
  const byNum = useMemo(() => new Map(data.map((d) => [ISO_NUMERIC[d.code], d])), [data])
  const max = Math.max(...data.map((d) => d.value), 1)
  // 5-step sequential scale on the primary chart colour; sqrt keeps small markets visible.
  const level = (v: number) => (v <= 0 ? 0 : Math.min(5, Math.ceil(Math.sqrt(v / max) * 5)))
  const FILL = ["", "18%", "34%", "52%", "72%", "95%"]
  const fillFor = (v: number) => `color-mix(in oklab, var(--chart-1) ${FILL[level(v)]}, var(--muted))`
  const sel = new Set(selected ?? [])

  const bubbles = data
    .map((d) => {
      const s = byId.get(ISO_NUMERIC[d.code])
      const c = MANUAL_CENTROID[d.code] ? projection(MANUAL_CENTROID[d.code]) : s?.centroid
      return c ? { d, x: c[0], y: c[1], r: 3 + Math.sqrt(d.value / max) * 22 } : null
    })
    .filter(Boolean) as { d: GeoDatum; x: number; y: number; r: number }[]

  const show = (d: GeoDatum, e: React.MouseEvent) => {
    const box = (e.currentTarget.closest("svg") as SVGSVGElement).getBoundingClientRect()
    setHover({ d, x: ((e.clientX - box.left) / box.width) * 100, y: ((e.clientY - box.top) / box.height) * 100 })
  }

  return (
    <div className={cn("relative", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`World map of ${valueLabel.toLowerCase()} by country`} onMouseLeave={() => setHover(null)}>
        <g>
          {shapes.map((s, i) => {
            const d = byNum.get(s.id)
            const on = d && sel.has(d.code)
            return (
              <path
                key={`${s.id}-${i}`}
                d={s.d}
                fill={mode === "fill" && d ? fillFor(d.value) : "var(--muted)"}
                stroke={on ? "var(--foreground)" : "var(--background)"}
                strokeWidth={on ? 1.4 : 0.5}
                className={cn(d && onSelect && "cursor-pointer transition-opacity hover:opacity-80")}
                onMouseMove={d ? (e) => show(d, e) : undefined}
                onClick={d && onSelect ? () => onSelect(d.code) : undefined}
              />
            )
          })}
        </g>
        {/* Bubble mode draws every country; fill mode only marks countries too small to have a shape (e.g. Bahrain, Singapore). */}
        {(
          <g>
            {bubbles
              .filter((b) => mode === "bubbles" || !byId.has(ISO_NUMERIC[b.d.code]))
              .sort((a, b) => b.r - a.r)
              .map((b) => (
                <circle
                  key={b.d.code}
                  cx={b.x}
                  cy={b.y}
                  r={mode === "bubbles" ? b.r : 4}
                  fill="var(--chart-1)"
                  fillOpacity={mode === "bubbles" ? 0.45 : 0.9}
                  stroke={sel.has(b.d.code) ? "var(--foreground)" : "var(--chart-1)"}
                  strokeWidth={sel.has(b.d.code) ? 2 : 1}
                  className={cn(onSelect && "cursor-pointer")}
                  onMouseMove={(e) => show(b.d, e)}
                  onClick={onSelect ? () => onSelect(b.d.code) : undefined}
                />
              ))}
          </g>
        )}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 min-w-40 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
          style={{ left: `${hover.x}%`, top: `${hover.y}%` }}
        >
          <div className="mb-1 flex items-center justify-between gap-3 font-medium">
            <span>{hover.d.name}</span><span className="font-mono text-muted-foreground">{hover.d.code}</span>
          </div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">{valueLabel}</span><span className="font-mono font-medium tabular-nums">{format(hover.d.value)}</span></div>
          {hover.d.detail?.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4"><span className="text-muted-foreground">{k}</span><span className="font-mono tabular-nums">{v}</span></div>
          ))}
        </div>
      )}
      {mode === "fill" && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>Less</span>
          {FILL.slice(1).map((f) => <span key={f} className="h-2 w-6 rounded-sm" style={{ background: `color-mix(in oklab, var(--chart-1) ${f}, var(--muted))` }} />)}
          <span>More {valueLabel.toLowerCase()}</span>
          <span className="ml-auto hidden sm:inline">Grey = not served · click a country to filter</span>
        </div>
      )}
    </div>
  )
}
