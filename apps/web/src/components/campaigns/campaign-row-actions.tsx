"use client"

import { useApiMutation } from "@orbit/api-client/react"
import type { CampaignListItem } from "@orbit/domain"
import { useQueryClient } from "@tanstack/react-query"
import { Archive, BarChart3, ChartPie, Copy, Eye, Pause, Pencil, Play, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { useGuardedRouter } from "@/components/nav-guard"
import { RowActions } from "@/components/row-actions"
import { toastError, useCan } from "@/lib/hooks"

/** Row menu for the campaigns table; the same lifecycle actions as the campaign page header. */
export function CampaignRowActions({ c }: { c: CampaignListItem }) {
  const router = useGuardedRouter()
  const qc = useQueryClient()
  const canWrite = useCan("campaigns.write")
  const canPublish = useCan("campaigns.publish")
  const onFail = (title: string) => (e: unknown) => { toastError(e, title); void qc.invalidateQueries({ queryKey: ["campaigns"] }) }

  const pauseM = useApiMutation("pauseCampaign", { onSuccess: () => { toast.success(`${c.name} paused. Delivery stops within a few seconds.`) }, onError: onFail("Couldn’t pause") })
  const resumeM = useApiMutation("resumeCampaign", { onSuccess: () => { toast.success(`${c.name} resumed`) }, onError: onFail("Couldn’t resume") })
  const archiveM = useApiMutation("archiveCampaign", { onSuccess: () => { toast.success("Campaign archived") }, onError: onFail("Couldn’t archive") })
  const restoreM = useApiMutation("restoreCampaign", { onSuccess: () => { toast.success("Restored as draft") }, onError: onFail("Couldn’t restore") })
  const duplicateM = useApiMutation("duplicateCampaign", {
    onSuccess: (d) => { toast.success("Duplicated as a draft. Nothing serves until you publish it."); void router.push(`/campaigns/${d.id}`) },
    onError: onFail("Couldn’t duplicate"),
  })
  const busy = pauseM.isPending || resumeM.isPending || archiveM.isPending || restoreM.isPending || duplicateM.isPending

  const rev = { params: { id: c.id }, body: { rev: c.rev } }
  const archived = c.status === "archived"
  const canEdit = canWrite && !archived && c.status !== "completed"

  return (
    <RowActions
      label={`Actions for ${c.name}`}
      title={c.name}
      busy={busy}
      groups={[
        [
          { label: "View details", icon: Eye, href: `/campaigns/${c.id}` },
          canEdit && { label: c.status === "draft" ? "Continue editing" : "Edit", icon: Pencil, href: `/campaigns/${c.id}/edit` },
          { label: "Analytics", icon: ChartPie, href: `/analytics?campaign=${c.id}` },
          { label: "View report", icon: BarChart3, href: `/reports?campaign=${c.id}` },
        ],
        [
          canPublish && (c.status === "active" || c.status === "scheduled") && { label: "Pause", icon: Pause, onSelect: () => pauseM.mutate(rev) },
          canPublish && c.status === "paused" && { label: "Resume", icon: Play, onSelect: () => resumeM.mutate(rev) },
          canWrite && { label: "Duplicate as draft", icon: Copy, onSelect: () => duplicateM.mutate({ params: { id: c.id } }) },
        ],
        [
          canPublish && archived && { label: "Restore as draft", icon: RotateCcw, onSelect: () => restoreM.mutate(rev) },
          canPublish && !archived && {
            label: "Archive",
            icon: Archive,
            destructive: true,
            onSelect: () => archiveM.mutate(rev),
            confirm: {
              title: `Archive “${c.name}”?`,
              description: "Archiving stops delivery right away and removes the campaign from active lists. Reporting history is kept. You can restore it as a draft later.",
              confirmLabel: "Archive campaign",
              destructive: true,
            },
          },
        ],
      ]}
    />
  )
}
