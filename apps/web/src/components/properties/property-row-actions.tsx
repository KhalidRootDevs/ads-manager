"use client"

import { useApiMutation } from "@orbit/api-client/react"
import type { Property } from "@orbit/domain"
import { ChartPie, Eye, KeyRound, LayoutTemplate, Pause, Play, Plug, Plus, Settings2, Stethoscope } from "lucide-react"
import { toast } from "sonner"
import { useMutationError } from "@/components/placements/placement-utils"
import { RowActions } from "@/components/row-actions"
import { useCan } from "@/lib/hooks"

/** Row menu for the apps & websites table. Most actions open the matching tab of the property page. */
export function PropertyRowActions({ p }: { p: Property }) {
  const canWrite = useCan("properties.write")
  const canKeys = useCan("keys.manage")
  const onError = useMutationError("properties")
  const pauseM = useApiMutation("pauseProperty", { onSuccess: () => { toast.success(`${p.name} paused`) }, onError: (e) => onError(e, "Couldn’t pause") })
  const activateM = useApiMutation("activateProperty", { onSuccess: () => { toast.success(`${p.name} is active. Campaigns can serve here again.`) }, onError: (e) => onError(e, "Couldn’t activate") })

  const base = `/properties/${p.id}`
  const isWeb = p.platform === "web"
  const rev = { params: { id: p.id }, body: { rev: p.rev } }
  const kind = isWeb ? "website" : "app"

  return (
    <RowActions
      label={`Actions for ${p.name}`}
      title={p.name}
      busy={pauseM.isPending || activateM.isPending}
      groups={[
        [
          { label: "View details", icon: Eye, href: base },
          { label: "Placements", icon: LayoutTemplate, href: `${base}?tab=placements` },
          canWrite && { label: "Add placement", icon: Plus, href: `${base}?tab=placements&new=placement` },
          { label: "Analytics", icon: ChartPie, href: `/analytics?property=${p.id}` },
        ],
        [
          canWrite && { label: "Formats & countries", icon: Settings2, href: `${base}?tab=formats` },
          canKeys && { label: "Credentials", icon: KeyRound, href: `${base}?tab=credentials` },
          { label: isWeb ? "Web tag & test request" : "SDK & test request", icon: Plug, href: `${base}?tab=integration` },
          { label: "Diagnostics", icon: Stethoscope, href: `${base}?tab=diagnostics` },
        ],
        [
          canWrite && p.status === "active" && {
            label: `Pause ${kind}`,
            icon: Pause,
            destructive: true,
            onSelect: () => pauseM.mutate(rev),
            confirm: {
              title: `Pause ${p.name}?`,
              description: `All campaigns stop serving on this ${kind} until you activate it again.`,
              confirmLabel: "Pause property",
              destructive: true,
            },
          },
          canWrite && p.status !== "active" && {
            label: `Activate ${kind}`,
            icon: Play,
            onSelect: () => activateM.mutate(rev),
            confirm: p.sdk.state === "not_integrated"
              ? {
                  title: `Activate ${p.name}?`,
                  description: `The ${isWeb ? "web tag" : "SDK"} hasn’t sent a request yet, so nothing will serve until it’s integrated. Send a test request from the Integration tab to check the setup first.`,
                  confirmLabel: "Activate anyway",
                }
              : undefined,
          },
        ],
      ]}
    />
  )
}
