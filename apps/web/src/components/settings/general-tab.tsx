"use client"

import { ApiError, useApiMutation } from "@orbit/api-client/react"
import { FREQ_PERIODS, type FreqPeriod, type Settings } from "@orbit/domain"
import { useState } from "react"
import { toast } from "sonner"
import { useDirty } from "@/components/nav-guard"
import { ScreenState } from "@/components/screen-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { toastError, useCan, useSettings } from "@/lib/hooks"

const REFRESH: [string, string][] = [["30", "30 seconds"], ["45", "45 seconds"], ["60", "60 seconds"], ["90", "90 seconds"], ["off", "Off (no auto-refresh)"]]
const PER_LABEL: Record<FreqPeriod, string> = { hour: "per user per hour", day: "per user per day", week: "per user per week" }

type SwitchKey = "clicks" | "viewability" | "ipTruncation" | "autoPauseOnBudget"
const SWITCHES: { key: SwitchKey; label: string; desc: string }[] = [
  { key: "clicks", label: "Click tracking", desc: "Wrap destination URLs in a redirect so clicks are counted." },
  { key: "viewability", label: "Viewability measurement", desc: "Count an impression only when 50% of the ad is on screen for 1 second." },
  { key: "ipTruncation", label: "IP truncation", desc: "Drop the last octet of IP addresses before storing events." },
  { key: "autoPauseOnBudget", label: "Auto-pause on budget spent", desc: "Pause a campaign automatically once its budget is fully spent." },
]

/** Form state: strings for inputs, so a half-typed number is still editable. */
interface Form {
  freq: string
  freqPer: FreqPeriod
  refresh: string
  clicks: boolean
  viewability: boolean
  ipTruncation: boolean
  autoPauseOnBudget: boolean
}

function toForm(s: Settings): Form {
  return {
    freq: s.defaults.freqCap ? String(s.defaults.freqCap.count) : "",
    freqPer: s.defaults.freqCap?.per ?? "day",
    refresh: s.defaults.refreshSec == null ? "off" : String(s.defaults.refreshSec),
    clicks: s.tracking.clicks, viewability: s.tracking.viewability, ipTruncation: s.tracking.ipTruncation, autoPauseOnBudget: s.autoPauseOnBudget,
  }
}

export function GeneralTab() {
  const q = useSettings()
  return (
    <ScreenState query={q} loading={<Skeleton className="h-96" />}>
      {/* Remount on a new server revision so the form starts from the saved values. */}
      {q.data && <GeneralForm key={q.data.rev} settings={q.data} refetch={() => q.refetch()} />}
    </ScreenState>
  )
}

function GeneralForm({ settings, refetch }: { settings: Settings; refetch: () => void }) {
  const canEdit = useCan("settings.write")
  const saved = toForm(settings)
  const [g, setG] = useState<Form>(saved)
  const [showErr, setShowErr] = useState(false)
  const dirty = JSON.stringify(g) !== JSON.stringify(saved)
  useDirty(dirty && canEdit)
  const set = (patch: Partial<Form>) => setG((x) => ({ ...x, ...patch }))
  const put = useApiMutation("putSettings", {
    onSuccess: () => { toast.dismiss(); toast.success("Settings saved") },
    onError: (e) => {
      toastError(e)
      if (e instanceof ApiError && e.status === 409) refetch()
    },
  })

  const n = Number(g.freq)
  const freqErr = g.freq.trim() !== "" && (!/^\d+$/.test(g.freq.trim()) || n < 1 || n > 100) ? "Enter a whole number between 1 and 100, or leave empty for no default cap." : ""
  const refreshOpts = REFRESH.some(([v]) => v === g.refresh) ? REFRESH : [...REFRESH, [g.refresh, `${g.refresh} seconds`] as [string, string]]

  const save = () => {
    if (freqErr) { setShowErr(true); toast.error("Fix the highlighted fields first."); return }
    put.mutate({
      body: {
        rev: settings.rev,
        defaults: { freqCap: g.freq.trim() ? { count: n, per: g.freqPer } : null, refreshSec: g.refresh === "off" ? null : Number(g.refresh) },
        tracking: { clicks: g.clicks, viewability: g.viewability, ipTruncation: g.ipTruncation },
        autoPauseOnBudget: g.autoPauseOnBudget,
      },
    })
  }
  const discard = () => { setG(saved); setShowErr(false) }
  const disabled = !canEdit || put.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Workspace defaults
          {dirty && <Badge variant="secondary" className="bg-amber-500/15 text-amber-800 dark:text-amber-300">Unsaved changes</Badge>}
          {!canEdit && <Badge variant="outline">View only</Badge>}
        </CardTitle>
        <CardDescription>Apply to new campaigns and placements. Existing ones keep their own values.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-2">
            <Field data-invalid={showErr && !!freqErr}>
              <FieldLabel htmlFor="g-freq">Default frequency cap</FieldLabel>
              <div className="flex gap-2">
                <Input id="g-freq" inputMode="numeric" value={g.freq} onChange={(e) => set({ freq: e.target.value })} className="w-24" aria-invalid={showErr && !!freqErr} placeholder="None" disabled={disabled} />
                <Select value={g.freqPer} onValueChange={(v) => set({ freqPer: v as FreqPeriod })} disabled={disabled}>
                  <SelectTrigger className="flex-1" aria-label="Frequency cap period"><SelectValue /></SelectTrigger>
                  <SelectContent>{FREQ_PERIODS.map((p) => <SelectItem key={p} value={p}>{PER_LABEL[p]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {showErr && freqErr ? <FieldError>{freqErr}</FieldError> : <FieldDescription>Maximum impressions of one campaign per user.</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor="g-refresh">Default banner refresh</FieldLabel>
              <Select value={g.refresh} onValueChange={(v) => set({ refresh: v })} disabled={disabled}>
                <SelectTrigger id="g-refresh" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{refreshOpts.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
              <FieldDescription>How often banner placements request a new ad.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="g-tz">Reporting timezone</FieldLabel>
              <Input id="g-tz" value={settings.reportingTz} readOnly disabled />
              <FieldDescription>Day boundaries in reports and pacing. Fixed platform-wide so daily rollups stay comparable.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="g-cur">Currency</FieldLabel>
              <Input id="g-cur" value={settings.currency} readOnly disabled />
              <FieldDescription>Internal budgets and spend are tracked in US dollars.</FieldDescription>
            </Field>
          </div>
          <div className="divide-y rounded-lg border">
            {SWITCHES.map((s) => (
              <div key={s.key} className="flex items-start justify-between gap-4 p-3">
                <div className="space-y-0.5">
                  <Label htmlFor={`g-${s.key}`}>{s.label}</Label>
                  <p className="text-xs text-muted-foreground">{s.desc}</p>
                </div>
                <Switch id={`g-${s.key}`} checked={g[s.key]} onCheckedChange={(v) => set({ [s.key]: v })} disabled={disabled} />
              </div>
            ))}
          </div>
        </FieldGroup>
      </CardContent>
      {canEdit && (
        <CardFooter className="justify-end gap-2 border-t">
          <Button variant="outline" onClick={discard} disabled={!dirty || put.isPending}>Discard</Button>
          <Button onClick={save} disabled={!dirty || put.isPending}>{put.isPending ? "Saving…" : "Save changes"}</Button>
        </CardFooter>
      )}
    </Card>
  )
}
