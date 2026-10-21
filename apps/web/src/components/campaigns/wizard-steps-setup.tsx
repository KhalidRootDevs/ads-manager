"use client"

import {
  AD_FORMATS, FORMAT_LABEL, OBJECTIVE_LABEL, PLATFORMS, PLATFORM_LABEL, PRIORITIES, PRIORITY_LABEL, SDK_STATE_LABEL, sizeLabel, todayKey,
  type CreativeStatus, type Priority,
} from "@orbit/domain"
import { AlertTriangle, Plus, Search } from "lucide-react"
import { useState } from "react"
import { OBJECTIVES, plural, TIMEZONES } from "@/components/campaigns/campaign-utils"
import { DEFAULT_T, fieldError, type StepProps, type WizardForm } from "@/components/campaigns/wizard-state"
import { CreativeThumb } from "@/components/domain/ad-preview"
import { PlatformBadge, StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmt } from "@/lib/format"
import { useIndex } from "@/lib/hooks"
import { cn } from "@/lib/utils"

export function StepSection({ title, description, action, children, invalid }: { title: string; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; invalid?: boolean }) {
  return (
    <Card className={cn("min-w-0", invalid && "ring-destructive/50")}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  )
}

/** Inline list of the current step's errors, shown after a failed Continue. */
export function StepErrors({ errors, showErr, step }: Pick<StepProps, "errors" | "showErr"> & { step: number }) {
  const list = errors[step]
  if (!showErr || !list?.length) return null
  return (
    <div role="alert" tabIndex={-1} data-step-errors className="flex items-start gap-2 rounded-lg border outline-none border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <ul className="flex flex-col gap-0.5">{list.map((x, i) => <li key={i}>{x.message}</li>)}</ul>
    </div>
  )
}

// ---------- 1. Basics ----------
export function StepBasics(p: StepProps) {
  const { form, update } = p
  const nameErr = fieldError(p, "name"), startErr = fieldError(p, "start"), endErr = fieldError(p, "end")
  const today = todayKey(form.tz)
  const tzs = TIMEZONES.some((t) => t.value === form.tz) ? TIMEZONES : [...TIMEZONES, { value: form.tz, label: form.tz }]
  return (
    <div className="flex flex-col gap-4">
      <StepErrors {...p} step={1} />
      <StepSection title="Basics" description="Name the campaign, pick what it should achieve and when it runs.">
        <FieldGroup>
          <Field data-invalid={!!nameErr}>
            <FieldLabel htmlFor="cw-name">Campaign name</FieldLabel>
            <Input id="cw-name" value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. World Cup Final Week Banner" aria-invalid={!!nameErr} maxLength={120} />
            {nameErr ? <FieldError>{nameErr}</FieldError> : <FieldDescription>Must be unique. Shown in reports and activity.</FieldDescription>}
          </Field>

          <Field>
            <FieldLabel id="cw-objective-label">Objective</FieldLabel>
            <div role="radiogroup" aria-labelledby="cw-objective-label" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {OBJECTIVES.map((o) => {
                const on = form.objective === o.value
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => update({ objective: o.value })}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      on ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-2 text-sm font-medium">
                      {OBJECTIVE_LABEL[o.value]}
                      <span className={cn("grid size-4 place-items-center rounded-full border", on && "border-primary")} aria-hidden>
                        {on && <span className="size-2 rounded-full bg-primary" />}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">{o.desc}</span>
                  </button>
                )
              })}
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!startErr}>
              <FieldLabel htmlFor="cw-start">Start date</FieldLabel>
              <Input id="cw-start" type="date" value={form.start} onChange={(e) => update({ start: e.target.value })} aria-invalid={!!startErr} />
              {startErr ? <FieldError>{startErr}</FieldError> : <FieldDescription>{form.start > today ? "Future start: publishing schedules the campaign." : "Starts serving as soon as it’s published."}</FieldDescription>}
            </Field>
            <Field data-invalid={!!endErr}>
              <FieldLabel htmlFor="cw-end">End date</FieldLabel>
              <Input id="cw-end" type="date" value={form.end} min={form.start || undefined} onChange={(e) => update({ end: e.target.value })} aria-invalid={!!endErr} />
              {endErr ? <FieldError>{endErr}</FieldError> : <FieldDescription>{form.start && form.end && form.end >= form.start ? fmt.range(form.start, form.end) : "Must be on or after the start date."}</FieldDescription>}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="cw-tz">Timezone</FieldLabel>
              <Select value={form.tz} onValueChange={(v) => update({ tz: v })}>
                <SelectTrigger id="cw-tz" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{tzs.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <FieldDescription>Start, end, day and hour rules use this timezone.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel id="cw-priority-label">Priority</FieldLabel>
              <ToggleGroup type="single" variant="outline" value={String(form.priority)} onValueChange={(v) => v && update({ priority: Number(v) as Priority })} aria-labelledby="cw-priority-label" className="w-full sm:w-fit">
                {PRIORITIES.map((x) => <ToggleGroupItem key={x} value={String(x)} className="flex-1 px-4 sm:flex-none">{PRIORITY_LABEL[x]}</ToggleGroupItem>)}
              </ToggleGroup>
              <FieldDescription>Higher priority wins when campaigns compete for the same placement.</FieldDescription>
            </Field>
          </div>
        </FieldGroup>
      </StepSection>
    </div>
  )
}

