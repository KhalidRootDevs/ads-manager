"use client"

import type { Metrics, Row } from "@orbit/domain"
import type { ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"
import { DataTable, SortHeader } from "@/components/data-table"
import { GuardedLink } from "@/components/nav-guard"
import { fmt } from "@/lib/format"

type NumKey = "req" | "elig" | "imp" | "fill" | "clk" | "ctr" | "vs" | "vc" | "vcr" | "conv" | "cost" | "ecpm" | "err"

const nul = (f: (v: number) => string) => (v: number | null) => (v == null ? "—" : f(v))

export const BREAKDOWN_METRICS: { key: NumKey; label: string; format: (v: number | null, r: Metrics) => string }[] = [
  { key: "req", label: "Requests", format: nul(fmt.int) },
  { key: "elig", label: "Eligible", format: nul(fmt.int) },
  { key: "imp", label: "Impressions", format: nul(fmt.int) },
  { key: "fill", label: "Fill rate", format: nul((v) => fmt.pct(v, 1)) },
  { key: "clk", label: "Clicks", format: nul(fmt.int) },
  { key: "ctr", label: "CTR", format: nul((v) => fmt.pct(v)) },
  { key: "vs", label: "Video starts", format: nul(fmt.int) },
  { key: "vc", label: "Completions", format: nul(fmt.int) },
  { key: "vcr", label: "Completion rate", format: (v, r) => (r.vs && v != null ? fmt.pct(v, 1) : "—") },
  { key: "conv", label: "Conversions", format: nul(fmt.int) },
  { key: "cost", label: "Spend", format: nul(fmt.usd) },
  { key: "ecpm", label: "eCPM", format: nul(fmt.usd2) },
  { key: "err", label: "Errors", format: nul(fmt.int) },
]

export function BreakdownTable({ rows, total, dimLabel, chronological }: { rows: Row[]; total: Metrics; dimLabel: string; chronological?: boolean }) {
  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "name",
        // Days sort by their date key; everything else by label.
        accessorFn: (r) => (chronological ? r.key : r.label),
        header: ({ column }) => <SortHeader column={column} title={dimLabel} />,
        sortingFn: "alphanumeric",
        enableHiding: false,
        meta: { label: dimLabel, primary: true, className: "min-w-48" },
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="flex min-w-0 flex-col">
              {r.href ? (
                <GuardedLink href={r.href} className="truncate font-medium hover:text-primary hover:underline">{r.label}</GuardedLink>
              ) : (
                <span className="truncate font-medium">{r.label}</span>
              )}
              {r.sub && <span className="truncate text-xs text-muted-foreground">{r.sub}</span>}
            </div>
          )
        },
      },
      ...BREAKDOWN_METRICS.map<ColumnDef<Row, unknown>>((m) => ({
        id: m.key,
        accessorFn: (r) => r[m.key] ?? -1,
        header: ({ column }) => <SortHeader column={column} title={m.label} align="right" />,
        sortDescFirst: true,
        meta: { label: m.label, align: "right", className: "whitespace-nowrap" },
        cell: ({ row }) => m.format(row.original[m.key], row.original),
      })),
    ],
    [dimLabel, chronological],
  )

  const footer = useMemo(() => ["Total", ...BREAKDOWN_METRICS.map((m) => m.format(total[m.key], total))], [total])

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder={`Search ${dimLabel.toLowerCase()}…`}
      searchText={(r) => `${r.label} ${r.sub ?? ""} ${r.key}`}
      footer={footer}
      scrollOnMobile
      dense
      pageSize={15}
      initialSorting={chronological ? [{ id: "name", desc: true }] : [{ id: "imp", desc: true }]}
      emptyMessage="No rows match your search."
    />
  )
}
