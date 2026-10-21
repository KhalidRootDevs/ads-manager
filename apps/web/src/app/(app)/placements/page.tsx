"use client"

import { AD_FORMATS, FORMAT_LABEL, LIVE_CAMPAIGN_STATUSES, PLACEMENT_STATUS_LABEL, PLACEMENT_STATUSES, sizeLabel, type Placement, type Platform } from "@orbit/domain"
import type { ColumnDef } from "@tanstack/react-table"
import { LayoutPanelTop, Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { DataTable, facetFilterFn, SortHeader } from "@/components/data-table"
import { PlacementDialog } from "@/components/domain/placement-dialog"
import { GuardedLink } from "@/components/nav-guard"
import { PageContainer, PageHeader } from "@/components/page-header"
import { PlacementRowActions } from "@/components/placements/placement-row-actions"
import { eligibleCampaigns, freqLabel, refreshLabel, useAllCampaigns } from "@/components/placements/placement-utils"
import { actionsColumn } from "@/components/row-actions"
import { ScreenState } from "@/components/screen-state"
import { PlatformBadge, StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { useCan, usePlacements, useProperties } from "@/lib/hooks"

interface Row extends Placement {
  propName: string
  platform: Platform | ""
  freq: string
  refresh: string
  /** null while campaigns load */
  eligible: number | null
}

const dash = (v: string | null | undefined) => (v ? v : <span className="text-muted-foreground">—</span>)

export default function PlacementsPage() {
  const router = useRouter()
  const plQ = usePlacements()
  const propsQ = useProperties()
  const campsQ = useAllCampaigns(LIVE_CAMPAIGN_STATUSES)
  const canWrite = useCan("properties.write")
  const [open, setOpen] = useState(false)
  const placements = useMemo(() => plQ.data ?? [], [plQ.data])
  const props = useMemo(() => propsQ.data ?? [], [propsQ.data])

  const rows: Row[] = useMemo(() => {
    const propById = Object.fromEntries(props.map((p) => [p.id, p]))
    return placements.map((p) => ({
      ...p, propName: propById[p.propertyId]?.name ?? p.propertyId, platform: propById[p.propertyId]?.platform ?? "", freq: freqLabel(p), refresh: refreshLabel(p),
      eligible: campsQ.data ? eligibleCampaigns(p.id, campsQ.data).length : null,
    }))
  }, [placements, props, campsQ.data])
  const propCount = new Set(placements.map((p) => p.propertyId)).size

  const columns: ColumnDef<Row, unknown>[] = useMemo(
    () => [
      {
        id: "name",
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
      {
        id: "property",
        accessorKey: "propertyId",
        header: ({ column }) => <SortHeader column={column} title="Property" />,
        sortingFn: (a, b) => a.original.propName.localeCompare(b.original.propName),
        filterFn: facetFilterFn,
        meta: { label: "Property" },
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <GuardedLink href={`/properties/${row.original.propertyId}`} className="min-w-0 break-words hover:underline">{row.original.propName}</GuardedLink>
            {row.original.platform && <PlatformBadge type={row.original.platform} />}
          </div>
        ),
      },
      { accessorKey: "format", header: ({ column }) => <SortHeader column={column} title="Format" />, filterFn: facetFilterFn, meta: { label: "Format" }, cell: ({ row }) => FORMAT_LABEL[row.original.format] },
      { accessorKey: "size", header: "Size", meta: { label: "Size" }, cell: ({ row }) => <span className="font-mono text-xs whitespace-nowrap">{sizeLabel(row.original.size)}</span> },
      { accessorKey: "minAppVersion", header: "Min version", meta: { label: "Min version", hideOnMobile: true }, cell: ({ row }) => <span className="font-mono text-xs">{dash(row.original.minAppVersion)}</span> },
      { accessorKey: "freq", header: "Frequency cap", meta: { label: "Frequency cap", hideOnMobile: true }, cell: ({ row }) => <span className="whitespace-nowrap">{dash(row.original.freq)}</span> },
      { accessorKey: "refresh", header: "Refresh", meta: { label: "Refresh", hideOnMobile: true }, cell: ({ row }) => dash(row.original.refresh) },
      { accessorKey: "status", header: ({ column }) => <SortHeader column={column} title="Status" />, filterFn: facetFilterFn, meta: { label: "Status" }, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        accessorKey: "eligible",
        header: ({ column }) => <SortHeader column={column} title="Eligible campaigns" align="right" />,
        meta: { label: "Eligible campaigns", align: "right" },
        cell: ({ row }) => {
          const n = row.original.eligible
          return <span className={n ? "font-medium tabular-nums" : "text-muted-foreground tabular-nums"}>{n ?? "…"}</span>
        },
      },
      actionsColumn<Row>((r) => <PlacementRowActions pl={r} />),
    ],
    [],
  )

  const propOptions = useMemo(
    () => props.filter((p) => placements.some((x) => x.propertyId === p.id)).map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [props, placements],
  )

  const addButton = canWrite ? <Button onClick={() => setOpen(true)}><Plus /> New placement</Button> : undefined

  return (
    <PageContainer>
      <PageHeader
        title="Placements"
        description={plQ.data ? `${placements.length} placements across ${propCount} properties · named slots where the SDK or web tag asks for an ad` : "Named slots where the SDK or web tag asks for an ad"}
        actions={addButton}
      />
      <ScreenState
        query={[plQ, propsQ]}
        isEmpty={placements.length === 0}
        empty={{
          icon: <LayoutPanelTop />,
          title: "No placements yet",
          description: "Create a placement for each slot in an app or page — for example Home Banner or Match Detail Interstitial — so campaigns can target it.",
          action: addButton,
        }}
      >
        <DataTable
          columns={columns}
          data={rows}
          searchPlaceholder="Search placements…"
          searchText={(r) => `${r.name} ${r.id} ${r.propName} ${FORMAT_LABEL[r.format]}`}
          filters={[
            { columnId: "property", title: "Property", options: propOptions },
            { columnId: "format", title: "Format", options: AD_FORMATS.filter((f) => placements.some((p) => p.format === f)).map((f) => ({ value: f, label: FORMAT_LABEL[f] })) },
            { columnId: "status", title: "Status", options: PLACEMENT_STATUSES.map((s) => ({ value: s, label: PLACEMENT_STATUS_LABEL[s] })) },
          ]}
          onRowClick={(r) => router.push(`/placements/${r.id}`)}
          initialSorting={[{ id: "property", desc: false }]}
          emptyMessage="No placements match your filters."
          pageSize={15}
        />
      </ScreenState>
      <PlacementDialog open={open} onOpenChange={setOpen} onSaved={(p) => router.push(`/placements/${p.id}`)} />
    </PageContainer>
  )
}
