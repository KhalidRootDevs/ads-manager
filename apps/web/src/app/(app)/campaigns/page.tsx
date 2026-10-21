"use client"

import { apiKey, useApi, useApiQuery } from "@orbit/api-client/react"
import {
  CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABEL, GOAL_TYPE_LABEL, needsAttention, OBJECTIVE_LABEL, OBJECTIVES, PLATFORMS, PLATFORM_LABEL,
  type CampaignListItem, type Query,
} from "@orbit/domain"
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Loader2, Megaphone, Plus } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { CampaignRowActions } from "@/components/campaigns/campaign-row-actions"
import { displayStatus, flight, goalValue, lifetime, platformsOf, plural, STATUS_TABS, type StatusTab } from "@/components/campaigns/campaign-utils"
import { DataTable, facetFilterFn, SortHeader, type FacetFilter } from "@/components/data-table"
import { Meter } from "@/components/domain/widgets"
import { PageContainer, PageHeader } from "@/components/page-header"
import { actionsColumn } from "@/components/row-actions"
import { ScreenState } from "@/components/screen-state"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fmt } from "@/lib/format"
import { useCan, useIndex, useUserName } from "@/lib/hooks"

const PAGE = 25
const STATUS_ORDER: Record<string, number> = { needs_attention: 0, active: 1, scheduled: 2, paused: 3, draft: 4, completed: 5, archived: 6 }

interface Row {
  c: CampaignListItem
  id: string
  name: string
  owner: string
  status: string
  objective: string
  platforms: string[]
  propCount: number
  goalVal: number
  goalPct: number
  spent: number
  budgetPct: number
}

const columns: ColumnDef<Row, unknown>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortHeader column={column} title="Campaign" />,
    meta: { label: "Campaign", primary: true },
    enableHiding: false,
    cell: ({ row }) => (
      <div className="min-w-0 max-w-72">
        <Link href={`/campaigns/${row.original.id}`} className="block truncate font-medium hover:underline">{row.original.name}</Link>
        <div className="truncate text-xs text-muted-foreground">{row.original.owner} · {plural(row.original.c.creativeIds.length, "creative")}</div>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => <SortHeader column={column} title="Status" />,
    sortingFn: (a, b) => (STATUS_ORDER[a.original.status] ?? 9) - (STATUS_ORDER[b.original.status] ?? 9),
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "objective",
    header: ({ column }) => <SortHeader column={column} title="Objective" />,
    meta: { label: "Objective" },
    filterFn: facetFilterFn,
  },
  {
    // Hidden column used only by the Owner facet.
    accessorKey: "owner",
    header: "Owner",
    filterFn: facetFilterFn,
    enableHiding: false,
  },
  {
    id: "platform",
    accessorFn: (r) => r.platforms.join(" · "),
    getUniqueValues: (r) => r.platforms,
    filterFn: (row, _id, value: string[]) => !value?.length || row.original.platforms.some((p) => value.includes(p)),
    header: ({ column }) => <SortHeader column={column} title="Properties" />,
    sortingFn: (a, b) => a.original.propCount - b.original.propCount,
    meta: { label: "Properties" },
    cell: ({ row }) => (
      <div className="min-w-0">
        <div>{plural(row.original.propCount, "property", "properties")}</div>
        <div className="truncate text-xs text-muted-foreground">{row.original.platforms.join(" · ") || "—"}</div>
      </div>
    ),
  },
  {
    id: "schedule",
    accessorFn: (r) => r.c.flight.start,
    header: ({ column }) => <SortHeader column={column} title="Schedule" />,
    meta: { label: "Schedule", hideOnMobile: true },
    cell: ({ row }) => <span className="whitespace-nowrap">{flight(row.original.c)}</span>,
  },
  {
    id: "delivery",
    accessorFn: (r) => r.goalPct,
    header: ({ column }) => <SortHeader column={column} title="Delivery vs goal" />,
    meta: { label: "Delivery" },
    cell: ({ row }) => {
      const r = row.original
      const goal = r.c.budget.goal
      const unit = GOAL_TYPE_LABEL[goal?.type ?? "impressions"].toLowerCase()
      return (
        <div className="flex w-40 max-w-full flex-col gap-1.5">
          <Meter value={r.goalPct} tone={r.goalPct >= 1 ? "success" : "primary"} />
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            {goal ? `${fmt.compact(r.goalVal)} / ${fmt.compact(goal.value)} ${unit}` : `${fmt.compact(r.goalVal)} ${unit} · no goal`}
          </span>
        </div>
      )
    },
  },
  {
    id: "budget",
    accessorFn: (r) => r.budgetPct,
    header: ({ column }) => <SortHeader column={column} title="Budget" />,
    meta: { label: "Budget" },
    cell: ({ row }) => {
      const r = row.original
      return (
        <div className="flex w-36 max-w-full flex-col gap-1.5">
          <Meter value={r.budgetPct} tone={r.budgetPct > 0.9 ? "warning" : "primary"} />
          <span className="truncate text-xs text-muted-foreground tabular-nums">{fmt.money(r.spent)} / {fmt.money(r.c.budget.amountMicros)}</span>
        </div>
      )
    },
  },
  actionsColumn((r) => <CampaignRowActions c={r.c} />),
]

const isTab = (v: string | null): v is StatusTab => !!v && STATUS_TABS.some((t) => t.value === v)

