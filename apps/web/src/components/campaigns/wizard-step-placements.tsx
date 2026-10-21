"use client"

import { compat, FORMAT_LABEL, sizeLabel, type Creative, type Placement } from "@orbit/domain"
import { AlertTriangle, CheckCheck, Plus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { DEFAULT_T, updateTarget, WIZ_TOAST, type StepProps } from "@/components/campaigns/wizard-state"
import { StepErrors, StepSection } from "@/components/campaigns/wizard-steps-setup"
import { PlacementDialog } from "@/components/domain/placement-dialog"
import { PlatformBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { useCan, useIndex } from "@/lib/hooks"
import { cn } from "@/lib/utils"

function evaluate(pl: Placement, crs: Creative[]) {
  const ok = crs.filter((cr) => compat(cr, pl).ok)
  const compatible = ok.length > 0 && pl.status === "active"
  const reason =
    pl.status !== "active" ? "Placement is paused" : !crs.length ? "Select a creative first" : ok.length ? `Serves ${ok.map((c) => c.name).join(", ")}` : compat(crs[0], pl).reason
  return { compatible, reason }
}

export function StepPlacements(p: StepProps) {
  const { form, update, showErr, goStep } = p
  const { propById, crById, placements } = useIndex()
  const canCreate = useCan("properties.write")
  const [dialogProp, setDialogProp] = useState<string | null>(null)
  const crs = form.creativeIds.map((id) => crById[id]).filter(Boolean)
  const formats = [...new Set(crs.map((c) => FORMAT_LABEL[c.format]))]
  const errKeys = new Set((p.errors[5] ?? []).map((x) => x.key))

  const onSaved = (pl: Placement) => {
    const { compatible, reason } = evaluate(pl, crs)
    if (compatible) {
      update((f) => {
        const t = f.targets[pl.propertyId] ?? DEFAULT_T
        return { targets: { ...f.targets, [pl.propertyId]: { ...t, placementIds: [...new Set([...t.placementIds, pl.id])] } } }
      })
      toast.success(`${pl.name} selected for ${propById[pl.propertyId]?.name ?? "this property"}`, WIZ_TOAST)
    } else {
      toast.warning(`${pl.name} was created but isn’t selected`, { ...WIZ_TOAST, description: reason })
    }
  }

  if (!form.propIds.length)
    return (
      <StepSection title="Placements" description="Choose where on each property the ads appear.">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Select at least one app or website first.
          <Button variant="outline" size="sm" onClick={() => goStep(3)}>Go to Properties</Button>
        </div>
      </StepSection>
    )

  return (
    <div className="flex flex-col gap-4">
      <StepErrors {...p} step={5} />
      <p className="text-sm text-muted-foreground">
        Pick placements on each property. Only active placements whose format{formats.length ? ` (${formats.join(", ")})` : ""} and size match a selected creative can be chosen.
        {!crs.length && <> <Button variant="link" size="sm" className="h-auto px-0" onClick={() => goStep(2)}>Select a creative first.</Button></>}
      </p>
      {form.propIds.map((pid) => {
        const prop = propById[pid]
        if (!prop) return null
        const t = form.targets[pid]
        const selected = t?.placementIds ?? []
        const pls = placements.filter((x) => x.propertyId === pid)
        const rows = pls.map((pl) => ({ pl, ...evaluate(pl, crs) }))
        const compatIds = rows.filter((r) => r.compatible).map((r) => r.pl.id)
        const hasErr = showErr && errKeys.has(pid)
        const errMsgs = showErr ? (p.errors[5] ?? []).filter((x) => x.key === pid).map((x) => x.message) : []
        const toggle = (id: string) => updateTarget(update, pid, { placementIds: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] })
        return (
          <Card key={pid} className={cn("min-w-0", hasErr && "ring-destructive/60")}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">{prop.name} <PlatformBadge type={prop.platform} /></CardTitle>
              <CardDescription>{selected.length} of {pls.length} selected</CardDescription>
              <CardAction className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" size="sm" disabled={!compatIds.length} onClick={() => updateTarget(update, pid, { placementIds: [...new Set([...selected.filter((x) => compatIds.includes(x)), ...compatIds])] })}>
                  <CheckCheck /> <span className="hidden sm:inline">Select all compatible</span><span className="sm:hidden">All</span>
                </Button>
                {canCreate && <Button variant="outline" size="sm" onClick={() => setDialogProp(pid)}><Plus /> <span className="hidden sm:inline">Create placement</span><span className="sm:hidden">New</span></Button>}
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {pls.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{prop.name} has no placements yet.{canCreate ? " Create one to continue." : " Ask a developer or admin to add one."}</div>
              ) : (
                <div className="divide-y rounded-lg border">
                  {rows.map(({ pl, compatible, reason }) => {
                    const on = selected.includes(pl.id)
                    const disabled = !compatible && !on
                    return (
                      <label key={pl.id} className={cn("flex items-start gap-3 px-3 py-2.5", disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-muted/40", on && "bg-primary/5")}>
                        <Checkbox checked={on} disabled={disabled} onCheckedChange={() => toggle(pl.id)} aria-label={`Select ${pl.name}`} className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{pl.name}</div>
                          <div className="truncate font-mono text-xs text-muted-foreground">{pl.id} · {FORMAT_LABEL[pl.format]} · {sizeLabel(pl.size)}</div>
                          <div className={cn("mt-0.5 text-xs", compatible ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>{reason}</div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
              {pls.length > 0 && !compatIds.length && crs.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>None of these placements accept the selected formats ({formats.join(", ")}). Add a compatible creative or create a matching placement.</span>
                </div>
              )}
              {errMsgs.map((m, i) => <p key={i} className="text-sm text-destructive">{m.replace(`${prop.name}: `, "")}</p>)}
            </CardContent>
          </Card>
        )
      })}
      <PlacementDialog open={!!dialogProp} onOpenChange={(o) => !o && setDialogProp(null)} propertyId={dialogProp ?? undefined} onSaved={onSaved} />
    </div>
  )
}
