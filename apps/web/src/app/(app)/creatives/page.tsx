"use client"

import { AD_FORMATS, CREATIVE_STATUS_LABEL, destinationType, FORMAT_LABEL, sizeLabel, type Creative, type CreativeStatus } from "@orbit/domain"
import type { ColumnDef } from "@tanstack/react-table"
import { ImagePlus, LayoutGrid, List, Plus, Search, SearchX, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { FilterButton } from "@/components/creatives/creative-bits"
import { CreativeRowActions } from "@/components/creatives/creative-row-actions"
import { DataTable, SortHeader } from "@/components/data-table"
import { CreativeThumb } from "@/components/domain/ad-preview"
import { GuardedLink } from "@/components/nav-guard"
import { PageContainer, PageHeader } from "@/components/page-header"
import { actionsColumn } from "@/components/row-actions"
import { useAllCampaigns } from "@/components/placements/placement-utils"
import { ScreenState } from "@/components/screen-state"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmt } from "@/lib/format"
import { useCan, useCreatives, useUserName } from "@/lib/hooks"

const STATUSES: CreativeStatus[] = ["draft", "ready", "in_review", "rejected", "archived"]
type Dest = ReturnType<typeof destinationType>
const DESTS: { value: Dest; label: string }[] = [
  { value: "deep_link", label: "App deep link" },
  { value: "web_url", label: "Web URL" },
  { value: "missing", label: "Missing" },
]
const DEST_LABEL: Record<Dest, string> = { deep_link: "Deep link", web_url: "Web URL", missing: "Missing" }
const UPDATED = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
]
const DAY = 86_400_000

interface Row extends Creative {
  /** null while campaigns load */
  uses: number | null
  dest: Dest
  owner: string
  ageDays: number
}

const usedLabel = (n: number | null) => (n == null ? "…" : n === 0 ? "Not used yet" : `Used in ${n} campaign${n === 1 ? "" : "s"}`)

