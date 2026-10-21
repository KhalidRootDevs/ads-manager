"use client"

import { PLATFORM_LABEL, PLATFORMS, PROPERTY_ENV_LABEL, PROPERTY_STATUS_LABEL, PROPERTY_STATUSES, SDK_STATE_LABEL, SDK_STATES, type Property } from "@orbit/domain"
import type { ColumnDef } from "@tanstack/react-table"
import { AppWindow, Plus } from "lucide-react"
import { useMemo } from "react"
import { DataTable, facetFilterFn, SortHeader, type FacetFilter } from "@/components/data-table"
import { GuardedLink, useGuardedRouter } from "@/components/nav-guard"
import { PageContainer, PageHeader } from "@/components/page-header"
import { useDelivery } from "@/components/placements/placement-utils"
import { PropertyRowActions } from "@/components/properties/property-row-actions"
import { actionsColumn } from "@/components/row-actions"
import { ScreenState } from "@/components/screen-state"
import { PlatformBadge, StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { fmt } from "@/lib/format"
import { useCan, usePlacements, useProperties } from "@/lib/hooks"
import { cn } from "@/lib/utils"

interface Row {
  p: Property
  id: string
  name: string
  identifier: string
  platform: Property["platform"]
  env: Property["env"]
  team: string
  status: Property["status"]
  sdk: Property["sdk"]["state"]
  hb: string | null
  placements: number
  /** null while analytics load */
  req7: number | null
}

const columns: ColumnDef<Row, unknown>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortHeader column={column} title="Property" />,
    meta: { label: "Property", primary: true },
    enableHiding: false,
    cell: ({ row }) => (
      <div className="min-w-0 max-w-72">
        <GuardedLink href={`/properties/${row.original.id}`} className="block truncate font-medium hover:underline">{row.original.name}</GuardedLink>
        <div className="truncate font-mono text-xs text-muted-foreground">{row.original.identifier}</div>
        <div className="mt-1.5 flex items-center gap-1.5 md:hidden">
          <PlatformBadge type={row.original.platform} />
          <span className={cn("text-xs", row.original.env === "staging" ? "text-muted-foreground" : "text-foreground/80")}>{PROPERTY_ENV_LABEL[row.original.env]}</span>
        </div>
      </div>
    ),
  },
  {
    accessorKey: "platform",
    header: ({ column }) => <SortHeader column={column} title="Type" />,
    meta: { label: "Type", hideOnMobile: true },
    filterFn: facetFilterFn,
    cell: ({ row }) => <PlatformBadge type={row.original.platform} />,
  },
  {
    accessorKey: "env",
    header: ({ column }) => <SortHeader column={column} title="Environment" />,
    meta: { label: "Environment", hideOnMobile: true },
    cell: ({ row }) => <span className={cn(row.original.env === "staging" && "text-muted-foreground")}>{PROPERTY_ENV_LABEL[row.original.env]}</span>,
  },
  {
    accessorKey: "team",
    header: ({ column }) => <SortHeader column={column} title="Team" />,
    meta: { label: "Team" },
    filterFn: facetFilterFn,
  },
  {
    accessorKey: "status",
    header: ({ column }) => <SortHeader column={column} title="Status" />,
    meta: { label: "Status" },
    filterFn: facetFilterFn,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "sdk",
    header: ({ column }) => <SortHeader column={column} title="SDK / integration" />,
    meta: { label: "SDK / integration" },
    filterFn: facetFilterFn,
    cell: ({ row }) => (
      <div className="flex flex-col gap-1">
        <StatusBadge status={row.original.sdk} />
        <span className="text-xs text-muted-foreground">Heartbeat {fmt.ago(row.original.hb).toLowerCase()}</span>
      </div>
    ),
  },
  {
    accessorKey: "placements",
    header: ({ column }) => <SortHeader column={column} title="Placements" align="right" />,
    meta: { label: "Placements", align: "right" },
    cell: ({ row }) => <span className="font-mono">{row.original.placements}</span>,
  },
  {
    accessorKey: "req7",
    header: ({ column }) => <SortHeader column={column} title="Requests 7d" align="right" />,
    meta: { label: "Requests 7d", align: "right" },
    cell: ({ row }) => <span className="font-mono">{row.original.req7 ? fmt.compact(row.original.req7) : "—"}</span>,
  },
  actionsColumn((r) => <PropertyRowActions p={r.p} />),
]

