"use client"

import { ApiError, useApiMutation, useApiQuery } from "@orbit/api-client/react"
import { PROPERTY_ENV_LABEL, type Property } from "@orbit/domain"
import { AppWindow, Pause, Play, Plus } from "lucide-react"
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { confirm } from "@/components/confirm-dialog"
import { PlacementDialog } from "@/components/domain/placement-dialog"
import { GuardedLink } from "@/components/nav-guard"
import { PageContainer, PageHeader } from "@/components/page-header"
import { CredentialsTab } from "@/components/properties/credentials-tab"
import { DiagnosticsTab } from "@/components/properties/diagnostics-tab"
import { FormatsTab } from "@/components/properties/formats-tab"
import { IntegrationTab } from "@/components/properties/integration-tab"
import { OverviewTab } from "@/components/properties/overview-tab"
import { PlacementsTab } from "@/components/properties/placements-tab"
import { PROPERTY_TABS, type PropertyTab } from "@/components/properties/property-utils"
import { useActiveTabInView, useTabParam } from "@/components/properties/use-tab-param"
import { ScreenState } from "@/components/screen-state"
import { PlatformBadge, StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fmt } from "@/lib/format"
import { useMutationError } from "@/components/placements/placement-utils"
import { useCan, useUserName } from "@/lib/hooks"

const TAB_VALUES = PROPERTY_TABS.map((t) => t.value) as PropertyTab[]

export default function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const q = useApiQuery("getProperty", { params: { id } })
  if (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400))
    return (
      <PageContainer>
        <Empty className="mt-8 border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon"><AppWindow /></EmptyMedia>
            <EmptyTitle>Property not found</EmptyTitle>
            <EmptyDescription>There’s no app or website with the ID “{id}”. It may have been removed, or the link is incomplete.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild><GuardedLink href="/properties">Back to apps & websites</GuardedLink></Button>
          </EmptyContent>
        </Empty>
      </PageContainer>
    )
  return (
    <PageContainer>
      <ScreenState query={q} loading={<DetailSkeleton />}>
        {q.data && <Detail key={q.data.id} p={q.data} />}
      </ScreenState>
    </PageContainer>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-9 w-full max-w-xl" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function Detail({ p }: { p: Property }) {
  const canWrite = useCan("properties.write")
  const userName = useUserName()
  const [tab, setTab] = useTabParam(TAB_VALUES, "overview")
  const tabsRef = useActiveTabInView<HTMLDivElement>(tab)
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [plOpen, setPlOpen] = useState(canWrite && params.get("new") === "placement")
  const active = useApiQuery("listCampaigns", { query: { propertyId: p.id, status: "active", limit: 100 } })
  const isWeb = p.platform === "web"

  const onError = useMutationError("properties")
  const pauseM = useApiMutation("pauseProperty", { onSuccess: () => { toast.success(`${p.name} paused`) }, onError: (e) => onError(e, "Couldn’t pause") })
  const activateM = useApiMutation("activateProperty", { onSuccess: () => { toast.success(`${p.name} is active. Campaigns can serve here again.`) }, onError: (e) => onError(e, "Couldn’t activate") })

  const closePlacement = (o: boolean) => {
    setPlOpen(o)
    if (!o && params.get("new")) {
      const sp = new URLSearchParams(params.toString())
      sp.delete("new")
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
    }
  }

  const activeCamps = active.data?.items.filter((c) => c.targets.some((t) => t.propertyId === p.id)).length ?? 0
  const pause = async () => {
    const ok = await confirm({
      title: `Pause ${p.name}?`,
      description: `All campaigns stop serving on this ${isWeb ? "website" : "app"} until you activate it again. ${activeCamps ? `${activeCamps} active campaign${activeCamps === 1 ? "" : "s"} target${activeCamps === 1 ? "s" : ""} it and will stop delivering here.` : "No active campaigns target it right now."}`,
      confirmLabel: "Pause property",
      destructive: true,
    })
    if (ok) pauseM.mutate({ params: { id: p.id }, body: { rev: p.rev } })
  }
  const activate = async () => {
    if (p.sdk.state === "not_integrated") {
      const ok = await confirm({
        title: `Activate ${p.name}?`,
        description: `The ${isWeb ? "web tag" : "SDK"} hasn’t sent a request yet, so nothing will serve until it’s integrated. Send a test request from the Integration tab to check the setup first.`,
        confirmLabel: "Activate anyway",
      })
      if (!ok) return
    }
    activateM.mutate({ params: { id: p.id }, body: { rev: p.rev } })
  }

  return (
    <>
      <PageHeader
        backHref="/properties"
        backLabel="Apps & websites"
        title={p.name}
        badges={<><PlatformBadge type={p.platform} /><StatusBadge status={p.status} /><StatusBadge status={p.sdk.state} /></>}
        description={
          <span className="flex flex-col gap-0.5">
            <span className="font-mono text-xs break-all text-foreground/80">{p.identifier}</span>
            <span>{p.team} team · {userName(p.ownerId)} · {PROPERTY_ENV_LABEL[p.env]} · added {fmt.date(p.createdAt)}</span>
          </span>
        }
        actions={
          canWrite ? (
            <>
              <Button variant="outline" onClick={() => setPlOpen(true)}><Plus /> Add placement</Button>
              {p.status === "active" ? (
                <Button variant="destructive" onClick={pause} disabled={pauseM.isPending}><Pause /> Pause property</Button>
              ) : (
                <Button onClick={activate} disabled={activateM.isPending}><Play /> Activate</Button>
              )}
            </>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-4">
        <div ref={tabsRef} className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
          <TabsList className="w-max">
            {PROPERTY_TABS.map((t) => <TabsTrigger key={t.value} value={t.value} className="px-3">{t.label}</TabsTrigger>)}
          </TabsList>
        </div>
        <TabsContent value="overview" className="min-w-0"><OverviewTab p={p} onTab={setTab} /></TabsContent>
        <TabsContent value="placements" className="min-w-0"><PlacementsTab p={p} onAdd={() => setPlOpen(true)} /></TabsContent>
        <TabsContent value="formats" className="min-w-0"><FormatsTab key={`${p.id}:${p.rev}`} p={p} /></TabsContent>
        <TabsContent value="credentials" className="min-w-0"><CredentialsTab p={p} /></TabsContent>
        <TabsContent value="integration" className="min-w-0"><IntegrationTab p={p} onTab={setTab} /></TabsContent>
        <TabsContent value="diagnostics" className="min-w-0"><DiagnosticsTab p={p} onTab={setTab} /></TabsContent>
      </Tabs>

      <PlacementDialog
        open={plOpen}
        onOpenChange={closePlacement}
        propertyId={p.id}
        onSaved={() => { if (tab !== "placements") setTab("placements") }}
      />
    </>
  )
}
