"use client"

import { Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { copyToClipboard } from "./property-utils"

/** Read-only code sample with a language label and a copy button. */
export function CodeBlock({ code, lang, label = "Snippet", className }: { code: string; lang: string; label?: string; className?: string }) {
  return (
    <div className={cn("min-w-0 overflow-hidden rounded-lg border bg-muted/40", className)}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/60 px-3 py-1.5">
        <span className="font-mono text-xs text-muted-foreground">{lang}</span>
        <Button type="button" variant="ghost" size="xs" onClick={() => copyToClipboard(code, label)}>
          <Copy /> Copy
        </Button>
      </div>
      <pre className="max-w-full overflow-x-auto p-3 font-mono text-xs leading-relaxed text-foreground" tabIndex={0} aria-label={`${lang} code sample`}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

/** Inline monospace value with a copy button (IDs, endpoints, one-time secrets). */
export function CopyField({ value, label, className }: { value: string; label: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3", className)}>
      <code className="min-w-0 flex-1 truncate font-mono text-xs sm:text-sm" title={value}>{value}</code>
      <Button type="button" variant="outline" size="sm" onClick={() => copyToClipboard(value, label)} aria-label={`Copy ${label}`}>
        <Copy /> Copy
      </Button>
    </div>
  )
}