const opts = <T extends string>(xs: readonly T[], label: Record<T, string>) => xs.map((x) => ({ label: label[x], value: x }))

export default function PropertiesPage() {
  const propsQ = useProperties()
  const plQ = usePlacements()
  const supply = useDelivery({}, 7, "property")
  const canWrite = useCan("properties.write")
  const router = useGuardedRouter()
  const props = useMemo(() => propsQ.data ?? [], [propsQ.data])

  const rows = useMemo<Row[]>(() => {
    const plc: Record<string, number> = {}
    ;(plQ.data ?? []).forEach((x) => { plc[x.propertyId] = (plc[x.propertyId] ?? 0) + 1 })
    const req: Record<string, number> = Object.fromEntries((supply.data?.rows ?? []).map((r) => [r.key, r.req ?? 0]))
    return props.map((p) => ({
      p, id: p.id, name: p.name, identifier: p.identifier, platform: p.platform, env: p.env, team: p.team, status: p.status, sdk: p.sdk.state, hb: p.sdk.lastHeartbeatAt,
      placements: plc[p.id] ?? 0, req7: supply.data ? (req[p.id] ?? 0) : null,
    }))
  }, [props, plQ.data, supply.data])

  const apps = props.filter((p) => p.platform !== "web").length
  const sites = props.length - apps
  const cnt = (s: Property["sdk"]["state"]) => props.filter((p) => p.sdk.state === s).length
  const stats: { k: string; v: number; tone?: string }[] = [
    { k: "Mobile apps", v: apps },
    { k: "Websites", v: sites },
    { k: "SDK healthy", v: cnt("healthy"), tone: "text-emerald-600 dark:text-emerald-400" },
    { k: "Degraded", v: cnt("degraded"), tone: cnt("degraded") ? "text-amber-600 dark:text-amber-400" : undefined },
    { k: "Heartbeat missing", v: cnt("heartbeat_missing"), tone: cnt("heartbeat_missing") ? "text-red-600 dark:text-red-400" : undefined },
    { k: "Not integrated", v: cnt("not_integrated") },
  ]

  const teams = [...new Set(props.map((p) => p.team))].sort()
  const filters: FacetFilter[] = [
    { columnId: "platform", title: "Platform", options: opts(PLATFORMS, PLATFORM_LABEL) },
    { columnId: "status", title: "Status", options: opts(PROPERTY_STATUSES, PROPERTY_STATUS_LABEL) },
    { columnId: "team", title: "Team", options: teams.map((t) => ({ label: t, value: t })) },
    { columnId: "sdk", title: "SDK state", options: opts(SDK_STATES, SDK_STATE_LABEL) },
  ]

  const add = canWrite ? (
    <Button asChild>
      <GuardedLink href="/properties/new"><Plus /> Add property</GuardedLink>
    </Button>
  ) : undefined

  return (
    <PageContainer>
      <PageHeader
        title="Apps & websites"
        description={propsQ.data ? `${apps} mobile apps · ${sites} websites · all owned and operated by your company` : "All apps and websites owned and operated by your company"}
        actions={add}
      />
      <ScreenState
        query={[propsQ, plQ]}
        isEmpty={props.length === 0}
        empty={{
          icon: <AppWindow />,
          title: "No apps or websites yet",
          description: "Register an Android or iOS app, or a website, to start creating placements and serving your own campaigns.",
          action: add,
        }}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {stats.map((s) => (
            <Card key={s.k} className="gap-0 py-0">
              <CardContent className="p-4">
                <div className="truncate text-sm text-muted-foreground">{s.k}</div>
                <div className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums", s.tone)}>{s.v}</div>
              </CardContent>
            </Card>
          ))}
        </div>
        <DataTable
          columns={columns}
          data={rows}
          pageSize={10}
          filters={filters}
          searchPlaceholder="Search name, bundle ID or domain…"
          searchText={(r) => `${r.name} ${r.identifier} ${r.team} ${r.id}`}
          onRowClick={(r) => router.push(`/properties/${r.id}`)}
          emptyMessage="No properties match these filters."
        />
      </ScreenState>
    </PageContainer>
  )
}
