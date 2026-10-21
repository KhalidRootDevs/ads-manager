"use client"

import { ApiError, useApiMutation } from "@orbit/api-client/react"
import { canAssignRole, PERMISSION_TABLE, ROLE_LABEL, ROLES, USER_STATUS_LABEL, type Role, type User } from "@orbit/domain"
import { useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Check, Copy, UserCog, UserMinus, UserPlus } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { DataTable, facetFilterFn, SortHeader } from "@/components/data-table"
import { actionsColumn, RowActions } from "@/components/row-actions"
import { ScreenState } from "@/components/screen-state"
import { StatusBadge } from "@/components/status-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { fmt } from "@/lib/format"
import { toastError, useCan, useMe, useTeam } from "@/lib/hooks"
import { cn } from "@/lib/utils"

export const ROLE_DESC: Record<Role, string> = {
  owner: "Full access including ownership and every setting",
  admin: "Everything except ownership transfer; approves creatives",
  campaign_manager: "Creates and publishes campaigns and creatives",
  analyst: "Reports and exports, read-only elsewhere",
  developer: "Properties, placements, SDK keys and diagnostics",
  read_only: "View everything, change nothing",
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

type Row = User & { you: boolean; roleLabel: string }

export function TeamTab() {
  const q = useTeam()
  const me = useMe()
  const canManage = useCan("team.manage")
  const myRole = me.data?.user.role
  const [inviteOpen, setInviteOpen] = useState(false)
  const [roleFor, setRoleFor] = useState<Row | null>(null)
  const remove = useApiMutation("removeMember", { onError: (e) => toastError(e, "Couldn’t remove the member") })

  const rows = useMemo<Row[]>(() => (q.data ?? []).map((u) => ({ ...u, you: u.id === me.data?.user.id, roleLabel: ROLE_LABEL[u.role] })), [q.data, me.data])

  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => {
    const onRemove = (m: Row) => {
      const invited = m.status === "invited"
      remove.mutate({ params: { id: m.id } }, { onSuccess: () => toast.success(invited ? `Invite for ${m.email} cancelled` : `${m.name} removed`) })
    }
    const copyEmail = (m: Row) => {
      void navigator.clipboard.writeText(m.email).then(() => toast.success("Email copied"), () => toast.error("Couldn’t copy the email"))
    }
    return [
      {
        accessorKey: "name",
        header: ({ column }) => <SortHeader column={column} title="Member" />,
        meta: { label: "Member", primary: true },
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar><AvatarFallback className="text-xs font-medium">{fmt.initials(row.original.name || row.original.email)}</AvatarFallback></Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 truncate font-medium">{row.original.name || row.original.email}{row.original.you && <Badge variant="secondary" className="h-4.5 px-1.5 text-[10px]">You</Badge>}</div>
              <div className="truncate text-xs text-muted-foreground">{row.original.email}</div>
            </div>
          </div>
        ),
      },
      { accessorKey: "roleLabel", id: "role", header: ({ column }) => <SortHeader column={column} title="Role" />, meta: { label: "Role" }, filterFn: facetFilterFn },
      { accessorKey: "status", header: "Status", meta: { label: "Status" }, cell: ({ row }) => <StatusBadge status={USER_STATUS_LABEL[row.original.status]} /> },
      {
        accessorKey: "lastActiveAt",
        header: "Last active",
        meta: { label: "Last active" },
        cell: ({ row }) => row.original.status === "invited" ? <span className="text-muted-foreground">Invite pending</span> : <span title={fmt.dateTime(row.original.lastActiveAt)}>{fmt.ago(row.original.lastActiveAt)}</span>,
      },
      actionsColumn<Row>((m) => {
        if (!canManage) return null
        const locked = m.you || !myRole || !canAssignRole(myRole, m.role)
        const invited = m.status === "invited"
        const name = m.name || m.email
        return (
          <RowActions
            label={`Actions for ${name}`}
            title={name}
            busy={remove.isPending && remove.variables?.params.id === m.id}
            groups={[
              [
                { label: "Change role", icon: UserCog, onSelect: () => setRoleFor(m), disabled: locked, hint: locked ? (m.you ? "You" : "Owner only") : ROLE_LABEL[m.role] },
                { label: "Copy email", icon: Copy, onSelect: () => copyEmail(m) },
              ],
              [
                !locked && {
                  label: invited ? "Cancel invite" : "Remove from workspace",
                  icon: UserMinus,
                  destructive: true,
                  onSelect: () => onRemove(m),
                  confirm: {
                    title: invited ? `Cancel the invite for ${m.email}?` : `Remove ${m.name}?`,
                    description: invited
                      ? "The invite link stops working immediately. You can invite them again later."
                      : `${m.name} loses access to Orbit Ads immediately. Campaigns and creatives they own stay in place.`,
                    confirmLabel: invited ? "Cancel invite" : "Remove member",
                    cancelLabel: invited ? "Keep invite" : undefined,
                    destructive: true,
                  },
                },
              ],
            ]}
          />
        )
      }),
    ]
  }, [canManage, myRole, remove])

  return (
    <div className="flex flex-col gap-6">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Team members</CardTitle>
          <CardDescription>{rows.filter((m) => m.status === "active").length} active · {rows.filter((m) => m.status === "invited").length} invited</CardDescription>
        </CardHeader>
        <CardContent>
          <ScreenState query={q} loading={<Skeleton className="h-72" />}>
            <DataTable
              columns={columns}
              data={rows}
              searchPlaceholder="Search name or email…"
              searchText={(m) => `${m.name} ${m.email} ${m.roleLabel}`}
              filters={[{ columnId: "role", title: "Role", options: ROLES.map((r) => ({ label: ROLE_LABEL[r], value: ROLE_LABEL[r] })) }]}
              toolbar={canManage ? <Button size="sm" onClick={() => setInviteOpen(true)}><UserPlus /> Invite</Button> : undefined}
            />
          </ScreenState>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Role permissions</CardTitle>
          <CardDescription>What each role can do. Every role can view everything; roles apply across all apps and websites.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">Permission</th>
                  {ROLES.map((r) => <th key={r} scope="col" className="px-2 py-2 text-center font-medium whitespace-nowrap">{ROLE_LABEL[r]}</th>)}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_TABLE.map((p) => (
                  <tr key={p.permission} className="border-t">
                    <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal whitespace-nowrap">{p.label}</th>
                    {ROLES.map((r) => {
                      const v = p.roles.includes(r)
                      return (
                        <td key={r} className="relative px-2 py-2 text-center">
                          {v ? <Check className="mx-auto size-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> : <span className="text-muted-foreground/60" aria-hidden>–</span>}
                          <span className="sr-only">{v ? "Allowed" : "Not allowed"}</span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {inviteOpen && myRole && <InviteDialog myRole={myRole} team={rows} onClose={() => setInviteOpen(false)} />}
      {roleFor && myRole && <RoleDialog key={roleFor.id} member={roleFor} myRole={myRole} onClose={() => setRoleFor(null)} />}
    </div>
  )
}

function InviteDialog({ myRole, team, onClose }: { myRole: Role; team: Row[]; onClose: () => void }) {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [role, setRole] = useState<Role>("campaign_manager")
  const [showErr, setShowErr] = useState(false)
  const invite = useApiMutation("inviteMember", {
    onSuccess: (u) => { toast.success(`Invite sent to ${u.email}`); onClose() },
    onError: (e) => toastError(e, "Couldn’t send the invite"),
  })
  const assignable = ROLES.filter((r) => canAssignRole(myRole, r))
  const e = email.trim().toLowerCase()
  const err = !EMAIL_RE.test(e) ? "Enter a valid work email, like name@example.com." : team.some((m) => m.email.toLowerCase() === e) ? "This person is already a member or has a pending invite." : ""
  const send = () => {
    if (err) { setShowErr(true); return }
    invite.mutate({ body: { email: e, role, ...(name.trim() ? { name: name.trim() } : {}) } })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !invite.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>They get an email with a link to join this workspace.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={(ev) => { ev.preventDefault(); send() }}>
          <FieldGroup>
            <Field data-invalid={showErr && !!err}>
              <FieldLabel htmlFor="inv-email">Email</FieldLabel>
              <Input id="inv-email" type="email" autoFocus value={email} onChange={(ev) => setEmail(ev.target.value)} placeholder="name@example.com" aria-invalid={showErr && !!err} />
              {showErr && err && <FieldError>{err}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="inv-name">Name (optional)</FieldLabel>
              <Input id="inv-name" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="Shown until they sign in" />
            </Field>
            <Field>
              <FieldLabel htmlFor="inv-role">Role</FieldLabel>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id="inv-role" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{assignable.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
              </Select>
              <FieldDescription>{ROLE_DESC[role]}</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={invite.isPending}>Cancel</Button>
            <Button type="submit" disabled={invite.isPending}>{invite.isPending ? "Sending…" : "Send invite"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RoleDialog({ member, myRole, onClose }: { member: Row; myRole: Role; onClose: () => void }) {
  const [role, setRole] = useState<Role>(member.role)
  const qc = useQueryClient()
  const change = useApiMutation("changeRole", {
    onSuccess: (u) => { toast.success(`${u.name || u.email} is now ${ROLE_LABEL[u.role]}`); onClose() },
    onError: (e) => {
      toastError(e, "Couldn’t change the role")
      if (e instanceof ApiError && e.status === 409) { void qc.invalidateQueries({ queryKey: ["team"] }); onClose() }
    },
  })
  const assignable = ROLES.filter((r) => canAssignRole(myRole, r))
  const save = () => {
    if (role === member.role) return onClose()
    change.mutate({ params: { id: member.id }, body: { role, rev: member.rev } })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !change.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change role</DialogTitle>
          <DialogDescription>{member.name || member.email} · currently {ROLE_LABEL[member.role]}</DialogDescription>
        </DialogHeader>
        <RadioGroup value={role} onValueChange={(v) => setRole(v as Role)} className="gap-2">
          {assignable.map((r) => (
            <Label key={r} htmlFor={`role-${r}`} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal hover:bg-muted/50", role === r && "border-primary/40 bg-primary/5")}>
              <RadioGroupItem id={`role-${r}`} value={r} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{ROLE_LABEL[r]}</span>
                <span className="block text-xs text-muted-foreground">{ROLE_DESC[r]}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={change.isPending}>Cancel</Button>
          <Button onClick={save} disabled={role === member.role || change.isPending}>{change.isPending ? "Saving…" : "Save role"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
