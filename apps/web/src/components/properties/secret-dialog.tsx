"use client"

import { KeyRound, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { CopyField } from "./code-block"

/**
 * One-time reveal of a freshly issued secret. The secret only lives in the parent's state
 * while this dialog is open; it can't be dismissed until the user confirms they stored it.
 */
export function SecretDialog({ secret, title, rotated = false, onDone }: { secret: string | null; title: string; rotated?: boolean; onDone: () => void }) {
  if (!secret) return null
  return <Inner key={secret} secret={secret} title={title} rotated={rotated} onDone={onDone} />
}

function Inner({ secret, title, rotated, onDone }: { secret: string; title: string; rotated: boolean; onDone: () => void }) {
  const [ack, setAck] = useState(false)
  const tryClose = () => {
    if (ack) onDone()
    else toast.warning("Confirm you’ve stored the new key first. It won’t be shown again.")
  }
  return (
    <Dialog open onOpenChange={(o) => !o && tryClose()}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="size-4" /> {title}</DialogTitle>
          <DialogDescription>Copy this key into your app or site configuration now.</DialogDescription>
        </DialogHeader>
        <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200">
          <TriangleAlert />
          <AlertTitle>Shown once</AlertTitle>
          <AlertDescription className="text-amber-900/80 dark:text-amber-200/80">After you close this dialog only the last 4 characters are visible.{rotated && " The previous key keeps working for 24 hours."}</AlertDescription>
        </Alert>
        <CopyField value={secret} label="Secret key" />
        <div className="flex items-start gap-2">
          <Checkbox id="secret-ack" checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
          <Label htmlFor="secret-ack" className="leading-snug font-normal">I’ve stored the new key somewhere safe</Label>
        </div>
        <DialogFooter>
          <Button onClick={onDone} disabled={!ack}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