export default function CampaignsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const api = useApi()
  const canWrite = useCan("campaigns.write")
  const { propById } = useIndex()
  const userName = useUserName()

  const rawTab = sp.get("tab")
  const tab: StatusTab = isTab(rawTab) ? rawTab : "all"
  const setTab = (v: string) => router.replace(v === "all" ? pathname : `${pathname}?tab=${v}`, { scroll: false })

  // Search runs on the server (name contains), debounced.
  const [q, setQ] = useState("")
  const [qDebounced, setQDebounced] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const query: Query<"listCampaigns"> = {
    limit: PAGE,
    ...(tab === "all" ? {} : { status: [tab === "needs_attention" ? "active" : tab] }),
    ...(qDebounced ? { q: qDebounced } : {}),
  }
  const list = useInfiniteQuery({
    // Same resource prefix as useApiQuery, so mutations invalidate it.
    queryKey: [...apiKey("listCampaigns", { query }), "infinite"],
    queryFn: ({ pageParam, signal }) => api.call("listCampaigns", { query: { ...query, ...(pageParam ? { cursor: pageParam } : {}) }, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  })
  const counts = useApiQuery("campaignCounts", {})

  const rows = useMemo<Row[]>(() => {
    const items = (list.data?.pages ?? []).flatMap((p) => p.items)
    return items
      .filter((c) => tab !== "needs_attention" || needsAttention(c))
      .map((c) => {
        const goalVal = goalValue(c, c.stats)
        const spent = lifetime(c.stats).costMicros
        const goal = c.budget.goal?.value ?? 0
        return {
          c, id: c.id, name: c.name, owner: userName(c.ownerId), status: displayStatus(c), objective: OBJECTIVE_LABEL[c.objective],
          platforms: platformsOf(c, propById), propCount: c.targets.length,
          goalVal, goalPct: goal ? Math.min(1, goalVal / goal) : 0,
          spent, budgetPct: c.budget.amountMicros ? Math.min(1, spent / c.budget.amountMicros) : 0,
        }
      })
  }, [list.data, tab, propById, userName])

  const tabCounts = useMemo(() => {
    const c = counts.data?.counts ?? {}
    const m: Record<string, number> = { all: CAMPAIGN_STATUSES.filter((s) => s !== "archived").reduce((a, s) => a + (c[s] ?? 0), 0), needs_attention: counts.data?.needsAttention ?? 0 }
    CAMPAIGN_STATUSES.forEach((s) => { m[s] = c[s] ?? 0 })
    return m
  }, [counts.data])
  const total = CAMPAIGN_STATUSES.reduce((a, s) => a + (counts.data?.counts[s] ?? 0), 0)

  const filters = useMemo<FacetFilter[]>(() => {
    const owners = [...new Set(rows.map((r) => r.owner))].sort()
    return [
      { columnId: "objective", title: "Objective", options: OBJECTIVES.map((x) => ({ label: OBJECTIVE_LABEL[x], value: OBJECTIVE_LABEL[x] })) },
      { columnId: "owner", title: "Owner", options: owners.map((x) => ({ label: x, value: x })) },
      { columnId: "platform", title: "Platform", options: PLATFORMS.map((x) => ({ label: PLATFORM_LABEL[x], value: PLATFORM_LABEL[x] })) },
    ]
  }, [rows])

  const newBtn = canWrite ? (
    <Button asChild>
      <Link href="/campaigns/new"><Plus /> New campaign</Link>
    </Button>
  ) : undefined

  const loaded = (list.data?.pages ?? []).reduce((a, p) => a + p.items.length, 0)
  const tabTotal = tab === "all" ? tabCounts.all : tabCounts[tab] ?? 0

  return (
    <PageContainer>
      <PageHeader
        title="Campaigns"
        description={`${tabCounts.all} campaigns · creatives are reusable across campaigns`}
        actions={newBtn}
      />
      <ScreenState
        query={[list, counts]}
        isEmpty={!!counts.data && total === 0}
        empty={{
          icon: <Megaphone />,
          title: "No campaigns yet",
          description: "A campaign combines reusable creatives with apps and websites, per-property country targeting, placements and a budget.",
          action: newBtn,
        }}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList variant="line" aria-label="Filter by status">
                {STATUS_TABS.map((t) => (
                  <TabsTrigger key={t.value} value={t.value} className="px-2.5">
                    {t.label}
                    <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums">{tabCounts[t.value] ?? 0}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <DataTable
            columns={columns}
            data={rows}
            filters={filters}
            searchPlaceholder="Search campaigns…"
            search={{ value: q, onChange: setQ }}
            initialHidden={{ owner: false }}
            initialSorting={[]}
            // One client page: "Load more" fetches the next cursor page from the API.
            pageSize={Math.max(PAGE, rows.length)}
            onRowClick={(r) => router.push(`/campaigns/${r.id}`)}
            toolbar={list.isFetching && !list.isFetchingNextPage ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" /> : null}
            emptyMessage={
              <div className="flex flex-col items-center gap-2">
                <span>{qDebounced ? `No campaigns match “${qDebounced}”.` : tab === "all" ? "No campaigns match these filters." : `No ${CAMPAIGN_STATUS_LABEL[tab].toLowerCase()} campaigns.`}</span>
                {tab !== "all" && <Button variant="outline" size="sm" onClick={() => setTab("all")}>Show all statuses</Button>}
              </div>
            }
          />
          {(list.hasNextPage || loaded > PAGE) && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>{qDebounced ? `${loaded} loaded` : `${loaded} of ${tabTotal} loaded`}</span>
              {list.hasNextPage && (
                <Button variant="outline" size="sm" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                  {list.isFetchingNextPage && <Loader2 className="animate-spin" />} Load more
                </Button>
              )}
            </div>
          )}
        </div>
      </ScreenState>
    </PageContainer>
  )
}
