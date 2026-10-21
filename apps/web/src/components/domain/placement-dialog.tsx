"use client"

import { useApiMutation } from "@orbit/api-client/react"
import { FORMAT_LABEL, PLATFORM_LABEL, placementSizes, SIZED_FORMATS, sizeLabel, type AdFormat, type FreqPeriod, type Placement } from "@orbit/domain"
import { Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { errorMessage, toastError, useIndex } from "@/lib/hooks"

/**
 * Create or edit a placement. Renders nothing until `open`.
 * `propertyId` locks the property; `editId` edits an existing placement.
 * `onSaved` receives the saved placement (e.g. to auto-select it in the campaign wizard).
 */
export function PlacementDialog({ open, onOpenChange, propertyId, editId, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; propertyId?: string; editId?: string; onSaved?: (p: Placement) => void }) {
  if (!open) return null
  return <Inner key={(editId ?? "") + (propertyId ?? "")} onOpenChange={onOpenChange} propertyId={propertyId} editId={editId} onSaved={onSaved} />
}

const REFRESH = [30, 45, 60, 90]

function Inner({ onOpenChange, propertyId, editId, onSaved }: { onOpenChange: (o: boolean) => void; propertyId?: string; editId?: string; onSaved?: (p: Placement) => void }) {
  const { properties, placements, propById, plcById } = useIndex()
  const existing = editId ? plcById[editId] : undefined
  const initProp = existing?.propertyId ?? propertyId ?? ""
  const initFormat = existing?.format ?? propById[initProp]?.formats.find((f) => f !== "rich_media")
  const [f, setF] = useState({
    propertyId: initProp,
    name: existing?.name ?? "",
    format: initFormat as AdFormat | undefined,
    size: existing?.size ?? (initFormat ? placementSizes(initFormat)[0] : ""),
    minAppVersion: existing?.minAppVersion ?? "",
    freqCount: existing?.freqCap ? String(existing.freqCap.count) : "",
    freqPer: (existing?.freqCap?.per ?? "day") as FreqPeriod,
    refreshSec: existing?.refreshSec ?? (initFormat === "banner" ? 60 : null),
    status: existing?.status ?? "active",
  })
  const [showErr, setShowErr] = useState(false)
  const p = propById[f.propertyId]
  const formats = (p?.formats ?? []).filter((x) => x !== "rich_media")
  const dup = p && placements.some((x) => x.propertyId === p.id && x.id !== editId && x.name.trim().toLowerCase() === f.name.trim().toLowerCase())
  const freqOk = f.freqCount.trim() === "" || Number(f.freqCount) > 0
  const verOk = !f.minAppVersion.trim() || /^\d+(\.\d+){0,2}$/.test(f.minAppVersion.trim())
  // Report every missing field at once rather than one at a time.
  const errors = [
    !p && "Choose a property.",
    f.name.trim().length < 3 ? "Enter a placement name of at least 3 characters." : dup ? "This property already has a placement with that name." : "",
    p && !f.format && "Choose a format.",
    p && f.format && !f.size && "Choose a size.",
    !freqOk && "Frequency cap must be a positive number, or leave it empty.",
    !verOk && "Min app version looks like 6.2.1.",
  ].filter(Boolean) as string[]
  const isApp = p && p.platform !== "web"

  const onDone = (pl: Placement) => {
    toast.success(existing ? "Placement updated" : "Placement created")
    onSaved?.(pl)
    onOpenChange(false)
  }
  const create = useApiMutation("createPlacement", { onSuccess: onDone, onError: (e) => toastError(e) })
  const patch = useApiMutation("patchPlacement", { onSuccess: onDone, onError: (e) => toastError(e) })
  const pending = create.isPending || patch.isPending

  const save = () => {
    if (errors.length) { setShowErr(true); return }
    const body = {
      name: f.name.trim(), format: f.format!, size: f.size,
      minAppVersion: isApp && f.minAppVersion.trim() ? f.minAppVersion.trim() : null,
      freqCap: f.freqCount.trim() ? { count: Number(f.freqCount), per: f.freqPer } : null,
      refreshSec: f.format === "banner" ? f.refreshSec : null,
      status: f.status,
    }
    if (existing) patch.mutate({ params: { id: existing.id }, body: { ...body, rev: existing.rev } })
    else create.mutate({ body: { ...body, propertyId: p!.id } })
  }
  const serverError = create.error ?? patch.error

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit placement" : "New placement"}</DialogTitle>
          <DialogDescription>A placement is a named slot in an app or page where the SDK asks for an ad.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>Property</FieldLabel>
            {propertyId || existing ? (
              <div className="text-sm font-medium">{p?.name} <span className="text-muted-foreground">· {p ? PLATFORM_LABEL[p.platform] : ""}</span></div>
            ) : (
              <Select value={f.propertyId} onValueChange={(v) => { const fm = propById[v]?.formats.find((x) => x !== "rich_media"); setF({ ...f, propertyId: v, format: fm, size: fm ? placementSizes(fm)[0] : "", refreshSec: fm === "banner" ? 60 : null }) }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose a property" /></SelectTrigger>
                <SelectContent>{properties.map((x) => <SelectItem key={x.id} value={x.id}>{x.name} <span className="text-muted-foreground">· {PLATFORM_LABEL[x.platform]}</span></SelectItem>)}</SelectContent>
              </Select>
            )}
          </Field>
          <Field data-invalid={showErr && (f.name.trim().length < 3 || !!dup)}>
            <FieldLabel htmlFor="pl-name">Placement name</FieldLabel>
            <Input id="pl-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Match Detail Interstitial" />
          </Field>
          {formats.length > 0 && (
            <>
              <Field>
                <FieldLabel>Supported format</FieldLabel>
                <ToggleGroup type="single" variant="outline" size="sm" value={f.format} onValueChange={(v) => v && setF({ ...f, format: v as AdFormat, size: placementSizes(v as AdFormat)[0], refreshSec: v === "banner" ? (f.refreshSec ?? 60) : null })} className="flex-wrap justify-start">
                  {formats.map((x) => <ToggleGroupItem key={x} value={x} className="px-2.5">{FORMAT_LABEL[x]}</ToggleGroupItem>)}
                </ToggleGroup>
              </Field>
              <Field>
                <FieldLabel>Dimensions</FieldLabel>
                <ToggleGroup type="single" variant="outline" size="sm" value={f.size} onValueChange={(v) => v && setF({ ...f, size: v })} className="flex-wrap justify-start">
                  {(f.format ? placementSizes(f.format) : []).map((x) => <ToggleGroupItem key={x} value={x} className="px-2.5">{sizeLabel(x)}</ToggleGroupItem>)}
                </ToggleGroup>
              </Field>
            </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {isApp && (
              <Field data-invalid={showErr && !verOk}>
                <FieldLabel htmlFor="pl-mv">Min app version</FieldLabel>
                <Input id="pl-mv" value={f.minAppVersion} onChange={(e) => setF({ ...f, minAppVersion: e.target.value })} placeholder="e.g. 6.0.0" />
              </Field>
            )}
            <Field data-invalid={showErr && !freqOk}>
              <FieldLabel htmlFor="pl-fq">Frequency cap</FieldLabel>
              <div className="flex gap-2">
                <Input id="pl-fq" inputMode="numeric" value={f.freqCount} onChange={(e) => setF({ ...f, freqCount: e.target.value })} placeholder="None" className="w-20" />
                <Select value={f.freqPer} onValueChange={(v) => setF({ ...f, freqPer: v as FreqPeriod })}>
                  <SelectTrigger className="flex-1" aria-label="Frequency period"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="hour">per hour</SelectItem><SelectItem value="day">per day</SelectItem><SelectItem value="week">per week</SelectItem></SelectContent>
                </Select>
              </div>
            </Field>
            {f.format === "banner" && (
              <Field>
                <FieldLabel>Refresh interval</FieldLabel>
                <Select value={f.refreshSec == null ? "off" : String(f.refreshSec)} onValueChange={(v) => setF({ ...f, refreshSec: v === "off" ? null : Number(v) })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REFRESH.map((x) => <SelectItem key={x} value={String(x)}>{x} seconds</SelectItem>)}
                    <SelectItem value="off">Off</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field>
              <FieldLabel>Status</FieldLabel>
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as Placement["status"] })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="paused">Paused</SelectItem></SelectContent>
              </Select>
            </Field>
          </div>
          {showErr && errors.length > 0 && <FieldError errors={errors.map((message) => ({ message }))} />}
          {serverError && !errors.length && <FieldError>{errorMessage(serverError)}</FieldError>}
          {!showErr && !serverError && <FieldDescription>Only creatives with a matching format{f.format && SIZED_FORMATS.includes(f.format) ? " and size" : ""} can serve here.</FieldDescription>}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={pending}>{pending && <Loader2 className="animate-spin" />} Save placement</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
