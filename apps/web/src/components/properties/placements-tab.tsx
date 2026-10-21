"use client"

import { FORMAT_LABEL, sizeLabel, type Placement, type Property } from "@orbit/domain"
import type { ColumnDef } from "@tanstack/react-table"
import { LayoutTemplate, Plus } from "lucide-react"
import { useMemo } from "react"
import { DataTable, SortHeader } from "@/components/data-table"
import { GuardedLink, useGuardedRouter } from "@/components/nav-guard"
import { PlacementRowActions } from "@/components/placements/placement-row-actions"
import { freqLabel, refreshLabel } from "@/components/placements/placement-utils"
import { actionsColumn } from "@/components/row-actions"
import { ScreenState } from "@/components/screen-state"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { useCan, usePlacements } from "@/lib/hooks"

const dash = (v: string | null | undefined) => (v ? v : <span className="text-muted-foreground">—</span>)

export function PlacementsTab({ p, onAdd }: { p: Property; onAdd: () => void }) {
  const q = usePlacements(p.id)
  const canWrite = useCan("properties.write")
  const router = useGuardedRouter()
  const pls = q.data ?? []
  const isApp = p.platform !== "web"

  const columns = useMemo<ColumnDef<Placement, unknown>[]>(() => {
    const cols: ColumnDef<Placement, unknown>[] = [
      {
        accessorKey: "name",
        header: ({ column }) => <SortHeader column={column} title="Placement" />,
        meta: { label: "Placement", primary: true },
        enableHiding: false,
        cell: ({ row }) => (
          <div className="min-w-0">
            <GuardedLink href={`/placements/${row.original.id}`} className="block truncate font-medium hover:underline">{row.original.name}</GuardedLink>
            <div className="truncate font-mono text-xs text-muted-foreground">{row.original.id}</div>
          </div>
        ),
      },
      { accessorKey: "format", header: ({ column }) => <SortHeader column={column} title="Format" />, meta: { label: "Format" }, cell: ({ row }) => FORMAT_LABEL[row.original.format] },
      { accessorKey: "size", header: "Size", meta: { label: "Size" }, cell: ({ row }) => <span className="font-mono text-xs">{sizeLabel(row.original.size)}</span> },
      { id: "freq", header: "Frequency cap", meta: { label: "Frequency cap" }, cell: ({ row }) => dash(freqLabel(row.original)) },
      { id: "refresh", header: "Refresh", meta: { label: "Refresh" }, cell: ({ row }) => dash(refreshLabel(row.original)) },
    ]
    if (isApp) cols.push({ accessorKey: "minAppVersion", header: "Min version", meta: { label: "Min version" }, cell: ({ row }) => <span className="font-mono text-xs">{dash(row.original.minAppVersion)}</span> })
    cols.push({ accessorKey: "status", header: ({ column }) => <SortHeader column={column} title="Status" />, meta: { label: "Status" }, cell: ({ row }) => <StatusBadge status={row.original.status} /> })
    cols.push(actionsColumn((r) => <PlacementRowActions pl={r} showProperty={false} />))
    return cols
  }, [isApp])

  return (
    <ScreenState
      query={q}
      isEmpty={pls.length === 0}
      empty={{
        icon: <LayoutTemplate />,
        title: "No placements yet",
        description: `A placement is a named slot in ${p.name} where the ${isApp ? "SDK" : "web tag"} asks for an ad. Create one to start serving campaigns here.`,
        action: canWrite ? <Button onClick={onAdd}><Plus /> Create placement</Button> : undefined,
      }}
    >
      <DataTable
        columns={columns}
        data={pls}
        searchPlaceholder="Search placements…"
        searchText={(r) => `${r.name} ${r.id} ${FORMAT_LABEL[r.format]}`}
        onRowClick={(r) => router.push(`/placements/${r.id}`)}
        toolbar={canWrite ? <Button size="sm" variant="outline" onClick={onAdd}><Plus /> Add placement</Button> : undefined}
      />
    </ScreenState>
  )
}
