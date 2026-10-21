"use client"

import { Check, PlusCircle, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { AD_FORMATS, CAMPAIGN_STATUS_LABEL, DEVICE_LABEL, DEVICES, FORMAT_LABEL, FORMAT_META, PLATFORM_LABEL, PLATFORMS, type FilterKey } from "@orbit/domain"
import { cn } from "@/lib/utils"
import { RANGES, type AnalyticsState } from "./use-analytics"

type Opt = { value: string; label: string; hint?: string }

function MultiSelect({ title, options, value, onChange }: { title: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  const sel = new Set(value)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("border-dashed", sel.size && "border-solid")}>
          <PlusCircle /> {title}
          {sel.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <Badge variant="secondary" className="rounded-sm px-1 font-normal">{sel.size === 1 ? options.find((o) => sel.has(o.value))?.label : `${sel.size} selected`}</Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = sel.has(o.value)
                return (
                  <CommandItem key={o.value} value={o.label + " " + o.value} onSelect={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}>
                    <span className={cn("flex size-4 items-center justify-center rounded-[4px] border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>{on && <Check className="size-3" />}</span>
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="ml-auto text-xs text-muted-foreground">{o.hint}</span>}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {sel.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup><CommandItem onSelect={() => onChange([])} className="justify-center">Clear</CommandItem></CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function FilterBar({ a }: { a: AnalyticsState }) {
  const { campById, countries, properties } = a.idx
  const opts: Record<FilterKey, Opt[]> = {
    campaign: Object.values(campById).filter((c) => c.status !== "draft" && c.status !== "scheduled").map((c) => ({ value: c.id, label: c.name, hint: CAMPAIGN_STATUS_LABEL[c.status] })),
    country: countries.map((c) => ({ value: c.code, label: c.name, hint: c.code })),
    platform: PLATFORMS.map((v) => ({ value: v, label: PLATFORM_LABEL[v] })),
    device: DEVICES.map((v) => ({ value: v, label: DEVICE_LABEL[v] })),
    format: AD_FORMATS.filter((f) => !FORMAT_META[f].future).map((v) => ({ value: v, label: FORMAT_LABEL[v] })),
    property: properties.map((p) => ({ value: p.id, label: p.name, hint: PLATFORM_LABEL[p.platform] })),
    placement: [], creative: [], region: [],
  }
  const TITLES: [FilterKey, string][] = [["campaign", "Campaign"], ["country", "Country"], ["platform", "Platform"], ["device", "Device"], ["format", "Format"], ["property", "App / site"]]
  // Filters that only arrive by link (e.g. from a placement or creative page) still show as removable chips.
  const EXTRA: [FilterKey, string][] = [["placement", "Placement"], ["creative", "Creative"], ["region", "Region"]]
  const extraLabel = (k: FilterKey, v: string) => (k === "placement" ? a.idx.plcById[v]?.name : k === "creative" ? a.idx.crById[v]?.name : v)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={String(a.days)} onValueChange={(v) => v && a.setDays(Number(v))} aria-label="Date range">
          {RANGES.map((d) => <ToggleGroupItem key={d} value={String(d)} className="px-3">{d}d</ToggleGroupItem>)}
        </ToggleGroup>
        <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />
        {TITLES.map(([k, t]) => <MultiSelect key={k} title={t} options={opts[k]} value={a.filters[k] ?? []} onChange={(v) => a.setFilter(k, v)} />)}
        {a.activeCount > 0 && <Button variant="ghost" size="sm" onClick={a.reset}>Reset <X /></Button>}
        {a.updating && <span className="text-xs text-muted-foreground" role="status">Updating…</span>}
      </div>
      {a.activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Showing</span>
          {[...TITLES, ...EXTRA].flatMap(([k, t]) =>
            (a.filters[k] ?? []).map((v) => (
              <Badge key={k + v} variant="secondary" className="gap-1 pr-0.5 font-normal">
                <span className="text-muted-foreground">{t}:</span> {opts[k].find((o) => o.value === v)?.label ?? extraLabel(k, v) ?? v}
                <button type="button" onClick={() => a.toggle(k, v)} className="rounded-sm p-0.5 hover:bg-foreground/10" aria-label={`Remove ${t} filter`}><X className="size-3" /></button>
              </Badge>
            )),
          )}
        </div>
      )}
    </div>
  )
}
