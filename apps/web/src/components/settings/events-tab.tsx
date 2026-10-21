"use client"

import { useApiMutation, useApiQuery } from "@orbit/api-client/react"
import { EVENT_SOURCE_LABEL, EVENT_SOURCES, type EventDefinition, type EventSource } from "@orbit/domain"
import type { ColumnDef } from "@tanstack/react-table"
import { CircleCheck, CircleOff, Copy, Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { DataTable, facetFilterFn, SortHeader } from "@/components/data-table"
import { actionsColumn, RowActions } from "@/components/row-actions"
import { ScreenState } from "@/components/screen-state"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { fmt } from "@/lib/format"
import { toastError, useCan } from "@/lib/hooks"

/** Same rule as the API (`zEventCreate`). */
const KEY_RE = /^[a-z][a-z0-9_]{1,49}$/

type Row = EventDefinition & { sourceLabel: string }

export function EventsTab() {
  const q = useApiQuery("listEvents", {}, { select: (r) => r.items })
  const canEdit = useCan("events.write")
  const [open, setOpen] = useState(false)
  const patch = useApiMutation("patchEvent", { onError: (e) => toastError(e, "Couldn’t change the event") })
  const rows = useMemo<Row[]>(() => (q.data ?? []).map((e) => ({ ...e, sourceLabel: EVENT_SOURCE_LABEL[e.source] })), [q.data])

  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => {
    const toggle = (e: Row) => patch.mutate({ params: { key: e.key }, body: { active: !e.active } }, { onSuccess: () => toast.success(`${e.key} ${e.active ? "deactivated" : "activated"}`) })
    const copyKey = (e: Row) => void navigator.clipboard.writeText(e.key).then(() => toast.success(`Copied ${e.key}`), () => toast.error("Couldn’t copy the key"))
    return [
      { accessorKey: "name", header: ({ column }) => <SortHeader column={column} title="Event" />, meta: { label: "Event", primary: true }, enableHiding: false, cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      { accessorKey: "key", header: "Key", meta: { label: "Key" }, cell: ({ row }) => <code className="font-mono text-xs">{row.original.key}</code> },
      { accessorKey: "sourceLabel", id: "source", header: ({ column }) => <SortHeader column={column} title="Source" />, meta: { label: "Source" }, filterFn: facetFilterFn },
      { accessorKey: "lastSeenAt", header: "Last received", meta: { label: "Last received" }, cell: ({ row }) => <span title={fmt.dateTime(row.original.lastSeenAt)}>{fmt.ago(row.original.lastSeenAt)}</span> },
      { accessorKey: "active", header: "Status", meta: { label: "Status" }, cell: ({ row }) => <StatusBadge status={row.original.active ? "Active" : "Inactive"} /> },
      actionsColumn<Row>((e) => (
        <RowActions
          label={`Actions for ${e.name}`}
          title={e.name}
          busy={patch.isPending && patch.variables?.params.key === e.key}
          groups={[
            [{ label: "Copy event key", icon: Copy, onSelect: () => copyKey(e), hint: e.key.length <= 14 ? e.key : undefined }],
            [
              canEdit && e.active && {
                label: "Deactivate",
                icon: CircleOff,
                destructive: true,
                onSelect: () => toggle(e),
                confirm: {
                  title: `Deactivate ${e.name}?`,
                  description: `Orbit stops recording ${e.key} from now on. Campaigns with a Conversion objective that count it will show no new conversions until you activate it again. Past data is kept.`,
                  confirmLabel: "Deactivate event",
                  destructive: true,
                },
              },
              canEdit && !e.active && { label: "Activate", icon: CircleCheck, onSelect: () => toggle(e) },
            ],
          ]}
        />
      )),
    ]
  }, [patch, canEdit])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Conversion events received from the SDK, your servers or the web tag. Campaigns with a Conversion objective count these.</p>
      <ScreenState query={q} loading={<Skeleton className="h-72" />}>
        <DataTable
          columns={columns}
          data={rows}
          searchPlaceholder="Search events…"
          searchText={(e) => `${e.name} ${e.key}`}
          filters={[{ columnId: "source", title: "Source", options: EVENT_SOURCES.map((s) => ({ label: EVENT_SOURCE_LABEL[s], value: EVENT_SOURCE_LABEL[s] })) }]}
          toolbar={canEdit ? <Button size="sm" onClick={() => setOpen(true)}><Plus /> Add event</Button> : undefined}
        />
      </ScreenState>
      {open && <AddEventDialog existing={rows.map((r) => r.key)} onClose={() => setOpen(false)} />}
    </div>
  )
}

function AddEventDialog({ existing, onClose }: { existing: string[]; onClose: () => void }) {
  const [name, setName] = useState("")
  const [key, setKey] = useState("")
  const [keyEdited, setKeyEdited] = useState(false)
  const [source, setSource] = useState<EventSource>("sdk")
  const [showErr, setShowErr] = useState(false)
  const create = useApiMutation("createEvent", {
    onSuccess: (e) => { toast.success(`Event ${e.key} added`); onClose() },
    onError: (e) => toastError(e, "Couldn’t add the event"),
  })
  const onName = (v: string) => {
    setName(v)
    if (!keyEdited) setKey(v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+|_+$/g, "").slice(0, 50))
  }
  const nameErr = name.trim().length < 3 ? "Enter a name of at least 3 characters." : name.trim().length > 80 ? "Keep the name under 80 characters." : ""
  const keyErr = !KEY_RE.test(key) ? "Use 2–50 lowercase letters, digits or underscores, starting with a letter (e.g. trial_start)." : existing.includes(key) ? "An event with this key already exists." : ""
  const save = () => {
    if (nameErr || keyErr) { setShowErr(true); return }
    create.mutate({ body: { name: name.trim(), key, source } })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add conversion event</DialogTitle>
          <DialogDescription>Define an event your apps, sites or servers will send.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={(ev) => { ev.preventDefault(); save() }}>
          <FieldGroup>
            <Field data-invalid={showErr && !!nameErr}>
              <FieldLabel htmlFor="ev-name">Name</FieldLabel>
              <Input id="ev-name" autoFocus value={name} onChange={(e) => onName(e.target.value)} placeholder="e.g. Subscription renewed" aria-invalid={showErr && !!nameErr} />
              {showErr && nameErr && <FieldError>{nameErr}</FieldError>}
            </Field>
            <Field data-invalid={showErr && !!keyErr}>
              <FieldLabel htmlFor="ev-key">Key</FieldLabel>
              <Input id="ev-key" className="font-mono" value={key} onChange={(e) => { setKeyEdited(true); setKey(e.target.value.trim().toLowerCase()) }} placeholder="subscription_renewed" spellCheck={false} autoCapitalize="none" aria-invalid={showErr && !!keyErr} />
              {showErr && keyErr ? <FieldError>{keyErr}</FieldError> : <FieldDescription>Sent by the SDK or API. Can’t be changed later.</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor="ev-source">Source</FieldLabel>
              <Select value={source} onValueChange={(v) => setSource(v as EventSource)}>
                <SelectTrigger id="ev-source" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{EVENT_SOURCES.map((s) => <SelectItem key={s} value={s}>{EVENT_SOURCE_LABEL[s]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Adding…" : "Add event"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
