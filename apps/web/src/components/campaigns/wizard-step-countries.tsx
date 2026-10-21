"use client"

import { availSet, COUNTRY_MODE_LABEL, finalCountries, ruleSummary } from "@orbit/domain"
import { AlertTriangle, ChevronDown, Copy, Lock } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { DEFAULT_T, updateTarget, WIZ_TOAST, type StepProps } from "@/components/campaigns/wizard-state"
import { StepErrors, StepSection } from "@/components/campaigns/wizard-steps-setup"
import { confirm } from "@/components/confirm-dialog"
import { CountryRuleEditor, TargetingMatrix } from "@/components/domain/targeting"
import { PlatformBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useIndex } from "@/lib/hooks"
import { cn } from "@/lib/utils"

export function StepCountries(p: StepProps) {
  const { form, update, showErr, goStep, canTarget } = p
  const { propById, countries, ctryByCode } = useIndex()
  const errKeys = new Set((p.errors[4] ?? []).map((x) => x.key))
  const [open, setOpen] = useState<string[]>(() => {
    const first = form.propIds[0]
    const withErr = form.propIds.filter((id) => errKeys.has(id))
    return [...new Set([...(first ? [first] : []), ...withErr])]
  })
  const toggleOpen = (id: string, o: boolean) => setOpen((x) => (o ? [...new Set([...x, id])] : x.filter((y) => y !== id)))

  if (!form.propIds.length)
    return (
      <StepSection title="Countries per property" description="Each app or website gets its own country rule.">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Select at least one app or website first.
          <Button variant="outline" size="sm" onClick={() => goStep(3)}>Go to Properties</Button>
        </div>
      </StepSection>
    )

  const copyRule = async (pid: string) => {
    const t = form.targets[pid] ?? DEFAULT_T
    const src = propById[pid]
    const others = form.propIds.length - 1
    const ok = await confirm({
      title: `Copy ${src?.name}’s country rule?`,
      description: `This replaces the country rules on the other ${others} selected ${others === 1 ? "property" : "properties"} with “${ruleSummary(t)}”. Placements and other settings stay the same.`,
      confirmLabel: "Copy rule",
    })
    if (!ok) return
    update((f) => {
      const targets = { ...f.targets }
      f.propIds.forEach((id) => { if (id !== pid) targets[id] = { ...(targets[id] ?? DEFAULT_T), mode: t.mode, countries: [...t.countries] } })
      return { targets }
    })
    toast.success(`Rule copied to ${others} ${others === 1 ? "property" : "properties"}`, { ...WIZ_TOAST, description: "Check each one for conflicts with its own country defaults." })
  }

  const allOpen = open.length === form.propIds.length

  return (
    <div className="flex flex-col gap-4">
      <StepErrors {...p} step={4} />
      {!canTarget && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Your role can’t change country targeting. The rules below are read-only.</span>
        </div>
      )}
      <StepSection
        title="Countries per property"
        description="Set the country rule for each app or website separately. A rule is checked against that property’s own country defaults, so the same country can serve on one app and not another."
        action={<Button variant="ghost" size="sm" onClick={() => setOpen(allOpen ? [] : [...form.propIds])}>{allOpen ? "Collapse all" : "Expand all"}</Button>}
      >
        <div className="flex flex-col gap-3">
          {form.propIds.map((pid) => {
            const prop = propById[pid]
            if (!prop) return null
            const t = form.targets[pid] ?? DEFAULT_T
            const rule = { mode: t.mode, countries: t.countries }
            const av = availSet(prop.countryRule, countries)
            const fin = finalCountries(rule, prop.countryRule, countries)
            const conf = t.mode === "include" ? t.countries.filter((c) => !av.has(c)) : []
            const hasErr = showErr && errKeys.has(pid)
            const isOpen = open.includes(pid)
            return (
              <Collapsible key={pid} open={isOpen} onOpenChange={(o) => toggleOpen(pid, o)} className={cn("rounded-lg border", hasErr && "border-destructive/60", isOpen && "bg-muted/20")}>
                <CollapsibleTrigger asChild>
                  <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50">
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !isOpen && "-rotate-90")} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{prop.name}</span>
                        <PlatformBadge type={prop.platform} />
                        {conf.length > 0 && (
                          <Badge variant="secondary" className="bg-amber-500/15 text-amber-800 dark:text-amber-300"><AlertTriangle /> {conf.length} {conf.length === 1 ? "conflict" : "conflicts"}</Badge>
                        )}
                        {hasErr && <Badge variant="destructive">Needs countries</Badge>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{ruleSummary(rule)} · serves in {fin.length}</div>
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="flex flex-col gap-4 border-t px-3 py-4">
                    {canTarget ? (
                      <CountryRuleEditor
                        mode={t.mode}
                        countries={t.countries}
                        property={prop}
                        onChange={(n) => updateTarget(update, pid, { mode: n.mode, countries: n.countries })}
                      />
                    ) : (
                      <div className="flex flex-col gap-2 text-sm">
                        <span className="font-medium">{COUNTRY_MODE_LABEL[t.mode]}</span>
                        <div className="flex flex-wrap gap-1.5">
                          {t.countries.length ? t.countries.map((c) => <Badge key={c} variant="secondary" className="font-normal"><span className="font-mono text-[11px]">{c}</span> {ctryByCode[c]?.name ?? c}</Badge>) : <span className="text-muted-foreground">Uses every country {prop.name} allows by default.</span>}
                        </div>
                      </div>
                    )}
                    {canTarget && form.propIds.length > 1 && (
                      <div className="flex justify-end">
                        <Button variant="outline" size="sm" onClick={() => void copyRule(pid)}><Copy /> Copy this rule to the other properties</Button>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      </StepSection>

      <StepSection title="Final targeting matrix" description="What will actually serve on each property after its defaults are applied.">
        <TargetingMatrix targets={form.propIds.map((pid) => { const t = form.targets[pid] ?? DEFAULT_T; return { propertyId: pid, countryRule: { mode: t.mode, countries: t.countries } } })} />
      </StepSection>
    </div>
  )
}
