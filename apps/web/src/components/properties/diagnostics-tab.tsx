"use client"

import { useApiQuery } from "@orbit/api-client/react"
import type { Property, RequestSample } from "@orbit/domain"
import type { ColumnDef } from "@tanstack/react-table"
import { Activity, ArrowRight, Loader2, Send } from "lucide-react"
import { useMemo } from "react"
import { DataTable, facetFilterFn } from "@/components/data-table"
import { ScreenState } from "@/components/screen-state"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { fmt } from "@/lib/format"
import { useCan } from "@/lib/hooks"
import { useTestRequest } from "./integration-tab"
import { resultTone } from "./property-utils"

type Row = RequestSample & { key: string; code: string }

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "at", header: "Time", meta: { label: "Time", primary: true }, cell: ({ row }) => <span className="font-mono text-xs whitespace-nowrap" title={row.original.at}>{fmt.dateTime(row.original.at)}</span> },
  { accessorKey: "placementName", header: "Placement", meta: { label: "Placement" }, cell: ({ row }) => <span className="block max-w-56 truncate">{row.original.placementName ?? row.original.placementId ?? "Unknown placement"}</span> },
  { accessorKey: "country", header: "Country", meta: { label: "Country" }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.country}</span> },
  { accessorKey: "code", header: "Result", meta: { label: "Result" }, filterFn: facetFilterFn, cell: ({ row }) => <StatusBadge status={row.original.result} tone={resultTone(row.original.result)} /> },
  { accessorKey: "latencyMs", header: "Latency", meta: { label: "Latency", align: "right" }, cell: ({ row }) => <span className="font-mono text-xs">{Math.round(row.original.latencyMs)} ms</span> },
  { accessorKey: "sdk", header: "SDK", meta: { label: "SDK" }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.sdk ?? "—"}</span> },
]

const CODE_LABEL: Record<string, string> = { "200": "200 Served", "204": "204 No fill", "400": "400 Bad request", "401": "401 Invalid key", "408": "408 Timeout", "500": "500 Server error", "503": "503 Unavailable" }

export function DiagnosticsTab({ p, onTab }: { p: Property; onTab: (t: string) => void }) {
  const q = useApiQuery("diagnostics", { params: { id: p.id } }, { refetchInterval: 30_000 })
  const canWrite = useCan("properties.write")
  const test = useTestRequest(p)
  const rows = useMemo<Row[]>(() => (q.data?.items ?? []).map((r, i) => ({ ...r, key: `${r.at}:${i}`, code: r.result.slice(0, 3) })), [q.data])
  const isWeb = p.platform === "web"

  const sendButton = canWrite ? (
    <Button size="sm" variant="outline" onClick={() => test.mutate({ params: { id: p.id } })} disabled={test.isPending}>
      {test.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send test request
    </Button>
  ) : null

  const served = rows.filter((r) => r.result.startsWith("200")).length
  const codes = [...new Set(rows.map((r) => r.code))].sort()

  return (
    <ScreenState
      query={q}
      isEmpty={rows.length === 0}
      empty={{
        icon: <Activity />,
        title: "No requests in the last 24 hours",
        description: `${p.name} hasn’t sent any ad requests recently. Add the ${isWeb ? "web tag" : "SDK"}, then send a test request to check the setup.`,
        action: (
          <div className="flex flex-wrap justify-center gap-2">
            {sendButton}
            <Button size="sm" onClick={() => onTab("integration")}>Go to integration <ArrowRight /></Button>
          </div>
        ),
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span><b className="font-semibold tabular-nums">{served}</b> of <b className="font-semibold tabular-nums">{rows.length}</b> recent requests served</span>
          {p.sdk.state === "heartbeat_missing" && <span className="text-red-600 dark:text-red-400">No heartbeat since {fmt.ago(p.sdk.lastHeartbeatAt).toLowerCase()}</span>}
          <span className="text-muted-foreground">Sampled requests · last 24 hours · newest first</span>
        </div>
        <DataTable
          columns={columns}
          data={rows}
          dense
          pageSize={15}
          searchPlaceholder="Search requests…"
          searchText={(r) => `${r.placementName ?? ""} ${r.country} ${r.result}`}
          filters={[{ columnId: "code", title: "Result", options: codes.map((c) => ({ value: c, label: CODE_LABEL[c] ?? c })) }]}
          toolbar={sendButton}
        />
      </div>
    </ScreenState>
  )
}