// ---------- 2. Creatives ----------
const WARN_TEXT: Partial<Record<CreativeStatus, string>> = {
  rejected: "Rejected — fix it before publishing",
  in_review: "In review — can’t serve until approved",
  draft: "Draft — submit it for review before publishing",
  archived: "Archived — restore it or pick another",
}

export function StepCreatives(p: StepProps & { usage: Record<string, number> }) {
  const { form, update, usage } = p
  const { creatives } = useIndex()
  const [q, setQ] = useState("")
  const [format, setFormat] = useState("all")
  const pool = creatives.filter((c) => c.status !== "archived" || form.creativeIds.includes(c.id))
  const formats = AD_FORMATS.filter((f) => pool.some((c) => c.format === f))
  const ql = q.toLowerCase()
  const list = pool.filter((c) => (format === "all" || c.format === format) && (!ql || c.name.toLowerCase().includes(ql) || c.copy.headline.toLowerCase().includes(ql)))
  const toggle = (id: string) => update((f) => ({ creativeIds: f.creativeIds.includes(id) ? f.creativeIds.filter((x) => x !== id) : [...f.creativeIds, id] }))

  return (
    <div className="flex flex-col gap-4">
      <StepErrors {...p} step={2} />
      <StepSection
        title="Creatives"
        description="Pick one or more reusable creatives from the library. The same creative can run in many campaigns."
        invalid={p.showErr && !!p.errors[2]}
        action={p.onNewCreative && <Button variant="outline" size="sm" onClick={p.onNewCreative}><Plus /> New creative</Button>}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search creatives" aria-label="Search creatives" className="pl-8" />
            </div>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger className="w-full sm:w-48" aria-label="Filter by format"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All formats</SelectItem>
                {formats.map((f) => <SelectItem key={f} value={f}>{FORMAT_LABEL[f]}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground sm:ml-auto">{form.creativeIds.length} selected</span>
          </div>
          {list.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {pool.length ? "No creatives match. Clear the search or create a new creative." : "The creative library is empty. Create a creative to continue."}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((c) => {
                const on = form.creativeIds.includes(c.id)
                const warn = c.status !== "ready" ? WARN_TEXT[c.status] : undefined
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                      on ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/40",
                    )}
                  >
                    <Checkbox checked={on} onCheckedChange={() => toggle(c.id)} aria-label={`Select ${c.name}`} className="mt-0.5" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <CreativeThumb c={c} className="h-20" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{c.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{FORMAT_LABEL[c.format]}{c.size ? ` · ${sizeLabel(c.size)}` : ""} · used in {plural(usage[c.id] ?? 0, "campaign")}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={c.status} />
                        {warn && <span className="text-xs text-amber-700 dark:text-amber-400">{warn}</span>}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      </StepSection>
    </div>
  )
}

// ---------- 3. Properties ----------
export function setProps(update: StepProps["update"], ids: string[], add: boolean) {
  update((f: WizardForm) => {
    let propIds = [...f.propIds]
    const targets = { ...f.targets }
    ids.forEach((id) => {
      if (add && !propIds.includes(id)) {
        propIds.push(id)
        if (!targets[id]) targets[id] = { ...DEFAULT_T }
      }
      if (!add) propIds = propIds.filter((x) => x !== id)
    })
    return { propIds, targets }
  })
}

const SDK_DOT: Record<string, string> = { healthy: "bg-emerald-500", degraded: "bg-amber-500", heartbeat_missing: "bg-red-500", not_integrated: "bg-zinc-400" }

export function StepProperties(p: StepProps) {
  const { form, update } = p
  const { properties } = useIndex()
  const [q, setQ] = useState("")
  const [type, setType] = useState("all")
  const [tag, setTag] = useState<string | null>(null)
  const allTags = [...new Set(properties.flatMap((x) => x.tags))].sort()
  const ql = q.toLowerCase()
  const list = properties.filter((x) => (type === "all" || x.platform === type) && (!tag || x.tags.includes(tag)) && (!ql || x.name.toLowerCase().includes(ql) || x.identifier.toLowerCase().includes(ql)))
  const teams = [...new Set(list.map((x) => x.team))].sort()

  return (
    <div className="flex flex-col gap-4">
      <StepErrors {...p} step={3} />
      <StepSection title="Apps & websites" description="Choose where this campaign runs. You’ll set countries and placements for each one separately next." invalid={p.showErr && !!p.errors[3]}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, bundle ID or domain" aria-label="Search properties" className="pl-8" />
            </div>
            <ToggleGroup type="single" variant="outline" value={type} onValueChange={(v) => v && setType(v)} aria-label="Filter by platform" className="w-full sm:w-fit">
              <ToggleGroupItem value="all" className="flex-1 px-3 sm:flex-none">All</ToggleGroupItem>
              {PLATFORMS.map((v) => <ToggleGroupItem key={v} value={v} className="flex-1 px-3 sm:flex-none">{PLATFORM_LABEL[v]}</ToggleGroupItem>)}
            </ToggleGroup>
            <div className="flex items-center gap-2 text-sm text-muted-foreground sm:ml-auto">
              <span>{form.propIds.length} selected</span>
              {form.propIds.length > 0 && <Button variant="link" size="sm" className="px-0" onClick={() => update({ propIds: [] })}>Clear</Button>}
            </div>
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
              <span className="mr-1 text-xs text-muted-foreground">Tags</span>
              {allTags.map((t) => (
                <Button key={t} type="button" size="xs" variant={tag === t ? "default" : "outline"} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>{t}</Button>
              ))}
              {tag && (
                <Button type="button" size="xs" variant="link" onClick={() => setProps(update, list.map((x) => x.id), true)}>
                  Select all tagged “{tag}”
                </Button>
              )}
            </div>
          )}

          {teams.length === 0 && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No apps or websites match.</div>}
          {teams.map((team) => {
            const items = list.filter((x) => x.team === team)
            const allOn = items.every((x) => form.propIds.includes(x.id))
            return (
              <div key={team} className="overflow-hidden rounded-lg border">
                <div className="flex items-center justify-between gap-2 bg-muted/50 px-3 py-2">
                  <div className="text-sm font-medium">{team} <span className="font-normal text-muted-foreground">· {plural(items.length, "property", "properties")}</span></div>
                  <Button variant="ghost" size="sm" onClick={() => setProps(update, items.map((x) => x.id), !allOn)}>{allOn ? "Deselect all" : "Select all"}</Button>
                </div>
                <div className="divide-y">
                  {items.map((x) => {
                    const on = form.propIds.includes(x.id)
                    return (
                      <label key={x.id} className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors", on ? "bg-primary/5" : "hover:bg-muted/40")}>
                        <Checkbox checked={on} onCheckedChange={(v) => setProps(update, [x.id], !!v)} aria-label={`Select ${x.name}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium">{x.name}</span>
                            <PlatformBadge type={x.platform} />
                            {x.status !== "active" && <StatusBadge status={x.status} dot={false} />}
                          </div>
                          <div className="truncate font-mono text-xs text-muted-foreground">{x.identifier}{x.tags.length ? <span className="font-sans"> · {x.tags.join(", ")}</span> : null}</div>
                        </div>
                        <StatusBadge status={x.sdk.state} className="hidden sm:inline-flex" />
                        <span className={cn("size-2 shrink-0 rounded-full sm:hidden", SDK_DOT[x.sdk.state])} role="img" title={`SDK: ${SDK_STATE_LABEL[x.sdk.state]}`} aria-label={`SDK: ${SDK_STATE_LABEL[x.sdk.state]}`} />
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </StepSection>
    </div>
  )
}

