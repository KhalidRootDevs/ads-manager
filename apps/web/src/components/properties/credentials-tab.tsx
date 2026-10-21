"use client"

import { useApiMutation, useApiQuery } from "@orbit/api-client/react"
import { KEY_ENV_LABEL, zKeyCreate, type KeyEnv, type Property, type PropertyKey } from "@orbit/domain"
import { Ban, KeyRound, Loader2, Plus, RotateCw, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { confirm } from "@/components/confirm-dialog"
import { useMutationError } from "@/components/placements/placement-utils"
import { ScreenState } from "@/components/screen-state"
import { StatusBadge } from "@/components/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmt } from "@/lib/format"
import { useCan } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import { CopyField } from "./code-block"
import { maskKey } from "./property-utils"
import { SecretDialog } from "./secret-dialog"

interface Reveal { secret: string; label: string; rotated: boolean }

export function CredentialsTab({ p }: { p: Property }) {
  const canManage = useCan("keys.manage")
  const keysQ = useApiQuery("listKeys", { params: { id: p.id } })
  const keys = keysQ.data?.items ?? []
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const onError = useMutationError("properties")
  const isWeb = p.platform === "web"

  const rotateM = useApiMutation("rotateKey", {
    onSuccess: (r) => { setReveal({ secret: r.secret, label: r.key.label, rotated: true }); toast.success(`${r.key.label} rotated`) },
    onError: (e) => onError(e, "Couldn’t rotate the key"),
  })
  const revokeM = useApiMutation("revokeKey", {
    onSuccess: (k) => { toast.success(`${k.label} revoked`) },
    onError: (e) => onError(e, "Couldn’t revoke the key"),
  })

  const rotate = async (k: PropertyKey) => {
    const ok = await confirm({
      title: `Rotate “${k.label}”?`,
      description: "A new key is issued now and the current one keeps working for 24 hours, then stops. Ship the new key in your app or site config before then. The full key is shown only once.",
      confirmLabel: "Rotate key",
      destructive: true,
    })
    if (ok) rotateM.mutate({ params: { id: p.id, keyId: k.id } })
  }
  const revoke = async (k: PropertyKey) => {
    const ok = await confirm({
      title: `Revoke “${k.label}”?`,
      description: "Requests signed with this key fail immediately and this can’t be undone. Create or rotate a key afterwards to issue a replacement.",
      confirmLabel: "Revoke key",
      destructive: true,
    })
    if (ok) revokeM.mutate({ params: { id: p.id, keyId: k.id } })
  }

  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <ShieldCheck />
        <AlertTitle>Secrets stay masked</AlertTitle>
        <AlertDescription>Only the last 4 characters of a key are ever shown. A new key’s full value appears once, right after you create or rotate it.</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{isWeb ? "Site ID" : "App ID"}</CardTitle>
          <CardDescription>Public identifier used by the {isWeb ? "web tag" : "SDK"}. Safe to ship in client code.</CardDescription>
        </CardHeader>
        <CardContent>
          <CopyField value={p.id} label={isWeb ? "Site ID" : "App ID"} className="max-w-xl" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>Sign server and SDK requests. Rotating keeps the old key valid for 24 hours.</CardDescription>
          {canManage && (
            <CardAction><Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}><Plus /> New key</Button></CardAction>
          )}
        </CardHeader>
        <CardContent>
          <ScreenState
            query={keysQ}
            isEmpty={keys.length === 0}
            loading={<div className="flex flex-col gap-2">{[0, 1].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>}
            empty={{ icon: <KeyRound />, title: "No keys yet", description: "Create a test key to integrate, then a live key before launch.", action: canManage ? <Button onClick={() => setCreateOpen(true)}><Plus /> New key</Button> : undefined }}
          >
            <ul className="divide-y rounded-lg border">
              {keys.map((k) => {
                const active = k.status === "active"
                const busy = (rotateM.isPending && rotateM.variables?.params.keyId === k.id) || (revokeM.isPending && revokeM.variables?.params.keyId === k.id)
                return (
                  <li key={k.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><KeyRound className="size-4" /></span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{k.label}</span>
                          <span className="rounded border px-1.5 text-[11px] text-muted-foreground">{KEY_ENV_LABEL[k.env]}</span>
                          <StatusBadge status={k.status} />
                        </div>
                        <code className={cn("mt-1 block truncate font-mono text-xs", k.status === "revoked" && "text-muted-foreground line-through")} aria-label={`${k.label}, masked, ending in ${k.last4}`}>{maskKey(k)}</code>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Created {fmt.date(k.createdAt)} · last used {fmt.ago(k.lastUsedAt).toLowerCase()}
                          {k.status === "grace" && k.graceUntil && <> · <span className="text-amber-700 dark:text-amber-400">works until {fmt.dateTime(k.graceUntil)}</span></>}
                          {k.status === "revoked" && k.revokedAt && <> · revoked {fmt.date(k.revokedAt)}</>}
                        </div>
                      </div>
                    </div>
                    {canManage && k.status !== "revoked" && (
                      <div className="flex shrink-0 gap-2">
                        {active && <Button variant="outline" size="sm" onClick={() => rotate(k)} disabled={busy}>{busy && rotateM.isPending ? <Loader2 className="animate-spin" /> : <RotateCw />} Rotate</Button>}
                        <Button variant="destructive" size="sm" onClick={() => revoke(k)} disabled={busy}><Ban /> Revoke</Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </ScreenState>
        </CardContent>
      </Card>

      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} propertyId={p.id} onCreated={(r) => setReveal(r)} />
      <SecretDialog secret={reveal?.secret ?? null} rotated={reveal?.rotated} title={reveal ? `New ${reveal.label.toLowerCase()} for ${p.name}` : ""} onDone={() => setReveal(null)} />
    </div>
  )
}

function CreateKeyDialog({ open, onOpenChange, propertyId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; propertyId: string; onCreated: (r: Reveal) => void }) {
  if (!open) return null
  return <CreateKeyInner onOpenChange={onOpenChange} propertyId={propertyId} onCreated={onCreated} />
}

function CreateKeyInner({ onOpenChange, propertyId, onCreated }: { onOpenChange: (o: boolean) => void; propertyId: string; onCreated: (r: Reveal) => void }) {
  const [env, setEnv] = useState<KeyEnv>("live")
  const [label, setLabel] = useState("Production SDK key")
  const [showErr, setShowErr] = useState(false)
  const onError = useMutationError("properties")
  const create = useApiMutation("createKey", {
    onSuccess: (r) => { onOpenChange(false); onCreated({ secret: r.secret, label: r.key.label, rotated: false }); toast.success(`${r.key.label} created`) },
    onError: (e) => onError(e, "Couldn’t create the key"),
  })
  const parsed = zKeyCreate.safeParse({ env, label })
  const err = parsed.success ? "" : (parsed.error.issues[0]?.path[0] === "label" ? "Use a label of 3–60 characters." : parsed.error.issues[0]?.message ?? "Check the fields.")
  const submit = () => {
    if (!parsed.success) { setShowErr(true); return }
    create.mutate({ params: { id: propertyId }, body: parsed.data })
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New API key</DialogTitle>
          <DialogDescription>The full secret is shown once, right after the key is created.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel id="key-env-label">Environment</FieldLabel>
            <ToggleGroup type="single" variant="outline" value={env} onValueChange={(v) => { if (!v) return; setEnv(v as KeyEnv); setLabel(v === "live" ? "Production SDK key" : "Test SDK key") }} aria-labelledby="key-env-label" className="w-full sm:w-fit">
              <ToggleGroupItem value="live" className="flex-1 px-3 sm:flex-none">Live</ToggleGroupItem>
              <ToggleGroupItem value="test" className="flex-1 px-3 sm:flex-none">Test</ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>{env === "test" ? "Test keys only ever receive test ads; nothing is counted or billed." : "Live keys serve real campaigns."}</FieldDescription>
          </Field>
          <Field data-invalid={(showErr && !!err) || undefined}>
            <FieldLabel htmlFor="key-label">Label</FieldLabel>
            <Input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} aria-invalid={(showErr && !!err) || undefined} />
            {showErr && err && <FieldError>{err}</FieldError>}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>{create.isPending && <Loader2 className="animate-spin" />} Create key</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
