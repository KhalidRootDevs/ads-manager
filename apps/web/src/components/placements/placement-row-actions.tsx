"use client"

import { useApiMutation } from "@orbit/api-client/react"
import type { Placement } from "@orbit/domain"
import { AppWindow, ChartPie, Eye, Pause, Pencil, Play } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { PlacementDialog } from "@/components/domain/placement-dialog"
import { useMutationError } from "@/components/placements/placement-utils"
import { RowActions } from "@/components/row-actions"
import { useCan } from "@/lib/hooks"

/** Row menu for placement tables. `showProperty` adds a link to the owning app or website (hidden on that property's own page). */
export function PlacementRowActions({ pl, showProperty = true }: { pl: Placement; showProperty?: boolean }) {
  const canWrite = useCan("properties.write")
  const [editOpen, setEditOpen] = useState(false)
  const onError = useMutationError("placements")
  const patch = useApiMutation("patchPlacement", {
    onSuccess: (x) => { toast.success(x.status === "paused" ? `${x.name} paused` : `${x.name} activated`) },
    onError: (e) => onError(e),
  })
  const setStatus = (status: Placement["status"]) => patch.mutate({ params: { id: pl.id }, body: { rev: pl.rev, status } })

  return (
    <>
      <RowActions
        label={`Actions for ${pl.name}`}
        title={pl.name}
        busy={patch.isPending}
        groups={[
          [
            { label: "View details", icon: Eye, href: `/placements/${pl.id}` },
            canWrite && { label: "Edit", icon: Pencil, onSelect: () => setEditOpen(true) },
            showProperty && { label: "View app or website", icon: AppWindow, href: `/properties/${pl.propertyId}` },
            { label: "Analytics", icon: ChartPie, href: `/analytics?placement=${pl.id}` },
          ],
          [
            canWrite && pl.status === "active" && {
              label: "Pause placement",
              icon: Pause,
              destructive: true,
              onSelect: () => setStatus("paused"),
              confirm: {
                title: `Pause ${pl.name}?`,
                description: "The SDK will get no-fill responses here until you activate it again. Campaigns that use it stop delivering in this slot.",
                confirmLabel: "Pause placement",
                destructive: true,
              },
            },
            canWrite && pl.status !== "active" && { label: "Activate placement", icon: Play, onSelect: () => setStatus("active") },
          ],
        ]}
      />
      {/* The dialog is portalled but its clicks still bubble to the table row through React: keep them here. */}
      <div className="contents" onClick={(e) => e.stopPropagation()}>
        <PlacementDialog open={editOpen} onOpenChange={setEditOpen} editId={pl.id} />
      </div>
    </>
  )
}
