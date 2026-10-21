"use client"

import { AD_FORMATS, DEVICE_LABEL, DEVICES, FORMAT_LABEL, FORMAT_META, PLATFORM_LABEL, PLATFORMS, type FilterKey, type Filters } from "@orbit/domain"
import { useId, useMemo } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useIndex } from "@/lib/hooks"
import { cn } from "@/lib/utils"

export interface FilterOption {
  value: string
  label: string
}

/** Labelled shadcn Select used in the Overview and Reports filter bars. */
export function FilterSelect({
  label, value, options, onChange, active, className,
}: {
  label: string
  value: string
  options: FilterOption[]
  onChange: (v: string) => void
  /** Highlights the trigger when the filter narrows the data. Defaults to value !== "all". */
  active?: boolean
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} size="sm" className={cn("w-full min-w-0 [&>span]:truncate", (active ?? value !== "all") && "border-primary/40 bg-primary/5")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-72">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export const RANGE_OPTIONS: FilterOption[] = [
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
]

/** Option lists for every single-select filter, from the reference lists. */
export function useFilterOptions() {
  const { properties, placements, creatives, countries, campById, propById } = useIndex()
  return useMemo(() => {
    const all = (label: string): FilterOption => ({ value: "all", label })
    const byName = <T extends { name: string }>(xs: T[]) => [...xs].sort((a, b) => a.name.localeCompare(b.name))
    return {
      range: RANGE_OPTIONS,
      platform: [all("All platforms"), ...PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))],
      property: [all("All apps & sites"), ...byName(properties).map((p) => ({ value: p.id, label: p.name }))],
      country: [all("All countries"), ...byName(countries).map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))],
      campaign: [all("All campaigns"), ...byName(Object.values(campById)).map((c) => ({ value: c.id, label: c.name }))],
      creative: [all("All creatives"), ...byName(creatives).map((c) => ({ value: c.id, label: c.name }))],
      placement: [all("All placements"), ...byName(placements).map((p) => ({ value: p.id, label: `${p.name} · ${propById[p.propertyId]?.name ?? "—"}` }))],
      format: [all("All formats"), ...AD_FORMATS.filter((f) => !FORMAT_META[f].future).map((f) => ({ value: f, label: FORMAT_LABEL[f] }))],
      device: [all("All devices"), ...DEVICES.map((d) => ({ value: d, label: DEVICE_LABEL[d] }))],
    }
  }, [properties, placements, creatives, countries, campById, propById])
}

/** Single-select filter values ("all" = no filter) → API filters. */
export function toFilters(f: Partial<Record<FilterKey, string>>): Filters {
  const out: Filters = {}
  for (const [k, v] of Object.entries(f) as [FilterKey, string | undefined][]) if (v && v !== "all") out[k] = [v]
  return out
}
