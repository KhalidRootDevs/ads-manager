import {
  CAMPAIGN_STATUS_LABEL, CREATIVE_STATUS_LABEL, KEY_STATUS_LABEL, PACING_LABEL_TEXT, PLATFORM_LABEL, PROPERTY_STATUS_LABEL, SDK_STATE_LABEL, USER_STATUS_LABEL,
} from "@orbit/domain"
import { cn } from "@/lib/utils"

/** Enum value → display label for every status-like enum (labels pass through unchanged). */
const ENUM_LABEL: Record<string, string> = {
  ...PACING_LABEL_TEXT, ...KEY_STATUS_LABEL, ...USER_STATUS_LABEL, ...SDK_STATE_LABEL, ...PROPERTY_STATUS_LABEL, ...CREATIVE_STATUS_LABEL, ...CAMPAIGN_STATUS_LABEL,
  grace: "Grace period", filled: "Served", open: "Open", acked: "Acknowledged", resolved: "Resolved",
}
export function statusLabel(status: string): string {
  return ENUM_LABEL[status] ?? status
}

type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "primary"

const TONE: Record<Tone, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20",
  warning: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20",
  danger: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20",
  info: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20",
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-500/20 dark:bg-zinc-500/10 dark:text-zinc-300 dark:ring-zinc-500/20",
  primary: "bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/20",
}
const DOT: Record<Tone, string> = {
  success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500", info: "bg-blue-500", neutral: "bg-zinc-400", primary: "bg-indigo-500",
}

const STATUS_TONE: Record<string, Tone> = {
  Active: "success", Ready: "success", Healthy: "success", Enabled: "success", Served: "success",
  Paused: "warning", Degraded: "warning", Behind: "warning", "Under-delivering": "warning",
  "Needs Attention": "danger", Rejected: "danger", "Heartbeat missing": "danger", Revoked: "danger", Overspending: "danger", Error: "danger",
  Scheduled: "info", "In Review": "info", Invited: "info", Preview: "info", "Grace period": "warning", Acknowledged: "neutral", Open: "danger",
  Completed: "primary", "On pace": "success", Ahead: "warning",
  Draft: "neutral", Archived: "neutral", Pending: "neutral", "Not integrated": "neutral", Disabled: "neutral", Inactive: "neutral", "Not started": "neutral", Ended: "neutral",
}

export function toneFor(status: string): Tone {
  return STATUS_TONE[statusLabel(status)] ?? "neutral"
}

export function StatusBadge({ status, tone, className, dot = true }: { status: string; tone?: Tone; className?: string; dot?: boolean }) {
  const t = tone ?? toneFor(status)
  return (
    <span className={cn("inline-flex h-5.5 w-fit shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset", TONE[t], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", DOT[t])} aria-hidden />}
      {statusLabel(status)}
    </span>
  )
}

export function PlatformBadge({ type }: { type: string }) {
  return <span className="inline-flex h-5 w-fit items-center rounded border bg-muted/60 px-1.5 text-[11px] font-medium text-muted-foreground">{PLATFORM_LABEL[type as keyof typeof PLATFORM_LABEL] ?? type}</span>
}
