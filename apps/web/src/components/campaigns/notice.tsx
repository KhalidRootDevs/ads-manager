import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react"
import { cn } from "@/lib/utils"

export type NoticeTone = "danger" | "warning" | "info" | "success"

const TONE: Record<NoticeTone, string> = {
  danger: "border-red-500/30 bg-red-500/5 text-red-800 dark:text-red-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-300",
  info: "border-blue-500/30 bg-blue-500/5 text-blue-900 dark:text-blue-300",
  success: "border-emerald-500/30 bg-emerald-500/5 text-emerald-900 dark:text-emerald-300",
}
const ICON = { danger: OctagonAlert, warning: AlertTriangle, info: Info, success: CheckCircle2 }

/** Tinted callout with an icon, title, body and optional action area. */
export function Notice({
  tone, title, children, action, className,
}: {
  tone: NoticeTone
  title: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const Icon = ICON[tone]
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={cn("flex flex-col gap-3 rounded-lg border p-3.5 text-sm sm:flex-row sm:items-start", TONE[tone], className)}>
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-0.5">
          <div className="font-semibold">{title}</div>
          {children && <div className="text-foreground/80">{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2 pl-6.5 sm:pl-0">{action}</div>}
    </div>
  )
}
