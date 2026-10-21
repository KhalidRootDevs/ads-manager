"use client"

import { zRejectInput } from "@orbit/domain"
import { Loader2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"

/** Asks for a rejection reason (prefilled from failing checks). Renders nothing until open. */
/** The parent closes the dialog when the API call succeeds; `pending` disables the button meanwhile. */
export function RejectDialog({ open, onOpenChange, name, suggested, liveCount, onReject, pending }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  name: string
  suggested: string
  liveCount: number
  onReject: (reason: string) => void
  pending?: boolean
}) {
  if (!open) return null
  return <Inner onOpenChange={onOpenChange} name={name} suggested={suggested} liveCount={liveCount} onReject={onReject} pending={pending} />
}

const zReason = zRejectInput.shape.reason

function Inner({ onOpenChange, name, suggested, liveCount, onReject, pending }: Omit<React.ComponentProps<typeof RejectDialog>, "open">) {
  const [reason, setReason] = useState(suggested.slice(0, 300))
  const [err, setErr] = useState(false)
  const submit = () => {
    const r = zReason.safeParse(reason)
    if (!r.success) { setErr(true); return }
    onReject(r.data)
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject “{name}”?</DialogTitle>
          <DialogDescription>
            The owner sees this reason and can edit and resubmit.
            {liveCount > 0 && ` ${liveCount} live or scheduled campaign${liveCount === 1 ? "" : "s"} will stop serving it.`}
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={err || undefined}>
          <FieldLabel htmlFor="reject-reason">Reason for the owner</FieldLabel>
          <Textarea id="reject-reason" rows={4} value={reason} onChange={(e) => { setReason(e.target.value); setErr(false) }} aria-invalid={err || undefined} />
          {err ? <FieldError>Write a reason of 5–300 characters.</FieldError> : <FieldDescription>Be specific: which guideline failed and how to fix it.</FieldDescription>}
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" className="bg-destructive text-white hover:bg-destructive/90" onClick={submit} disabled={pending}>{pending && <Loader2 className="animate-spin" />} Reject creative</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
