"use client"

import { useApiQuery } from "@orbit/api-client/react"
import {
  LIVE_CAMPAIGN_STATUSES,
  pacing,
  PACING_LABEL_TEXT,
  quarterOf,
  quarterRange,
  TEAMS,
  teamBudgetLeft,
  todayKey,
  toMicros,
  type CampaignListItem,
  type CampaignStatus,
  type PacingLabel,
} from "@orbit/domain"
import type { ColumnDef } from "@tanstack/react-table"
import { Info, Pencil, Wallet } from "lucide-react"
import { useMemo, useState } from "react"
import { useDelivery } from "@/components/analytics/use-analytics"
import { type BudgetTarget, BudgetDialog } from "@/components/billing/budget-dialog"
import { useAllCampaigns } from "@/components/billing/use-all-campaigns"
import { CampaignRowActions } from "@/components/campaigns/campaign-row-actions"
import { DataTable, facetFilterFn, SortHeader } from "@/components/data-table"
import { Meter } from "@/components/domain/widgets"
import { GuardedLink, useGuardedRouter } from "@/components/nav-guard"
import { PageContainer, PageHeader } from "@/components/page-header"
import { InfoTip } from "@/components/reports/funnel"
import { actionsColumn, RowActions } from "@/components/row-actions"
import { ScreenState } from "@/components/screen-state"
import { StatusBadge } from "@/components/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { fmt } from "@/lib/format"
import { useCan } from "@/lib/hooks"
import { cn } from "@/lib/utils"

/** All money on this page is integer micros until formatted. */
interface TeamRow {
  team: string
  budget: number
  alloc: number
  spent: number
  left: number
  live: number
  rev: number | null
}

interface PacingRow {
  c: CampaignListItem
  id: string
  name: string
  team: string
  status: CampaignStatus
  budget: number
  spent: number
  budgetPct: number
  elapsed: number
  label: PacingLabel
}

const PACING_HINT: Partial<Record<PacingLabel, string>> = {
  on_pace: "Spend is within 8 points of the share of the flight that has elapsed.",
  behind: "Spending slower than the flight elapses — likely to under-deliver.",
  ahead: "Spending faster than the flight elapses — budget may run out early.",
  paused: "Not spending while paused.",
  not_started: "Flight hasn’t started yet.",
}

