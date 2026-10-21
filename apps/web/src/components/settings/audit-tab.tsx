"use client"

import { apiKey, useApi } from "@orbit/api-client/react"
import type { AuditEntry } from "@orbit/domain"
import { useInfiniteQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Download, RotateCcw } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { DataTable } from "@/components/data-table"
import { GuardedLink } from "@/components/nav-guard"
import { ScreenState } from "@/components/screen-state"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { fmt } from "@/lib/format"
import { useCan, useTeam } from "@/lib/hooks"
import { actionLabel, actionTone, AUDIT_ACTIONS, auditHref } from "./audit-utils"

const PAGE = 50

const columns: ColumnDef<AuditEntry, unknown>[] = [
  { accessorKey: "at", header: "Time", meta: { label: "Time" }, cell: ({ row }) => <time dateTime={row.original.at} className="font-mono text-xs whitespace-nowrap">{fmt.dateTime(row.original.at)}</time> },
  { id: "actor", accessorFn: (r) => r.actor.name, header: "Actor", meta: { label: "Actor" } },
  { accessorKey: "action", header: "Action", meta: { label: "Action", primary: true }, cell: ({ row }) => <StatusBadge status={actionLabel(row.original.action)} tone={actionTone(row.original.action)} dot={false} /> },
  {
    id: "target",
    accessorFn: (r) => r.target.name,
    header: "Target",
    meta: { label: "Target" },
    cell: ({ row }) => {
      const t = row.original.target
      const href = auditHref(t)
      const cls = "block font-medium break-words whitespace-normal md:max-w-64 md:truncate"
      return href ? <GuardedLink href={href} className={`${cls} hover:text-primary hover:underline`} title={t.name}>{t.name}</GuardedLink> : <span className={cls} title={t.name}>{t.name}</span>
    },
  },
  { accessorKey: "detail", header: "Detail", meta: { label: "Detail" }, cell: ({ row }) => <span className="block break-words whitespace-normal text-muted-foreground md:max-w-80 md:truncate" title={row.original.detail}>{row.original.detail || "—"}</span> },
]

const csvCell = (v: string) => {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v // spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportCsv(rows: AuditEntry[]) {
  const csv = [["Time", "Actor", "Action", "Target type", "Target", "Detail"], ...rows.map((x) => [x.at, x.actor.name, x.action, x.target.type, x.target.name, x.detail])]
    .map((r) => r.map(csvCell).join(","))
    .join("\n")
  const filename = `orbit-audit-log-${new Date().toISOString().slice(0, 10)}.csv`
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`Downloaded ${filename}`, { description: `${rows.length} audit ${rows.length === 1 ? "entry" : "entries"} (loaded rows, current filters)` })
  } catch {
    toast.error("Your browser blocked the download.")
  }
}

interface Filter { action: string; actorId: string; from: string; to: string }
const NONE: Filter = { action: "all", actorId: "all", from: "", to: "" }

export function AuditTab() {
  const api = useApi()
  const team = useTeam()
  const canExport = useCan("reports.export")
  const [f, setF] = useState<Filter>(NONE)
  const set = (patch: Partial<Filter>) => setF((x) => ({ ...x, ...patch }))
  const rangeErr = f.from && f.to && f.from > f.to ? "“From” must be on or before “To”." : ""

  // Server-side filters (exact action, actor, date range) with cursor pages; the search box filters loaded rows.
  const query = useMemo(() => ({
    limit: PAGE,
    ...(f.action !== "all" ? { action: f.action } : {}),
    ...(f.actorId !== "all" ? { actorId: f.actorId } : {}),
    ...(f.from && !rangeErr ? { from: f.from } : {}),
    ...(f.to && !rangeErr ? { to: f.to } : {}),
  }), [f, rangeErr])
  const q = useInfiniteQuery({
    queryKey: [...apiKey("listAudit", { query }), "pages"],
    queryFn: ({ pageParam, signal }) => api.call("listAudit", { query: { ...query, ...(pageParam ? { cursor: pageParam } : {}) }, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data])
  const filtered = JSON.stringify(f) !== JSON.stringify(NONE)
  const people = useMemo(() => [...(team.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [team.data])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Every publish, pause, targeting edit, credential change and role change, newest first.</p>
      <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="audit-action" className="text-xs font-normal text-muted-foreground">Action</Label>
          <Select value={f.action} onValueChange={(v) => set({ action: v })}>
            <SelectTrigger id="audit-action" size="sm" className="w-full min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
              <SelectItem value="all">All actions</SelectItem>
              {AUDIT_ACTIONS.map((a) => <SelectItem key={a} value={a}>{actionLabel(a)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="audit-actor" className="text-xs font-normal text-muted-foreground">Actor</Label>
          <Select value={f.actorId} onValueChange={(v) => set({ actorId: v })}>
            <SelectTrigger id="audit-actor" size="sm" className="w-full min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
              <SelectItem value="all">Everyone</SelectItem>
              {people.map((u) => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="audit-from" className="text-xs font-normal text-muted-foreground">From</Label>
          <Input id="audit-from" type="date" className="h-8" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} aria-invalid={!!rangeErr || undefined} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="audit-to" className="text-xs font-normal text-muted-foreground">To</Label>
          <Input id="audit-to" type="date" className="h-8" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} aria-invalid={!!rangeErr || undefined} />
        </div>
        <Button variant="ghost" size="sm" className="justify-self-start" disabled={!filtered} onClick={() => setF(NONE)}><RotateCcw /> Reset</Button>
      </div>
      {rangeErr && <p role="alert" className="text-xs text-destructive">{rangeErr}</p>}

      <ScreenState query={q} loading={<Skeleton className="h-96" />}>
        <DataTable
          columns={columns}
          data={rows}
          pageSize={15}
          searchPlaceholder="Search loaded entries…"
          searchText={(x) => `${x.actor.name} ${x.target.name} ${x.detail} ${x.action} ${actionLabel(x.action)}`}
          toolbar={(visible) => canExport ? <Button size="sm" variant="outline" onClick={() => exportCsv(visible)} disabled={!visible.length}><Download /> Export CSV</Button> : null}
          emptyMessage={filtered ? "No audit entries match these filters." : "No audit entries yet."}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{rows.length} {rows.length === 1 ? "entry" : "entries"} loaded{q.hasNextPage ? " · older entries available" : " · end of log"}</span>
          {q.hasNextPage && (
            <Button variant="outline" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage ? "Loading…" : `Load ${PAGE} older`}
            </Button>
          )}
        </div>
      </ScreenState>
    </div>
  )
}
