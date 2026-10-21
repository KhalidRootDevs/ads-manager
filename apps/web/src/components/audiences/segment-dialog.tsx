"use client"

import { useApiMutation, useApiQuery } from "@orbit/api-client/react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toastError } from "@/lib/hooks"
import { ruleText } from "./rule-text"

const daysError = (days: string) => {
  const n = Number(days)
  return days.trim() === "" || !Number.isInteger(n) || n < 1 ? "Look-back must be a whole number of days, 1 or more." : n > 365 ? "Look-back can be at most 365 days." : ""
}

/** "New segment" dialog. Mount with a fresh `key` each time it opens so the form resets. */
export function SegmentDialog({ open, onOpenChange, existingNames }: { open: boolean; onOpenChange: (o: boolean) => void; existingNames: string[] }) {
  const eventsQ = useApiQuery("listEvents", {}, { select: (r) => r.items })
  const events = eventsQ.data ?? []
  const create = useApiMutation("createAudience", {
    onSuccess: (a) => {
      toast.success("Segment saved as draft", { description: `${a.name} · not enforced until the event pipeline ships` })
      onOpenChange(false)
    },
    onError: (e) => toastError(e, "Couldn’t save the segment"),
  })

  const [name, setName] = useState("")
  const [event, setEvent] = useState("")
  const [days, setDays] = useState("30")
  const [excludeOn, setExcludeOn] = useState(false)
  const [exEvent, setExEvent] = useState("")
  const [exDays, setExDays] = useState("30")
  const [submitted, setSubmitted] = useState(false)

  const ev = event || events[0]?.key || ""
  const trimmed = name.trim()
  const nameErr =
    trimmed.length < 3 ? "Enter a segment name (at least 3 characters)."
      : trimmed.length > 120 ? "Keep the name under 120 characters."
        : existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase()) ? "A segment with this name already exists."
          : ""
  const eventErr = ev ? "" : "Choose an event."
  const dErr = daysError(days)
  const exEventErr = excludeOn && !exEvent ? "Choose an event to exclude." : excludeOn && exEvent === ev ? "Pick a different event than the one you include." : ""
  const exDaysErr = excludeOn ? daysError(exDays) : ""
  const selected = events.find((e) => e.key === ev)
  const rule = { event: ev, withinDays: Number(days) || 0, exclude: excludeOn && exEvent ? { event: exEvent, withinDays: Number(exDays) || 0 } : null }

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (nameErr || eventErr || dErr || exEventErr || exDaysErr) return
    create.mutate({ body: { name: trimmed, rule } })
  }

  const eventItems = events.map((x) => (
    <SelectItem key={x.key} value={x.key}>
      <span className="font-mono text-xs">{x.key}</span>
      <span className="text-muted-foreground">{x.name}{x.active ? "" : " · inactive"}</span>
    </SelectItem>
  ))

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>New audience segment</DialogTitle>
            <DialogDescription>Saved as a Draft. Not enforced until the event pipeline is live.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field data-invalid={(submitted && !!nameErr) || undefined}>
              <FieldLabel htmlFor="seg-name">Segment name</FieldLabel>
              <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Recent installers — GCC" aria-invalid={(submitted && !!nameErr) || undefined} aria-describedby={submitted && nameErr ? "seg-name-error" : undefined} autoFocus />
              {submitted && nameErr && <FieldError id="seg-name-error">{nameErr}</FieldError>}
            </Field>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <Field data-invalid={(submitted && !!eventErr) || undefined}>
                <FieldLabel htmlFor="seg-event">Users who sent</FieldLabel>
                <Select value={ev} onValueChange={setEvent} disabled={eventsQ.isPending}>
                  <SelectTrigger id="seg-event" className="w-full" aria-invalid={(submitted && !!eventErr) || undefined}>
                    <SelectValue placeholder={eventsQ.isPending ? "Loading events…" : "Choose an event"} />
                  </SelectTrigger>
                  <SelectContent position="popper">{eventItems}</SelectContent>
                </Select>
                {submitted && eventErr && <FieldError>{eventErr}</FieldError>}
              </Field>
              <Field data-invalid={(submitted && !!dErr) || undefined}>
                <FieldLabel htmlFor="seg-days">In the last (days)</FieldLabel>
                <Input id="seg-days" type="number" inputMode="numeric" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} aria-invalid={(submitted && !!dErr) || undefined} aria-describedby={submitted && dErr ? "seg-days-error" : undefined} />
                {submitted && dErr && <FieldError id="seg-days-error">{dErr}</FieldError>}
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="seg-exclude" checked={excludeOn} onCheckedChange={(v) => setExcludeOn(v === true)} />
              <Label htmlFor="seg-exclude" className="font-normal">Exclude users who sent another event</Label>
            </div>
            {excludeOn && (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
                <Field data-invalid={(submitted && !!exEventErr) || undefined}>
                  <FieldLabel htmlFor="seg-ex-event">But not users who sent</FieldLabel>
                  <Select value={exEvent} onValueChange={setExEvent}>
                    <SelectTrigger id="seg-ex-event" className="w-full" aria-invalid={(submitted && !!exEventErr) || undefined}>
                      <SelectValue placeholder="Choose an event" />
                    </SelectTrigger>
                    <SelectContent position="popper">{eventItems}</SelectContent>
                  </Select>
                  {submitted && exEventErr && <FieldError>{exEventErr}</FieldError>}
                </Field>
                <Field data-invalid={(submitted && !!exDaysErr) || undefined}>
                  <FieldLabel htmlFor="seg-ex-days">In the last (days)</FieldLabel>
                  <Input id="seg-ex-days" type="number" inputMode="numeric" min={1} max={365} value={exDays} onChange={(e) => setExDays(e.target.value)} aria-invalid={(submitted && !!exDaysErr) || undefined} />
                  {submitted && exDaysErr && <FieldError>{exDaysErr}</FieldError>}
                </Field>
              </div>
            )}
            <FieldDescription>
              Rule preview: <span className="font-mono text-foreground">{ruleText({ ...rule, event: ev || "event" })}</span>
              {selected && !selected.active && <span className="mt-1 block text-amber-700 dark:text-amber-400">This event is inactive, so the segment will stay empty until it is turned back on.</span>}
            </FieldDescription>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={create.isPending}>Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving…" : "Save segment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
