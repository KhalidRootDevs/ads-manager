"use client"

import { useApiMutation } from "@orbit/api-client/react"
import { creativeChecks, type Creative } from "@orbit/domain"
import { Archive, ArchiveRestore, ChartPie, Copy, Eye, Pencil, Send, ThumbsDown, ThumbsUp } from "lucide-react"
import { toast } from "sonner"
import { useGuardedRouter } from "@/components/nav-guard"
import { useMutationError } from "@/components/placements/placement-utils"
import { RowActions } from "@/components/row-actions"
import { useCan } from "@/lib/hooks"

/** Row menu for the creatives table. Rejecting needs a reason, so it opens the creative page. */
export function CreativeRowActions({ c, uses }: { c: Creative; uses: number | null }) {
  const router = useGuardedRouter()
  const canWrite = useCan("creatives.write")
  const canApprove = useCan("creatives.approve")
  const onError = useMutationError("creatives")

  const submitM = useApiMutation("submitCreative", {
    onSuccess: (x) => { toast.success(x.status === "ready" ? "Approved. The creative can now serve." : "Submitted for review") },
    onError: (e) => onError(e, "Couldn’t submit"),
  })
  const approveM = useApiMutation("approveCreative", { onSuccess: () => { toast.success("Approved. The creative can now serve.") }, onError: (e) => onError(e, "Couldn’t approve") })
  const archiveM = useApiMutation("archiveCreative", { onSuccess: () => { toast.success("Creative archived") }, onError: (e) => onError(e, "Couldn’t archive") })
  const restoreM = useApiMutation("restoreCreative", { onSuccess: () => { toast.success("Restored as draft") }, onError: (e) => onError(e, "Couldn’t restore") })
  const duplicateM = useApiMutation("duplicateCreative", {
    onSuccess: (x) => { toast.success("Duplicated as a draft"); void router.push(`/creatives/${x.id}`) },
    onError: (e) => onError(e, "Couldn’t duplicate"),
  })
  const busy = submitM.isPending || approveM.isPending || archiveM.isPending || restoreM.isPending || duplicateM.isPending

  const rev = { params: { id: c.id }, body: { rev: c.rev } }
  const failing = creativeChecks(c).filter((x) => !x.ok)
  const submit = () => {
    if (failing.length) {
      toast.error("Fix the failing checks before submitting for review.", { description: failing.map((x) => x.label).join(", ") })
      return
    }
    submitM.mutate(rev)
  }
  const archived = c.status === "archived"
  const reviewing = c.status === "in_review"

  return (
    <RowActions
      label={`Actions for ${c.name}`}
      title={c.name}
      busy={busy}
      groups={[
        [
          { label: "View details", icon: Eye, href: `/creatives/${c.id}` },
          canWrite && !archived && { label: c.status === "rejected" ? "Edit and resubmit" : "Edit", icon: Pencil, href: `/creatives/${c.id}/edit` },
          { label: "Analytics", icon: ChartPie, href: `/analytics?creative=${c.id}` },
        ],
        [
          canWrite && c.status === "draft" && { label: canApprove ? "Submit & approve" : "Submit for review", icon: Send, onSelect: submit },
          canApprove && reviewing && {
            label: "Approve",
            icon: ThumbsUp,
            onSelect: () => approveM.mutate(rev),
            confirm: failing.length
              ? { title: "Approve with failing checks?", description: `${failing.length} validation check${failing.length === 1 ? " is" : "s are"} failing (${failing.map((x) => x.label).join(", ")}). The creative may render badly in some placements.`, confirmLabel: "Approve anyway" }
              : undefined,
          },
          canApprove && reviewing && { label: "Reject…", icon: ThumbsDown, href: `/creatives/${c.id}` },
          canWrite && { label: "Duplicate", icon: Copy, onSelect: () => duplicateM.mutate({ params: { id: c.id } }) },
        ],
        [
          canWrite && archived && { label: "Restore", icon: ArchiveRestore, onSelect: () => restoreM.mutate(rev) },
          canWrite && !archived && {
            label: "Archive",
            icon: Archive,
            destructive: true,
            onSelect: () => archiveM.mutate(rev),
            confirm: {
              title: `Archive “${c.name}”?`,
              description: uses
                ? `It is attached to ${uses} campaign${uses === 1 ? "" : "s"}. Archiving is blocked while a live or scheduled campaign uses it. You can restore it later.`
                : "It isn’t used by any campaign. You can restore it later.",
              confirmLabel: "Archive",
              destructive: true,
            },
          },
        ],
      ]}
    />
  )
}
