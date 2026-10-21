"use client"

import { useApiQuery } from "@orbit/api-client/react"
import {
  CREATIVE_STATUS_LABEL, DEVICE_LABEL, FORMAT_LABEL, GOAL_TYPE_LABEL, OBJECTIVE_LABEL, PRIORITY_LABEL, ruleSummary, toMicros, type ValidationIssue,
} from "@orbit/domain"
import { Loader2, Pencil, ShieldCheck } from "lucide-react"
import { daysLabel, hoursLabel } from "@/components/campaigns/campaign-utils"
import { Notice } from "@/components/campaigns/notice"
import { DEFAULT_T, STEPS, type StepProps } from "@/components/campaigns/wizard-state"
import { StepSection } from "@/components/campaigns/wizard-steps-setup"
import { TargetingMatrix } from "@/components/domain/targeting"
import { KeyValue } from "@/components/domain/widgets"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fmt } from "@/lib/format"
import { useIndex } from "@/lib/hooks"

export interface ReviewResult {
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  /** "server" once the API has validated exactly this payload. */
  source: "server" | "local"
  checking: boolean
}

export function StepReview(p: StepProps & { review: ReviewResult; future: boolean; canPublish: boolean }) {
  const { form, goStep, review, future, canPublish } = p
  const audiences = useApiQuery("listAudiences", {}, { select: (r) => r.items })
  const { propById, crById, plcById } = useIndex()
  const crs = form.creativeIds.map((id) => crById[id]).filter(Boolean)
  const blocking = review.errors
  const warnings = review.warnings
  const budget = Number(form.budget) || 0
  const audName = (id: string) => audiences.data?.find((a) => a.id === id)?.name ?? id
  const dests = form.propIds.filter((k) => (form.dest[k] ?? "").trim()).length

  const sections: { title: string; step: number; items: { k: React.ReactNode; v: React.ReactNode }[] }[] = [
    {
      title: "Basics", step: 1,
      items: [
        { k: "Name", v: form.name.trim() || "—" },
        { k: "Objective", v: OBJECTIVE_LABEL[form.objective] },
        { k: "Flight", v: form.start && form.end ? fmt.range(form.start, form.end) : "—" },
        { k: "Timezone", v: form.tz },
        { k: "Priority", v: PRIORITY_LABEL[form.priority] },
      ],
    },
    {
      title: "Creatives", step: 2,
      items: crs.length ? crs.map((c) => ({ k: FORMAT_LABEL[c.format], v: <span>{c.name} <span className="font-normal text-muted-foreground">· {CREATIVE_STATUS_LABEL[c.status]}</span></span> })) : [{ k: "Creatives", v: "None selected" }],
    },
    {
      title: "Properties & placements", step: 5,
      items: form.propIds.length
        ? form.propIds.map((pid) => {
            const t = form.targets[pid] ?? DEFAULT_T
            return {
              k: propById[pid]?.name ?? pid,
              v: (
                <span className="flex flex-col items-end">
                  <span>{t.placementIds.map((x) => plcById[x]?.name).filter(Boolean).join(", ") || "No placement"}</span>
                  <span className="text-xs font-normal text-muted-foreground">{ruleSummary({ mode: t.mode, countries: t.countries })}</span>
                </span>
              ),
            }
          })
        : [{ k: "Properties", v: "None selected" }],
    },
    {
      title: "Constraints", step: 6,
      items: [
        { k: "Days", v: daysLabel(form.days) },
        { k: "Hours", v: hoursLabel(form.hours) },
        { k: "Devices", v: form.devices.map((d) => DEVICE_LABEL[d]).join(", ") || "—" },
        { k: "Min app version", v: form.minOs || "Any" },
        { k: "Frequency cap", v: form.freq ? `${form.freq} per ${form.freqPer}` : "None" },
        { k: "Audiences", v: form.audiences.length ? `${form.audiences.map(audName).join(", ")} (not enforced)` : "None" },
        { k: "Destination overrides", v: form.destOn ? `${dests} set` : "Off" },
      ],
    },
    {
      title: "Budget & delivery", step: 7,
      items: [
        { k: "Internal budget", v: budget ? fmt.money(toMicros(budget)) : "—" },
        { k: "Goal", v: Number(form.goal) > 0 ? `${fmt.int(Number(form.goal))} ${GOAL_TYPE_LABEL[form.goalType].toLowerCase()}` : "None" },
        { k: "Pacing", v: form.pacing === "asap" ? "As fast as possible" : "Even" },
        { k: "Allocation", v: form.allocOn ? form.propIds.map((pid) => `${propById[pid]?.name ?? pid} ${form.alloc[pid] || 0}%`).join(", ") : "Shared across properties" },
      ],
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      {blocking.length > 0 ? (
        <Notice tone="danger" title={`${blocking.length} ${blocking.length === 1 ? "issue blocks" : "issues block"} publishing`}>
          <ul className="mt-1 flex flex-col gap-1.5">
            {blocking.map((x, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span><span className="font-medium">{STEPS[x.step - 1] ?? "Review"}:</span> {x.message}</span>
                {x.step >= 1 && x.step < STEPS.length && <Button variant="outline" size="xs" onClick={() => goStep(x.step, true)}>Fix</Button>}
              </li>
            ))}
          </ul>
        </Notice>
      ) : (
        <Notice tone="success" title={future ? "Ready to schedule" : "Ready to publish"}>
          {future ? `Delivery starts ${fmt.date(form.start)} (${form.tz}).` : "Delivery starts as soon as you publish."}
          {!canPublish && " Your role can save drafts but can’t publish; ask a campaign manager to publish it."}
        </Notice>
      )}
      {warnings.length > 0 && (
        <Notice tone="warning" title={`${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`}>
          <ul className="mt-1 flex flex-col gap-1.5">
            {warnings.map((w, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span>{w.message}</span>
                {w.step >= 1 && w.step < STEPS.length && <Button variant="ghost" size="xs" onClick={() => goStep(w.step)}>Review</Button>}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        {review.checking ? (
          <><Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking with the server…</>
        ) : review.source === "server" ? (
          <><ShieldCheck className="size-3.5" aria-hidden /> Checked by the server against the latest properties, placements, creatives and team budgets.</>
        ) : (
          <>Checked in your browser. The server checks again when you publish.</>
        )}
      </p>

      <div className="grid items-start gap-4 md:grid-cols-2">
        {sections.map((s) => (
          <Card key={s.title} size="sm" className="min-w-0">
            <CardHeader>
              <CardTitle>{s.title}</CardTitle>
              <CardAction><Button variant="ghost" size="sm" onClick={() => goStep(s.step)} aria-label={`Edit ${s.title}`}><Pencil /> Edit</Button></CardAction>
            </CardHeader>
            <CardContent><KeyValue items={s.items} /></CardContent>
          </Card>
        ))}
      </div>

      <StepSection title="Countries per property" description="Final targeting after each property’s country defaults." action={<Button variant="ghost" size="sm" onClick={() => goStep(4)}><Pencil /> Edit</Button>}>
        <TargetingMatrix targets={form.propIds.map((pid) => { const t = form.targets[pid] ?? DEFAULT_T; return { propertyId: pid, countryRule: { mode: t.mode, countries: t.countries } } })} />
      </StepSection>
    </div>
  )
}
