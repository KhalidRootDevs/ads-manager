"use client"

import { AlertTriangle, Plus, Search, X } from "lucide-react"
import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { availSet, finalCountries, ruleSummary, type CountryMode, type CountryRule, type Property } from "@orbit/domain"
import { useIndex } from "@/lib/hooks"
import { REGIONS } from "@/lib/regions"
import { cn } from "@/lib/utils"

/**
 * Edits one country rule (All available / Include only / Exclude) with region quick-add,
 * chips, a searchable checklist and conflict warnings against the property's defaults.
 * Pass `property` to check against its availability; omit it to edit a property's own defaults.
 */
export function CountryRuleEditor({
  mode, countries, onChange, property, labels,
}: {
  mode: CountryMode
  countries: string[]
  onChange: (next: { mode: CountryMode; countries: string[] }) => void
  property?: Pick<Property, "name" | "countryRule">
  labels?: Partial<Record<CountryMode, string>>
}) {
  const { countries: all, ctryByCode } = useIndex()
  const [q, setQ] = useState("")
  const av = useMemo(() => (property ? availSet(property.countryRule, all) : new Set(all.filter((c) => c.enabled).map((c) => c.code))), [property, all])
  const conflicts = mode === "include" && property ? countries.filter((c) => !av.has(c)) : []
  const list = all.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.code.toLowerCase().includes(q.toLowerCase()))
  const toggle = (code: string) => onChange({ mode, countries: countries.includes(code) ? countries.filter((x) => x !== code) : [...countries, code] })
  const L = { all: "All available countries", include: "Include only", exclude: "Exclude", ...labels }

  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup type="single" variant="outline" aria-label="Country rule" value={mode} onValueChange={(v) => v && onChange({ mode: v as CountryMode, countries })} className="w-full flex-wrap sm:w-fit">
        <ToggleGroupItem value="all" className="min-w-0 flex-1 px-3 sm:flex-none"><span className="sm:hidden">All</span><span className="hidden sm:inline">{L.all}</span></ToggleGroupItem>
        <ToggleGroupItem value="include" className="min-w-0 flex-1 px-3 sm:flex-none"><span className="sm:hidden">Include</span><span className="hidden sm:inline">{L.include}</span></ToggleGroupItem>
        <ToggleGroupItem value="exclude" className="min-w-0 flex-1 px-3 sm:flex-none"><span className="sm:hidden">Exclude</span><span className="hidden sm:inline">{L.exclude}</span></ToggleGroupItem>
      </ToggleGroup>
      <p className="text-sm text-muted-foreground">
        {mode === "all"
          ? property ? `Serves in every country ${property.name} allows by default (${av.size} countries).` : `Accepts ads from all ${av.size} enabled countries.`
          : mode === "include" ? "Serves only in the countries you add below." : "Serves everywhere allowed, except the countries below."}
      </p>
      {mode !== "all" && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">Quick add</span>
            {REGIONS.map((r) => (
              <Button key={r.label} type="button" variant="outline" size="xs" className="border-dashed" onClick={() => onChange({ mode, countries: [...new Set([...countries, ...r.codes.filter((c) => ctryByCode[c]?.enabled)])] })}>
                <Plus /> {r.label}
              </Button>
            ))}
          </div>
          <div className="flex min-h-8 flex-wrap items-center gap-1.5">
            {countries.length === 0 && <span className="text-sm text-muted-foreground">{mode === "include" ? "No countries yet. Add a region or tick countries below." : "No exclusions yet, so this behaves like all available countries."}</span>}
            {countries.map((c) => (
              <Badge key={c} variant="secondary" className={cn("gap-1 pr-0.5 font-normal", mode === "exclude" && "bg-red-500/10 text-red-700 dark:text-red-400", conflicts.includes(c) && "bg-amber-500/15 text-amber-800 dark:text-amber-300")}>
                <span className="font-mono text-[11px]">{c}</span> {ctryByCode[c]?.name}
                <button type="button" onClick={() => toggle(c)} className="rounded-sm p-0.5 hover:bg-foreground/10" aria-label={`Remove ${ctryByCode[c]?.name ?? c}`}><X className="size-3" /></button>
              </Badge>
            ))}
            {countries.length > 0 && <Button type="button" variant="link" size="xs" onClick={() => onChange({ mode, countries: [] })}>Clear all</Button>}
          </div>
          <div className="rounded-lg border">
            <div className="relative border-b">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search countries" aria-label="Search countries" className="h-9 rounded-none border-0 pl-8 shadow-none focus-visible:ring-0" />
            </div>
            <ScrollArea className="h-56">
              <div className="divide-y">
                {list.map((c) => {
                  const on = countries.includes(c.code)
                  const note = !c.enabled ? "Disabled platform-wide" : property && !av.has(c.code) ? "Not in property defaults" : ""
                  return (
                    <label key={c.code} className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50", !c.enabled && "cursor-not-allowed opacity-60")}>
                      <Checkbox checked={on} disabled={!c.enabled && !on} onCheckedChange={() => toggle(c.code)} />
                      <span className="w-7 font-mono text-xs text-muted-foreground">{c.code}</span>
                      <span className="flex-1 truncate">{c.name} <span className="text-muted-foreground">· {c.region}</span></span>
                      {note && <span className="text-xs text-amber-700 dark:text-amber-400">{note}</span>}
                    </label>
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        </>
      )}
      {conflicts.length > 0 && property && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{conflicts.map((c) => ctryByCode[c]?.name ?? c).join(", ")} {conflicts.length === 1 ? "isn’t" : "aren’t"} in {property.name}’s country defaults, so {conflicts.length === 1 ? "it" : "they"} won’t serve. Remove {conflicts.length === 1 ? "it" : "them"} or update the property defaults.</span>
        </div>
      )}
    </div>
  )
}