export default function BillingPage() {
  const router = useGuardedRouter()
  const canEdit = useCan("budgets.write")
  const [editing, setEditing] = useState<BudgetTarget | null>(null)

  // Read the clock once per mount: render must stay pure for memoization.
  const [today] = useState(() => todayKey())
  const quarter = quarterOf(today)
  const qr = quarterRange(quarter)
  const span = fmt.range(qr.from, qr.to)
  const qLabel = quarter.replace(/^(\d{4})-(Q\d)$/, "$2 $1")

  const budgetsQ = useApiQuery("listBudgets", { query: { quarter } })
  const campaignsQ = useAllCampaigns()
  // Spend this quarter per campaign (delivery rollups); quarter-to-date, so the range ends today.
  const spendQ = useDelivery({ range: { from: qr.from, to: today < qr.to ? today : qr.to }, filters: {} }, "campaign", { limit: 500 })

  const { teams, camps, totals } = useMemo(() => {
    const campaigns = campaignsQ.data ?? []
    const budgets = budgetsQ.data?.items ?? []
    const qSpend = Object.fromEntries((spendQ.data?.rows ?? []).map((r) => [r.key, toMicros(r.cost)]))
    const budgetOf = Object.fromEntries(budgets.map((b) => [b.team, b]))
    const names = [...new Set([...TEAMS, ...budgets.map((b) => b.team), ...campaigns.map((c) => c.team)])]
    const live = campaigns.filter((c) => LIVE_CAMPAIGN_STATUSES.includes(c.status))
    const teams: TeamRow[] = names.map((t) => {
      const b = budgetOf[t]
      const { total, allocated, left } = teamBudgetLeft(b?.amountMicros ?? 0, campaigns, t)
      const spent = campaigns.filter((c) => c.team === t).reduce((s, c) => s + (qSpend[c.id] ?? 0), 0)
      return { team: t, budget: total, alloc: allocated, spent, left, live: live.filter((c) => c.team === t).length, rev: b?.rev ?? null }
    })
    const camps: PacingRow[] = live.map((c: CampaignListItem) => {
      const spent = c.stats?.lifetime.costMicros ?? 0
      const p = pacing(c, spent)
      return {
        c,
        id: c.id,
        name: c.name,
        team: c.team,
        status: c.status,
        budget: c.budget.amountMicros,
        spent,
        budgetPct: p.budgetPct,
        elapsed: p.elapsed,
        label: p.label,
      }
    })
    const total = teams.reduce((s, t) => s + t.budget, 0)
    const alloc = teams.reduce((s, t) => s + t.alloc, 0)
    const spent = spendQ.data ? toMicros(spendQ.data.totals.cost) : 0
    return { teams, camps, totals: { total, alloc, spent, left: total - alloc, hasBudgets: budgets.length > 0 } }
  }, [campaignsQ.data, budgetsQ.data, spendQ.data])

  const openAdjust = (t: TeamRow) => setEditing({ team: t.team, quarter, span, budgetMicros: t.budget, allocatedMicros: t.alloc, rev: t.rev })

  // Small, cheap column sets: rebuilt per render (the React Compiler memoizes them).
  const teamColumns: ColumnDef<TeamRow, unknown>[] = [
    {
      accessorKey: "team",
      header: ({ column }) => <SortHeader column={column} title="Team" />,
      enableHiding: false,
      meta: { label: "Team", primary: true },
      cell: ({ row }) => (
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="font-medium">{row.original.team}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.live} live {row.original.live === 1 ? "campaign" : "campaigns"}
              {row.original.rev == null ? " · no budget set" : ""}
            </span>
          </div>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="md:hidden"
              onClick={() => openAdjust(row.original)}
              aria-label={`Adjust ${row.original.team} budget`}
            >
              <Pencil /> Adjust
            </Button>
          )}
        </div>
      ),
    },
    {
      accessorKey: "budget",
      header: ({ column }) => <SortHeader column={column} title="Budget" align="right" />,
      meta: { label: "Budget", align: "right" },
      cell: ({ row }) => fmt.money(row.original.budget),
    },
    {
      accessorKey: "alloc",
      header: ({ column }) => <SortHeader column={column} title="Allocated" align="right" />,
      meta: { label: "Allocated", align: "right" },
      cell: ({ row }) => fmt.money(row.original.alloc),
    },
    {
      id: "progress",
      header: "Allocated · spent",
      enableSorting: false,
      meta: { label: "Allocated · spent", className: "min-w-28 lg:min-w-40" },
      cell: ({ row }) => {
        const r = row.original
        const over = r.alloc > r.budget
        return (
          <div
            className="flex min-w-24 flex-col gap-1.5"
            title={`Allocated ${fmt.pct(r.budget ? r.alloc / r.budget : 0, 0)} · spent ${fmt.pct(r.budget ? r.spent / r.budget : 0, 0)} of budget`}
          >
            <Meter value={r.budget ? r.alloc / r.budget : over ? 1 : 0} tone={over ? "danger" : "primary"} />
            <Meter value={r.budget ? r.spent / r.budget : 0} tone="success" />
          </div>
        )
      },
    },
    {
      accessorKey: "spent",
      header: ({ column }) => <SortHeader column={column} title={`Spent ${qLabel.split(" ")[0]}`} align="right" />,
      meta: { label: `Spent ${qLabel.split(" ")[0]}`, align: "right" },
      cell: ({ row }) => fmt.money(row.original.spent),
    },
    {
      accessorKey: "left",
      header: ({ column }) => <SortHeader column={column} title="Unallocated" align="right" />,
      meta: { label: "Unallocated", align: "right" },
      cell: ({ row }) => {
        const v = row.original.left
        return v < 0 ? (
          <span className="font-medium text-destructive">
            −{fmt.money(-v)} <span className="text-xs font-normal">over</span>
          </span>
        ) : (
          fmt.money(v)
        )
      },
    },
    ...(canEdit
      ? [
          actionsColumn<TeamRow>((t) => (
            <RowActions
              label={`Actions for ${t.team}`}
              title={`${t.team} · ${qLabel}`}
              groups={[[{ label: "Adjust budget", icon: Pencil, onSelect: () => openAdjust(t), hint: fmt.money(t.budget) }]]}
            />
          )),
        ]
      : []),
  ]

  // Small, cheap column sets: rebuilt per render (the React Compiler memoizes them).
  const pacingColumns: ColumnDef<PacingRow, unknown>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <SortHeader column={column} title="Campaign" />,
      enableHiding: false,
      meta: { label: "Campaign", primary: true },
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col gap-1">
          <GuardedLink href={`/campaigns/${row.original.id}`} className="font-medium hover:text-primary hover:underline">
            {row.original.name}
          </GuardedLink>
          <div className="flex flex-wrap items-center gap-2 lg:hidden">
            <StatusBadge status={row.original.status} />
            <span className="hidden text-xs text-muted-foreground md:inline">{row.original.team}</span>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "team",
      header: ({ column }) => <SortHeader column={column} title="Team" />,
      filterFn: facetFilterFn,
      meta: { label: "Team", className: "hidden lg:table-cell" },
    },
    {
      accessorKey: "status",
      header: "Status",
      enableSorting: false,
      meta: { label: "Status", hideOnMobile: true, className: "hidden lg:table-cell" },
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "budget",
      header: ({ column }) => <SortHeader column={column} title="Budget" align="right" />,
      meta: { label: "Budget", align: "right" },
      cell: ({ row }) => fmt.money(row.original.budget),
    },
    {
      accessorKey: "spent",
      header: ({ column }) => <SortHeader column={column} title="Spent" />,
      meta: { label: "Spent", className: "min-w-32 lg:min-w-40" },
      cell: ({ row }) => {
        const r = row.original
        const over = r.budgetPct > 1
        return (
          <div className="flex min-w-28 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 tabular-nums">
              <span>{fmt.money(r.spent)}</span>
              <span className={cn("text-xs", over ? "font-medium text-destructive" : "text-muted-foreground")}>
                {fmt.pct(r.budgetPct, 0)}
                {over && " · over"}
              </span>
            </div>
            <Meter value={r.budgetPct} tone={over ? "danger" : r.budgetPct > 0.9 ? "warning" : "primary"} />
          </div>
        )
      },
    },
    {
      accessorKey: "elapsed",
      header: ({ column }) => <SortHeader column={column} title="Elapsed" align="right" />,
      meta: { label: "Flight elapsed", align: "right" },
      cell: ({ row }) => fmt.pct(row.original.elapsed, 0),
    },
    {
      accessorKey: "label",
      header: "Pacing",
      enableSorting: false,
      filterFn: facetFilterFn,
      meta: { label: "Pacing" },
      cell: ({ row }) => (
        <span title={PACING_HINT[row.original.label]}>
          <StatusBadge status={row.original.label} />
        </span>
      ),
    },    actionsColumn((r) => <CampaignRowActions c={r.c} />),
  ]

  const teamFooter = [
    "Total",
    fmt.money(totals.total),
    fmt.money(totals.alloc),
    "",
    fmt.money(totals.spent),
    totals.left < 0 ? (
      <span key="l" className="text-destructive">
        −{fmt.money(-totals.left)}
      </span>
    ) : (
      fmt.money(totals.left)
    ),
    ...(canEdit ? [""] : []),
  ]

  const stats = [
    { label: `${qLabel} internal budget`, value: fmt.money(totals.total), tip: `Sum of all team budgets for ${span}.` },
    {
      label: "Allocated to live campaigns",
      value: fmt.money(totals.alloc),
      tip: "Total budget of scheduled, active and paused campaigns.",
      sub: totals.total ? `${fmt.pct(totals.alloc / totals.total, 0)} of budget` : undefined,
    },
    {
      label: "Spent this quarter",
      value: spendQ.data ? fmt.money(totals.spent) : "—",
      tip: `Internal cost of impressions served since ${fmt.date(qr.from)} (delivery rollups, updated every few minutes).`,
      sub: totals.total && spendQ.data ? `${fmt.pct(totals.spent / totals.total, 0)} of budget` : undefined,
    },
    {
      label: "Unallocated",
      value: totals.left < 0 ? `−${fmt.money(-totals.left)}` : fmt.money(totals.left),
      tip: "Budget not yet committed to a live campaign. Negative means teams are over-allocated.",
      sub: totals.left < 0 ? "Over-allocated" : totals.total ? `${fmt.pct(totals.left / totals.total, 0)} of budget free` : undefined,
      danger: totals.left < 0,
    },
  ]

  const teamFilterOpts = teams.map((t) => ({ label: t.team, value: t.team }))
  const pacingFilterOpts = (["on_pace", "behind", "ahead", "paused", "not_started"] as PacingLabel[]).map((l) => ({ label: PACING_LABEL_TEXT[l], value: l }))

  return (
    <PageContainer>
      <PageHeader title="Billing & budgets" description={`Internal budget tracking for ${qLabel} (${span}).`} />

      <Alert>
        <Info />
        <AlertTitle>Internal budgets only</AlertTitle>
        <AlertDescription>
          Orbit Ads tracks how much of each team’s internal budget campaigns use. There are no invoices, payments or external billing — spend is an internal
          cost allocation.
        </AlertDescription>
      </Alert>

      <ScreenState
        query={[budgetsQ, campaignsQ]}
        isEmpty={!totals.hasBudgets && !canEdit}
        empty={{
          icon: <Wallet />,
          title: `No budgets set for ${qLabel}`,
          description: "An Owner or Admin sets each team’s quarterly budget. Campaign spend is tracked against it automatically.",
        }}
        loading={<BillingSkeleton />}
      >
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((s) => (
              <Card key={s.label} className="gap-0 py-0">
                <CardContent className="flex flex-col gap-1.5 p-4">
                  <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span className="min-w-0">{s.label}</span>
                    <InfoTip tip={s.tip} />
                  </div>
                  <span className={cn("text-xl font-semibold tracking-tight tabular-nums sm:text-2xl", s.danger && "text-destructive")}>{s.value}</span>
                  {s.sub && <span className="text-xs text-muted-foreground">{s.sub}</span>}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Team budgets</CardTitle>
              <CardDescription>
                Top bar: allocated to live campaigns (red when over budget). Bottom bar: spent this quarter.
                {spendQ.isError && " Spend couldn’t be loaded right now."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={teamColumns}
                data={teams}
                searchPlaceholder="Search teams…"
                footer={teamFooter}
                pageSize={20}
                initialSorting={[{ id: "budget", desc: true }]}
              />
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Campaign pacing</CardTitle>
              <CardDescription>Live campaigns · spend (all time) compared with the share of the flight that has elapsed</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={pacingColumns}
                data={camps}
                searchPlaceholder="Search campaigns…"
                filters={[
                  { columnId: "team", title: "Team", options: teamFilterOpts },
                  { columnId: "label", title: "Pacing", options: pacingFilterOpts },
                ]}
                onRowClick={(r) => router.push(`/campaigns/${r.id}`)}
                emptyMessage="No live campaigns match."
              />
            </CardContent>
          </Card>
        </div>
      </ScreenState>

      {canEdit && <BudgetDialog key={editing?.team ?? "none"} target={editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  )
}

function BillingSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-80" />
      <Skeleton className="h-96" />
    </div>
  )
}
