"use client"

import { ApiError, useApi, useApiQuery } from "@orbit/api-client/react"
import {
  FREQ_PERIOD_LABEL, LIVE_CAMPAIGN_STATUSES, SIZED_FORMATS, type AdFormat, type CampaignListItem, type CampaignStatus, type DeliveryQuery, type Placement,
} from "@orbit/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { toastError } from "@/lib/hooks"

/** Campaigns that can currently serve into a placement: scheduled, active or paused, and targeting it. */
export function eligibleCampaigns<C extends Pick<CampaignListItem, "status" | "targets">>(placementId: string, campaigns: C[]): C[] {
  return campaigns.filter((c) => LIVE_CAMPAIGN_STATUSES.includes(c.status) && c.targets.some((t) => t.placementIds.includes(placementId)))
}

/** Formats where the creative size must match the placement size exactly (see `compat`). */
export const sizeMatters = (f: AdFormat) => SIZED_FORMATS.includes(f)

export const freqLabel = (p: Pick<Placement, "freqCap">) => (p.freqCap ? `${p.freqCap.count} / ${FREQ_PERIOD_LABEL[p.freqCap.per]}` : "")
export const refreshLabel = (p: Pick<Placement, "format" | "refreshSec">) => (p.refreshSec ? `${p.refreshSec}s` : p.format === "banner" ? "Off" : "")

const MAX_PAGES = 10

/**
 * Every campaign (optionally by status), walking the API cursor (≤ 1,000 rows). Used for small "used in" / "eligible"
 * counts on library pages. Keyed under `campaigns`, so campaign mutations refresh it.
 */
export function useAllCampaigns(status?: CampaignStatus[]) {
  const api = useApi()
  return useQuery({
    queryKey: ["campaigns", "listCampaigns:all", status ?? null],
    queryFn: async ({ signal }) => {
      const items: CampaignListItem[] = []
      let cursor: string | undefined
      for (let i = 0; i < MAX_PAGES; i++) {
        const r = await api.call("listCampaigns", { query: { limit: 100, ...(cursor ? { cursor } : {}), ...(status ? { status } : {}) }, signal })
        items.push(...r.items)
        if (!r.nextCursor) break
        cursor = r.nextCursor
      }
      return items
    },
  })
}

/** Delivery totals (and optional daily rows) for one entity, e.g. `{ placement: [id] }`. */
export function useDelivery(filters: DeliveryQuery["filters"], days: number, groupBy: DeliveryQuery["groupBy"] = null, enabled = true) {
  return useApiQuery("analyticsDelivery", enabled ? { body: { range: { days }, filters, groupBy, limit: 500 } } : null)
}

/** Daily rows → RequestsChart points. */
export function requestSeries(rows: { label: string; req: number | null; imp: number }[] | undefined) {
  return (rows ?? []).map((r) => ({ day: r.label, req: r.req ?? 0, imp: r.imp }))
}

/**
 * Mutation error handler: standard toast, and on a 409 (stale rev or state change) refetch the resource
 * so the page shows the latest server copy (`ApiError.current`).
 */
export function useMutationError(resource: "creatives" | "properties" | "placements") {
  const qc = useQueryClient()
  return useCallback(
    (e: unknown, title?: string) => {
      toastError(e, title)
      if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: [resource] })
    },
    [qc, resource],
  )
}