export default function CreativesPage() {
  const router = useRouter()
  const q = useCreatives({ includeArchived: true })
  const campsQ = useAllCampaigns()
  const canWrite = useCan("creatives.write")
  const userName = useUserName()
  const [view, setView] = useState<"grid" | "table">("grid")
  const [search, setSearch] = useState("")
  const [format, setFormat] = useState<string[]>([])
  const [status, setStatus] = useState<string[]>([])
  const [owner, setOwner] = useState<string[]>([])
  const [dest, setDest] = useState<string[]>([])
  const [updated, setUpdated] = useState<string[]>([])
  // "Updated within N days" is relative to when the page opened.
  const [now] = useState(() => Date.now())

  const rows: Row[] = useMemo(() => {
    const uses: Record<string, number> = {}
    for (const c of campsQ.data ?? []) for (const id of new Set(c.creativeIds)) uses[id] = (uses[id] ?? 0) + 1
    return (q.data ?? []).map((c) => ({
      ...c, uses: campsQ.data ? (uses[c.id] ?? 0) : null, dest: destinationType(c.destination), owner: userName(c.ownerId),
      ageDays: Math.floor((now - new Date(c.updatedAt).getTime()) / DAY),
    }))
  }, [q.data, campsQ.data, userName, now])
  const owners = useMemo(() => [...new Map(rows.filter((c) => c.ownerId).map((c) => [c.ownerId!, c.owner])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows])

  const filtered = useMemo(() => {
    const ql = search.trim().toLowerCase()
    const maxAge = updated.length ? Number(updated[0]) : Infinity
    return rows
      .filter(
        (c) =>
          (status.length ? status.includes(c.status) : c.status !== "archived") &&
          (!format.length || format.includes(c.format)) &&
          (!owner.length || owner.includes(c.ownerId ?? "")) &&
          (!dest.length || dest.includes(c.dest)) &&
          c.ageDays <= maxAge &&
          (!ql || [c.name, c.copy.headline, c.id, ...c.assets.map((a) => a.name)].some((x) => x.toLowerCase().includes(ql))),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [rows, search, status, format, owner, dest, updated])

  const live = rows.filter((c) => c.status !== "archived")
  const count = (s: CreativeStatus) => rows.filter((c) => c.status === s).length
  const countBy = (pred: (c: Row) => boolean) => live.filter(pred).length
  const anyFilter = !!(search || format.length || status.length || owner.length || dest.length || updated.length)
  const clear = () => { setSearch(""); setFormat([]); setStatus([]); setOwner([]); setDest([]); setUpdated([]) }

  const columns: ColumnDef<Row, unknown>[] = useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <SortHeader column={column} title="Creative" />,
        meta: { label: "Creative", primary: true },
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-10 w-14 shrink-0 overflow-hidden rounded-md" style={{ backgroundColor: row.original.options.brandColor }} aria-hidden />
            <div className="min-w-0">
              <GuardedLink href={`/creatives/${row.original.id}`} className="block truncate font-medium hover:underline">{row.original.name}</GuardedLink>
              <div className="truncate text-xs text-muted-foreground">{row.original.copy.headline}</div>
            </div>
          </div>
        ),
      },
      { accessorKey: "format", header: ({ column }) => <SortHeader column={column} title="Format" />, meta: { label: "Format" }, cell: ({ row }) => FORMAT_LABEL[row.original.format] },
      { accessorKey: "size", header: "Size", meta: { label: "Size" }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.size ? sizeLabel(row.original.size) : "—"}</span> },
      { accessorKey: "status", header: ({ column }) => <SortHeader column={column} title="Status" />, meta: { label: "Status" }, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        accessorKey: "dest",
        header: "Destination",
        meta: { label: "Destination" },
        cell: ({ row }) => <span className={row.original.dest === "missing" ? "text-amber-700 dark:text-amber-400" : undefined}>{DEST_LABEL[row.original.dest]}</span>,
      },
      { accessorKey: "uses", header: ({ column }) => <SortHeader column={column} title="Used in" align="right" />, meta: { label: "Used in", align: "right" }, cell: ({ row }) => <span className="tabular-nums">{row.original.uses ?? "…"}</span> },
      { accessorKey: "owner", header: "Owner", meta: { label: "Owner", hideOnMobile: true } },
      { accessorKey: "updatedAt", header: ({ column }) => <SortHeader column={column} title="Updated" />, meta: { label: "Updated" }, cell: ({ row }) => <span className="whitespace-nowrap">{fmt.date(row.original.updatedAt)}</span> },
      actionsColumn<Row>((r) => <CreativeRowActions c={r} uses={r.uses} />),
    ],
    [],
  )

  const newButton = canWrite ? <Button onClick={() => router.push("/creatives/new")}><Plus /> New creative</Button> : undefined

  return (
    <PageContainer>
      <PageHeader
        title="Ad creatives"
        description={q.data ? `${live.length} reusable creatives · ${count("ready")} ready · ${count("in_review")} in review · ${count("rejected")} rejected` : "Reusable ads for every campaign"}
        actions={newButton}
      />
      <ScreenState
        query={q}
        isEmpty={rows.length === 0}
        empty={{
          icon: <ImagePlus />,
          title: "No creatives yet",
          description: "Creatives are reusable ads — upload once, then attach them to any campaign whose placements match the format and size.",
          action: newButton,
        }}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search creatives…" aria-label="Search creatives" className="pl-8" />
            </div>
            <FilterButton title="Format" value={format} onChange={setFormat} options={AD_FORMATS.map((f) => ({ value: f, label: FORMAT_LABEL[f], count: countBy((c) => c.format === f) }))} />
            <FilterButton title="Status" value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: CREATIVE_STATUS_LABEL[s], count: count(s) }))} />
            <FilterButton title="Owner" value={owner} onChange={setOwner} options={owners.map(([id, name]) => ({ value: id, label: name, count: countBy((c) => c.ownerId === id) }))} />
            <FilterButton title="Destination" value={dest} onChange={setDest} options={DESTS.map((d) => ({ ...d, count: countBy((c) => c.dest === d.value) }))} />
            <FilterButton title="Updated" single value={updated} onChange={setUpdated} options={UPDATED.map((u) => ({ ...u, count: countBy((c) => c.ageDays <= Number(u.value)) }))} />
            {anyFilter && <Button variant="ghost" size="sm" onClick={clear}>Reset <X /></Button>}
            <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={view} onValueChange={(v) => v && setView(v as "grid" | "table")} className="ml-auto" aria-label="View">
              <ToggleGroupItem value="grid" aria-label="Grid view"><LayoutGrid /> <span className="hidden sm:inline">Grid</span></ToggleGroupItem>
              <ToggleGroupItem value="table" aria-label="Table view"><List /> <span className="hidden sm:inline">Table</span></ToggleGroupItem>
            </ToggleGroup>
          </div>

          {!status.length && count("archived") > 0 && (
            <p className="-mt-1 text-xs text-muted-foreground">
              {count("archived")} archived creative{count("archived") === 1 ? " is" : "s are"} hidden.{" "}
              <button type="button" className="font-medium text-foreground underline-offset-4 hover:underline" onClick={() => setStatus(["archived"])}>Show archived</button>
            </p>
          )}

          {filtered.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon"><SearchX /></EmptyMedia>
                <EmptyTitle>No creatives match</EmptyTitle>
                <EmptyDescription>Try a different search or remove some filters.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent><Button variant="outline" onClick={clear}>Clear filters</Button></EmptyContent>
            </Empty>
          ) : view === "grid" ? (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {filtered.map((c) => (
                <li key={c.id}>
                  <Card className="group relative h-full gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md">
                    <CreativeThumb c={c} className="h-36 rounded-none" />
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <GuardedLink href={`/creatives/${c.id}`} className="min-w-0 font-medium leading-snug after:absolute after:inset-0 hover:underline">
                          <span className="line-clamp-2">{c.name}</span>
                        </GuardedLink>
                        <StatusBadge status={c.status} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {FORMAT_LABEL[c.format]}{c.size && <> · <span className="font-mono">{sizeLabel(c.size)}</span></>}
                      </div>
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                        <span className={c.uses ? "font-medium text-foreground" : undefined}>{usedLabel(c.uses)}</span>
                        <span>{fmt.date(c.updatedAt, true)} · {c.owner}</span>
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            // The page owns search and filters (shared with grid view), so DataTable's own toolbar row is hidden.
            <DataTable
              columns={columns}
              data={filtered}
              onRowClick={(r) => router.push(`/creatives/${r.id}`)}
              className="[&>div:first-child]:hidden"
              emptyMessage="No creatives match."
            />
          )}
        </div>
      </ScreenState>
    </PageContainer>
  )
}
