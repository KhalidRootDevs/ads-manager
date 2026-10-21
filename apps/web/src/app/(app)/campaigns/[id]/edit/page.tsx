"use client"

import { useApiQuery } from "@orbit/api-client/react"
import { useParams, useSearchParams } from "next/navigation"
import { CampaignNotFound } from "@/components/campaigns/campaign-not-found"
import { CampaignWizard } from "@/components/campaigns/campaign-wizard"
import { PageContainer } from "@/components/page-header"
import { ScreenState } from "@/components/screen-state"
import { Skeleton } from "@/components/ui/skeleton"

export default function EditCampaignPage() {
  const { id } = useParams<{ id: string }>()
  const sp = useSearchParams()
  // Load once: background refetches must not reset the form while someone is editing.
  const q = useApiQuery("getCampaign", { params: { id } }, { refetchOnWindowFocus: false, staleTime: 0 })
  if (q.error?.status === 404) return <CampaignNotFound id={id} />
  const step = Number(sp.get("step")) || undefined
  // Wait for a fresh copy (not the cached detail) so the first save uses the latest `rev`.
  if (!q.data || q.isError || !q.isFetchedAfterMount) {
    const skeleton = <><Skeleton className="h-16 w-full max-w-md" /><Skeleton className="h-96 w-full" /></>
    return (
      <PageContainer>
        <ScreenState query={q} loading={skeleton}>{skeleton}</ScreenState>
      </PageContainer>
    )
  }
  return <CampaignWizard key={id} campaign={q.data} initialStep={step} />
}
