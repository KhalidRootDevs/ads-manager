"use client"

import { useApiQuery } from "@orbit/api-client/react"
import { DEVICE_LABEL, DEVICES, fromMicros, GOAL_TYPE_LABEL, GOAL_TYPES, WEEKDAY_LABEL, WEEKDAYS, type FreqPeriod, type GoalType, type PacingMode } from "@orbit/domain"
import { Divide } from "lucide-react"
import { useState } from "react"
import { HOUR_PRESETS } from "@/components/campaigns/campaign-utils"
import { Notice } from "@/components/campaigns/notice"
import { allocSum, fieldError, type StepProps } from "@/components/campaigns/wizard-state"
import { StepErrors, StepSection } from "@/components/campaigns/wizard-steps-setup"
import { PlatformBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmt } from "@/lib/format"
import { useIndex } from "@/lib/hooks"
import { cn } from "@/lib/utils"

const HOURS = Array.from({ length: 25 }, (_, i) => i)
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`

// ---------- 6. Constraints ----------
export function StepConstraints(p: StepProps) {
  const { form, update } = p
  const audiences = useApiQuery("listAudiences", {}, { select: (r) => r.items })
  const { propById } = useIndex()
  const freqErr = fieldError(p, "freq"), daysErr = fieldError(p, "days"), devErr = fieldError(p, "devices"), hoursErr = fieldError(p, "hours"), osErr = fieldError(p, "minos")
  const toggleAudience = (id: string) => update((f) => ({ audiences: f.audiences.includes(id) ? f.audiences.filter((x) => x !== id) : [...f.audiences, id] }))
  const matched = HOUR_PRESETS.find((h) => h.from === form.hours.from && h.to === form.hours.to)?.value
  const [customOpen, setCustomOpen] = useState(!matched)
  const preset = customOpen || !matched ? "custom" : matched

  return (
    <div className="flex flex-col gap-4">
      <StepErrors {...p} step={6} />
      <StepSection title="Schedule & devices" description="Optional. Narrow when and on which devices the campaign serves.">
        <FieldGroup>
          <Field data-invalid={!!daysErr}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel id="cw-days-label">Days of week</FieldLabel>
              <div className="flex gap-1">
                <Button variant="link" size="xs" onClick={() => update({ days: [...WEEKDAYS] })}>Every day</Button>
                <Button variant="link" size="xs" onClick={() => update({ days: WEEKDAYS.slice(0, 5) })}>Weekdays</Button>
                <Button variant="link" size="xs" onClick={() => update({ days: WEEKDAYS.slice(5) })}>Weekends</Button>
              </div>
            </div>
            <ToggleGroup type="multiple" variant="outline" spacing={1} value={form.days} onValueChange={(v) => update({ days: WEEKDAYS.filter((d) => v.includes(d)) })} aria-labelledby="cw-days-label" className="flex-wrap justify-start">
              {WEEKDAYS.map((d) => <ToggleGroupItem key={d} value={d} className="min-w-12 px-3">{WEEKDAY_LABEL[d]}</ToggleGroupItem>)}
            </ToggleGroup>
            {daysErr && <FieldError>{daysErr}</FieldError>}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!hoursErr}>
              <FieldLabel htmlFor="cw-hours">Hours</FieldLabel>
              <Select
                value={preset}
                onValueChange={(v) => {
                  const h = HOUR_PRESETS.find((x) => x.value === v)
                  setCustomOpen(!h)
                  if (h) update({ hours: { from: h.from, to: h.to } })
                }}
              >
                <SelectTrigger id="cw-hours" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOUR_PRESETS.map((h) => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
                  <SelectItem value="custom">Custom hours</SelectItem>
                </SelectContent>
              </Select>
              {preset === "custom" && (
                <div className="flex items-center gap-2">
                  <Select value={String(form.hours.from)} onValueChange={(v) => update((f) => ({ hours: { ...f.hours, from: Number(v) } }))}>
                    <SelectTrigger className="flex-1" aria-label="From hour" aria-invalid={!!hoursErr}><SelectValue /></SelectTrigger>
                    <SelectContent>{HOURS.slice(0, 24).map((h) => <SelectItem key={h} value={String(h)}>{hh(h)}</SelectItem>)}</SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground">to</span>
                  <Select value={String(form.hours.to)} onValueChange={(v) => update((f) => ({ hours: { ...f.hours, to: Number(v) } }))}>
                    <SelectTrigger className="flex-1" aria-label="To hour" aria-invalid={!!hoursErr}><SelectValue /></SelectTrigger>
                    <SelectContent>{HOURS.slice(1).map((h) => <SelectItem key={h} value={String(h)}>{h === 24 ? "24:00 (midnight)" : hh(h)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              {hoursErr ? <FieldError>{hoursErr}</FieldError> : <FieldDescription>In the campaign timezone ({form.tz}).</FieldDescription>}
            </Field>
            <Field data-invalid={!!osErr}>
              <FieldLabel htmlFor="cw-minos">Min app version</FieldLabel>
              <Input id="cw-minos" value={form.minOs} onChange={(e) => update({ minOs: e.target.value })} placeholder="Any version" className="font-mono" aria-invalid={!!osErr} />
              {osErr ? <FieldError>{osErr}</FieldError> : <FieldDescription>Apps only. Older SDK builds won’t receive this campaign.</FieldDescription>}
            </Field>
          </div>
          <Field data-invalid={!!devErr}>
            <FieldLabel id="cw-devices-label">Devices</FieldLabel>
            <ToggleGroup type="multiple" variant="outline" spacing={1} value={form.devices} onValueChange={(v) => update({ devices: DEVICES.filter((d) => v.includes(d)) })} aria-labelledby="cw-devices-label" className="flex-wrap justify-start">
              {DEVICES.map((d) => <ToggleGroupItem key={d} value={d} className="px-4">{DEVICE_LABEL[d]}</ToggleGroupItem>)}
            </ToggleGroup>
            {devErr && <FieldError>{devErr}</FieldError>}
          </Field>
          <Field data-invalid={!!freqErr}>
            <FieldLabel htmlFor="cw-freq">Frequency cap</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Input id="cw-freq" type="number" inputMode="numeric" min={1} max={1000} value={form.freq} onChange={(e) => update({ freq: e.target.value })} placeholder="No cap" className="w-28" aria-invalid={!!freqErr} />
              <span className="text-sm text-muted-foreground">impressions per user per</span>
              <Select value={form.freqPer} onValueChange={(v) => update({ freqPer: v as FreqPeriod })}>
                <SelectTrigger className="w-28" aria-label="Frequency cap period"><SelectValue /></SelectTrigger>
                <SelectContent>{(["hour", "day", "week"] as const).map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {freqErr ? <FieldError>{freqErr}</FieldError> : <FieldDescription>Leave empty for no campaign-level cap. Placement caps still apply.</FieldDescription>}
          </Field>
        </FieldGroup>
      </StepSection>

      <StepSection
        title="Audience segments"
        description="Saved with the campaign but not enforced until the event pipeline ships."
        action={<Badge variant="secondary">Future-ready</Badge>}
      >
        {audiences.isPending ? (
          <div className="grid gap-2 sm:grid-cols-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        ) : audiences.isError ? (
          <p className="text-sm text-muted-foreground">Couldn’t load audience segments. <Button variant="link" size="sm" className="h-auto px-0" onClick={() => void audiences.refetch()}>Retry</Button></p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {audiences.data.map((a) => {
              const on = form.audiences.includes(a.id)
              return (
                <label key={a.id} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors", on ? "border-primary bg-primary/5" : "hover:bg-muted/40")}>
                  <Checkbox checked={on} onCheckedChange={() => toggleAudience(a.id)} aria-label={`Use audience ${a.name}`} className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{a.rule.event}</span> within {a.rule.withinDays} days{a.estimate ? ` · ~${fmt.compact(a.estimate.size)} users` : ""}
                    </div>
                  </div>
                </label>
              )
            })}
            {audiences.data.length === 0 && <p className="text-sm text-muted-foreground">No audience segments defined yet.</p>}
          </div>
        )}
      </StepSection>

      <StepSection
        title="Destination overrides"
        description="Optional. Send taps from a specific property to a different deep link or URL than the creative’s own."
        action={<Switch checked={form.destOn} onCheckedChange={(v) => update({ destOn: v })} aria-label="Use destination overrides" />}
      >
        {form.destOn ? (
          form.propIds.length ? (
            <FieldGroup>
              {form.propIds.map((pid) => {
                const prop = propById[pid]
                if (!prop) return null
                const err = fieldError(p, `dest-${pid}`)
                const ph = prop.platform === "web" ? `https://${prop.identifier}/…` : `${prop.identifier.split(".")[1] ?? "app"}://…`
                return (
                  <Field key={pid} data-invalid={!!err}>
                    <FieldLabel htmlFor={`dest-${pid}`} className="flex items-center gap-2">{prop.name} <PlatformBadge type={prop.platform} /></FieldLabel>
                    <Input id={`dest-${pid}`} value={form.dest[pid] ?? ""} onChange={(e) => { const v = e.target.value; update((f) => ({ dest: { ...f.dest, [pid]: v } })) }} placeholder={ph} className="font-mono" aria-invalid={!!err} maxLength={500} />
                    {err && <FieldError>{err}</FieldError>}
                  </Field>
                )
              })}
              <FieldDescription>Leave a field empty to keep the creative’s destination on that property.</FieldDescription>
            </FieldGroup>
          ) : (
            <p className="text-sm text-muted-foreground">Select properties first to add overrides.</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">Off — every property uses the creative’s own deep link or URL.</p>
        )}
      </StepSection>
    </div>
  )
}

