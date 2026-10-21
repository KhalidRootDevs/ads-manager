"use client"

import { useApiMutation } from "@orbit/api-client/react"
import { finalCountries, SERVABLE_CAMPAIGN_STATUSES, type Country } from "@orbit/domain"
import type { ColumnDef } from "@tanstack/react-table"
import { ChartPie, CircleCheck, CircleOff } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { useAllCampaigns } from "@/components/billing/use-all-campaigns"
import { confirm } from "@/components/confirm-dialog"
import { DataTable, SortHeader } from "@/components/data-table"
import { actionsColumn, RowActions } from "@/components/row-actions"
import { ScreenState } from "@/components/screen-state"
import { StatusBadge } from "@/components/status-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { toastError, useCan, useCountries, useIndex } from "@/lib/hooks"

type Row = Country & { used: number | null }

export function CountriesTab() {
  const q = useCountries()
  const campaigns = useAllCampaigns(SERVABLE_CAMPAIGN_STATUSES)
  const { propById } = useIndex()
  const canEdit = useCan("settings.write")
  const [region, setRegion] = useState("all")
  const patch = useApiMutation("patchCountry", { onError: (e) => toastError(e, "Couldn’t change the country") })
  const countries = useMemo(() => q.data ?? [], [q.data])
  const regions = useMemo(() => [...new Set(countries.map((c) => c.region))].sort(), [countries])

  // Live or scheduled campaigns that would serve in each country, ignoring the platform switch itself
  // (so a disabled country still shows who it affects).
  const usage = useMemo(() => {
    if (!campaigns.data) return null
    const allOn = countries.map((c) => ({ ...c, enabled: true }))
    const out: Record<string, number> = {}
    for (const c of campaigns.data) {
      const codes = new Set<string>()
      for (const t of c.targets) {
        const p = propById[t.propertyId]
        if (p) finalCountries(t.countryRule, p.countryRule, allOn).forEach((x) => codes.add(x))
      }
      codes.forEach((x) => { out[x] = (out[x] ?? 0) + 1 })
    }
    return out
  }, [campaigns.data, countries, propById])

  const rows = useMemo<Row[]>(
    () => countries.filter((c) => region === "all" || c.region === region).map((c) => ({ ...c, used: usage ? (usage[c.code] ?? 0) : null })),
    [countries, region, usage],
  )

  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => {
    const toggle = async (c: Row, on: boolean) => {
      if (!on) {
        const ok = await confirm({
          title: `Disable ${c.name}?`,
          description: c.used
            ? `${c.used} live or scheduled campaign${c.used === 1 ? "" : "s"} serve in ${c.name}. They will stop serving there and show a targeting conflict until it’s re-enabled.`
            : `No live campaigns serve in ${c.name}. It will be unavailable in every property’s country list.`,
          confirmLabel: "Disable country",
          destructive: true,
        })
        if (!ok) return
      }
      patch.mutate({ params: { code: c.code }, body: { enabled: on } }, { onSuccess: () => toast.success(`${c.name} ${on ? "enabled" : "disabled"} platform-wide`) })
    }
    const toggleSwitch = (c: Row) => (
      <Switch checked={c.enabled} disabled={!canEdit || (patch.isPending && patch.variables?.params.code === c.code)} onCheckedChange={(v) => toggle(c, v)} aria-label={`${c.enabled ? "Disable" : "Enable"} ${c.name}`} />
    )
    return [
      { accessorKey: "code", header: ({ column }) => <SortHeader column={column} title="Code" />, meta: { label: "Code", hideOnMobile: true }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span> },
      {
        accessorKey: "name", header: ({ column }) => <SortHeader column={column} title="Country" />, meta: { label: "Country", primary: true }, enableHiding: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="font-medium">{row.original.name}</span>
              <span className="ml-2 font-mono text-xs text-muted-foreground md:hidden">{row.original.code}</span>
            </span>
            <span className="md:hidden">{toggleSwitch(row.original)}</span>
          </div>
        ),
      },
      { accessorKey: "region", header: ({ column }) => <SortHeader column={column} title="Region" />, meta: { label: "Region" } },
      { accessorKey: "enabled", header: "Status", meta: { label: "Status", hideOnMobile: true }, cell: ({ row }) => <StatusBadge status={row.original.enabled ? "Enabled" : "Disabled"} /> },
      {
        accessorKey: "used",
        header: ({ column }) => <SortHeader column={column} title="Used in" align="right" />,
        meta: { label: "Used in", align: "right" },
        cell: ({ row }) => row.original.used == null ? <Skeleton className="ml-auto h-4 w-16" /> : row.original.used ? <span>{row.original.used} live campaign{row.original.used === 1 ? "" : "s"}</span> : <span className="text-muted-foreground">—</span>,
      },
      { id: "toggle", header: () => <span className="sr-only">Enabled</span>, meta: { label: "Enabled", align: "right", hideOnMobile: true }, enableHiding: false, cell: ({ row }) => toggleSwitch(row.original) },
      actionsColumn<Row>((c) => (
        <RowActions
          label={`Actions for ${c.name}`}
          title={`${c.name} · ${c.code}`}
          groups={[
            [{ label: "Analytics", icon: ChartPie, href: `/analytics?country=${c.code}` }],
            [
              // toggle() asks first when disabling; defer it so the menu hands back focus before the dialog opens.
              canEdit && { label: c.enabled ? "Disable platform-wide" : "Enable platform-wide", icon: c.enabled ? CircleOff : CircleCheck, destructive: c.enabled, onSelect: () => setTimeout(() => void toggle(c, !c.enabled), 0) },
            ],
          ]}
        />
      )),
    ]
  }, [patch, canEdit])

  const enabled = countries.filter((c) => c.enabled).length

  return (
    <ScreenState query={q} loading={<Skeleton className="h-96" />}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          <b className="font-semibold text-foreground tabular-nums">{enabled}</b> of {countries.length} countries enabled. Disabled countries can’t be offered by any property or targeted by any campaign.
          {!canEdit && " Only Owners and Admins can change this list."}
        </p>
        <DataTable
          columns={columns}
          data={rows}
          pageSize={15}
          searchPlaceholder="Search country or code…"
          searchText={(c) => `${c.name} ${c.code}`}
          toolbar={
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger size="sm" className="w-44" aria-label="Region"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All regions</SelectItem>
                {regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          }
          emptyMessage="No countries match this search."
        />
      </div>
    </ScreenState>
  )
}
