"use client"

import { ApiError, useApiQuery } from "@orbit/api-client/react"
import { useParams } from "next/navigation"
import { MissingState } from "@/components/creatives/creative-bits"
import { CreativeWizard } from "@/components/creatives/creative-wizard"
import { PageContainer } from "@/components/page-header"
import { ScreenState } from "@/components/screen-state"
import { Skeleton } from "@/components/ui/skeleton"

export default function EditCreativePage() {
  const { id } = useParams<{ id: string }>()
  const q = useApiQuery("getCreative", { params: { id } })
  if (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400)) {
    return (
      <PageContainer>
        <MissingState title="Creative not found" description="It may have been removed, or the link is incorrect." href="/creatives" label="Back to creatives" />
      </PageContainer>
    )
  }
  if (q.data?.status === "archived") {
    return (
      <PageContainer>
        <MissingState title="This creative is archived" description="Restore it before editing. Archived creatives don’t serve and can’t be changed." href={`/creatives/${id}`} label="Back to the creative" />
      </PageContainer>
    )
  }
  // Keyed so the wizard re-initialises if a different creative is opened.
  if (q.data) return <CreativeWizard key={q.data.id} existing={q.data} />
  return (
    <PageContainer className="max-w-5xl">
      <ScreenState query={q} loading={<div className="flex flex-col gap-6"><Skeleton className="h-8 w-56" /><Skeleton className="h-10 w-full" /><Skeleton className="h-[480px] w-full" /></div>}>
        {null}
      </ScreenState>
    </PageContainer>
  )
}
