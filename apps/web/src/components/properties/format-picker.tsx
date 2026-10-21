"use client"

import { FORMAT_LABEL, FORMAT_META, type AdFormat } from "@orbit/domain"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

/** Checkbox cards for the ad formats a property accepts. */
export function FormatPicker({ options, value, onChange, invalid, disabled, idPrefix = "fmt" }: { options: AdFormat[]; value: AdFormat[]; onChange: (next: AdFormat[]) => void; invalid?: boolean; disabled?: boolean; idPrefix?: string }) {
  const toggle = (f: AdFormat) => onChange(value.includes(f) ? value.filter((x) => x !== f) : [...value, f])
  return (
    <div className={cn("grid gap-2 sm:grid-cols-2 xl:grid-cols-3", invalid && "rounded-lg ring-2 ring-destructive/30 ring-offset-2 ring-offset-background")}>
      {options.map((f) => {
        const on = value.includes(f)
        const id = `${idPrefix}-${f}`
        const meta = FORMAT_META[f]
        return (
          <label
            key={f}
            htmlFor={id}
            className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50", on && "border-primary/40 bg-primary/5", disabled && "cursor-default hover:bg-transparent")}
          >
            <Checkbox id={id} checked={on} disabled={disabled} onCheckedChange={() => toggle(f)} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                {FORMAT_LABEL[f]}
                {meta.future && <Badge variant="outline" className="h-4.5 px-1.5 text-[10px]">Future-ready</Badge>}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{meta.desc}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}