export interface TeamInfo {
  quarter: string
  /** null when the team has no budget for the quarter. */
  totalMicros: number | null
  allocatedMicros: number
  leftMicros: number
}

// ---------- 7. Budget ----------
export function StepBudget(p: StepProps & { team: string; teamInfo: TeamInfo | null }) {
  const { form, update, team, teamInfo } = p
  const { propById } = useIndex()
  const budgetErr = fieldError(p, "budget"), goalErr = fieldError(p, "goal"), allocErr = fieldError(p, "alloc")
  const budget = Number(form.budget) || 0
  const sum = allocSum(form)
  const left = teamInfo ? fromMicros(teamInfo.leftMicros) : 0
  const over = !!teamInfo?.totalMicros && budget > left

  const splitEven = () =>
    update((f) => {
      const n = f.propIds.length || 1
      const base = Math.floor(100 / n)
      return { alloc: Object.fromEntries(f.propIds.map((pid, i) => [pid, String(i === 0 ? 100 - base * (n - 1) : base)])) }
    })

  return (
    <div className="flex flex-col gap-4">
      <StepErrors {...p} step={7} />
      <StepSection title="Budget & delivery" description="Internal budgets track cost allocation between teams. No money changes hands.">
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!budgetErr}>
              <FieldLabel htmlFor="cw-budget">Internal budget</FieldLabel>
              <InputGroup>
                <InputGroupAddon><InputGroupText>$</InputGroupText></InputGroupAddon>
                <InputGroupInput id="cw-budget" type="number" inputMode="decimal" min={0} value={form.budget} onChange={(e) => update({ budget: e.target.value })} placeholder="0" aria-invalid={!!budgetErr} />
                <InputGroupAddon align="inline-end"><InputGroupText>USD</InputGroupText></InputGroupAddon>
              </InputGroup>
              {budgetErr ? <FieldError>{budgetErr}</FieldError> : <FieldDescription>Total for the whole flight.</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel id="cw-pacing-label">Pacing</FieldLabel>
              <ToggleGroup type="single" variant="outline" value={form.pacing} onValueChange={(v) => v && update({ pacing: v as PacingMode })} aria-labelledby="cw-pacing-label" className="w-full sm:w-fit">
                <ToggleGroupItem value="even" className="flex-1 px-4 sm:flex-none">Even</ToggleGroupItem>
                <ToggleGroupItem value="asap" className="flex-1 px-4 sm:flex-none">As fast as possible</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>{form.pacing === "even" ? "Spreads delivery evenly across the flight." : "Serves as much as possible early; may end before the end date."}</FieldDescription>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="cw-goaltype">Goal type</FieldLabel>
              <Select value={form.goalType} onValueChange={(v) => update({ goalType: v as GoalType })}>
                <SelectTrigger id="cw-goaltype" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{GOAL_TYPES.map((x) => <SelectItem key={x} value={x}>{GOAL_TYPE_LABEL[x]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field data-invalid={!!goalErr}>
              <FieldLabel htmlFor="cw-goal">Goal <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
              <Input id="cw-goal" type="number" inputMode="numeric" min={0} value={form.goal} onChange={(e) => update({ goal: e.target.value })} placeholder={`e.g. ${form.goalType === "impressions" ? "2500000" : form.goalType === "clicks" ? "20000" : "1500"}`} aria-invalid={!!goalErr} />
              {goalErr ? <FieldError>{goalErr}</FieldError> : <FieldDescription>{Number(form.goal) > 0 ? `${fmt.int(Number(form.goal))} ${GOAL_TYPE_LABEL[form.goalType].toLowerCase()}` : "Used for delivery-vs-goal tracking."}</FieldDescription>}
            </Field>
          </div>
          {teamInfo ? (
            teamInfo.totalMicros == null ? (
              <Notice tone="info" title={`${team} team · ${teamInfo.quarter} internal budget`}>No budget is set for this team this quarter, so there’s nothing to check against.</Notice>
            ) : (
              <Notice tone={over ? "warning" : "info"} title={`${team} team · ${teamInfo.quarter} internal budget`}>
                {fmt.usd(Math.max(0, left))} of {fmt.money(teamInfo.totalMicros)} is unallocated ({fmt.money(teamInfo.allocatedMicros)} is committed to the team’s other live campaigns).
                {over && budget > 0 && ` This budget is ${fmt.usd(budget - Math.max(0, left))} over what’s left.`}
              </Notice>
            )
          ) : (
            <Skeleton className="h-16 w-full" />
          )}
        </FieldGroup>
      </StepSection>

      <StepSection
        title="Per-property allocation"
        description="Optional. Cap how much of the budget each app or website can use."
        action={<Switch checked={form.allocOn} onCheckedChange={(v) => update({ allocOn: v })} aria-label="Allocate budget per property" />}
      >
        {!form.allocOn ? (
          <p className="text-sm text-muted-foreground">Off — the budget is shared across all selected properties.</p>
        ) : !form.propIds.length ? (
          <p className="text-sm text-muted-foreground">Select properties first.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="divide-y rounded-lg border">
              {form.propIds.map((pid) => {
                const prop = propById[pid]
                const v = form.alloc[pid] ?? ""
                return (
                  <div key={pid} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <label htmlFor={`al-${pid}`} className="min-w-0 flex-1 truncate text-sm font-medium">{prop?.name ?? pid}</label>
                    <InputGroup className="w-28">
                      <InputGroupInput id={`al-${pid}`} type="number" inputMode="decimal" min={0} max={100} value={v} onChange={(e) => { const val = e.target.value; update((f) => ({ alloc: { ...f.alloc, [pid]: val } })) }} placeholder="0" aria-invalid={!!allocErr} />
                      <InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
                    </InputGroup>
                    <span className="w-20 text-right text-sm text-muted-foreground tabular-nums">{fmt.usd((budget * (Number(v) || 0)) / 100)}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={cn("text-sm font-medium tabular-nums", Math.round(sum) === 100 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
                Total {sum}%{Math.round(sum) !== 100 && ` · must equal 100%`}
              </span>
              <Button variant="outline" size="sm" onClick={splitEven}><Divide /> Split evenly</Button>
            </div>
            {allocErr && <FieldError>{allocErr}</FieldError>}
          </div>
        )}
      </StepSection>
    </div>
  )
}
