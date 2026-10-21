"use client"

import { apiKey, useApi } from "@orbit/api-client/react"
import type { CampaignListItem, CampaignStatus } from "@orbit/domain"
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

const PAGE = 100
const MAX_PAGES = 20

/**
 * Every campaign (optionally by status) with its `stats`, following cursor pages.
 * Used for budgets, pacing and country usage, where totals need the whole list rather than one page.
 * The key starts with the "campaigns" resource, so campaign mutations refresh it.
 */
export function useAllCampaigns(status?: CampaignStatus[]) {
  const api = useApi()
  const query = { limit: PAGE, ...(status ? { status } : {}) }
  const q = useQuery({
    queryKey: [...apiKey("listCampaigns", { query }), "all"],
    queryFn: async ({ signal }) => {
      const items: CampaignListItem[] = []
      let cursor: string | undefined
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await api.call("listCampaigns", { query: { ...query, cursor }, signal })
        items.push(...page.items)
        if (!page.nextCursor) break
        cursor = page.nextCursor
      }
      return items
    },
  })
  const byId = useMemo(() => Object.fromEntries((q.data ?? []).map((c) => [c.id, c])), [q.data])
  return { ...q, byId }
}