/**
 * Properties × countries matrix: ● serves, ✕ excluded, ! conflict, – not targeted.
 * Computed client-side with the same domain rules as the API, so it also works for unsaved wizard drafts.
 * `topCountries` (e.g. from analytics) adds useful columns beyond the countries named in the rules.
 */
export function TargetingMatrix({ targets, topCountries = [] }: { targets: { propertyId: string; countryRule: CountryRule }[]; topCountries?: string[] }) {
  const { propById, ctryByCode, countries } = useIndex()
  const rows = targets
    .map((t) => ({ t: t.countryRule, p: propById[t.propertyId] }))
    .filter((r) => r.p)
    .map((r) => ({ ...r, fin: new Set(finalCountries(r.t, r.p.countryRule, countries)), av: availSet(r.p.countryRule, countries) }))
  let cols: string[] = []
  rows.forEach((r) => r.t.countries.forEach((c) => { if (!cols.includes(c)) cols.push(c) }))
  ;[...topCountries, ...(rows.length ? ["BD", "IN", "PK", "AE", "GB", "US"] : [])].forEach((c) => { if (!cols.includes(c) && ctryByCode[c]) cols.push(c) })
  cols = cols.slice(0, 16)
  if (!rows.length) return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Select properties to see the targeting matrix.</div>

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">Property</th>
              {cols.map((c) => (
                <th key={c} className="px-1 py-2 text-center font-mono font-medium">
                  <Tooltip><TooltipTrigger asChild><abbr tabIndex={0} title={ctryByCode[c]?.name} className="cursor-default no-underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring">{c}</abbr></TooltipTrigger><TooltipContent>{ctryByCode[c]?.name}</TooltipContent></Tooltip>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ t, p, fin, av }) => (
              <tr key={p.id} className="border-t">
                <td className="sticky left-0 z-10 max-w-56 bg-card px-3 py-2">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{ruleSummary(t)}</div>
                </td>
                {cols.map((c) => {
                  const ex = t.countries.includes(c)
                  const name = ctryByCode[c]?.name ?? c
                  let cell = { sym: "–", cls: "text-muted-foreground/60", title: `${name}: not targeted` }
                  if (t.mode === "include" && ex && !av.has(c)) cell = { sym: "!", cls: "bg-amber-500/15 font-bold text-amber-700 dark:text-amber-400", title: `${name}: included but not available on ${p.name}` }
                  else if (fin.has(c)) cell = { sym: "●", cls: "text-emerald-600 dark:text-emerald-400", title: `${name}: serves` }
                  else if (t.mode === "exclude" && ex) cell = { sym: "✕", cls: "font-bold text-red-600 dark:text-red-400", title: `${name}: excluded` }
                  return <td key={c} className={cn("w-10 px-1 py-2 text-center", cell.cls)} title={cell.title}>{cell.sym}</td>
                })}
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fin.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span><b className="text-emerald-600 dark:text-emerald-400">●</b> Serves</span>
        <span><b className="text-red-600 dark:text-red-400">✕</b> Excluded</span>
        <span><b className="text-amber-600">!</b> Conflict with property defaults</span>
        <span>– Not targeted</span>
        <span>Total = countries this property will serve</span>
      </div>
    </div>
  )
}
