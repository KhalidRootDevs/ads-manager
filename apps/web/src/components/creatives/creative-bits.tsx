"use client"

import type { AdFormat, Check as DomainCheck } from "@orbit/domain"
import {
  AppWindow, CircleCheck, CircleX, Code, Film, Gift, Image as ImageIcon, Maximize2, Newspaper, PlusCircle, RectangleHorizontal, Rocket, SearchX,
  type LucideIcon,
} from "lucide-react"
import { GuardedLink } from "@/components/nav-guard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

type Check = Pick<DomainCheck, "key" | "label" | "ok" | "detail">

export const FORMAT_ICON: Record<AdFormat, LucideIcon> = {
  banner: RectangleHorizontal,
  interstitial: Maximize2,
  rewarded_video: Gift,
  native: Newspaper,
  app_open: Rocket,
  web_popup: AppWindow,
  web_display: ImageIcon,
  video: Film,
  rich_media: Code,
}

/** Pass/fail validation list. */
export function CheckList({ checks, className }: { checks: Check[]; className?: string }) {
  return (
    <ul className={cn("divide-y text-sm", className)}>
      {checks.map((c) => (
        <li key={`${c.key}:${c.label}`} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
          {c.ok ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          ) : (
            <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {c.label}
              <span className="sr-only">{c.ok ? " — passed" : " — failed"}</span>
            </div>
            {c.detail && <div className="text-xs break-words text-muted-foreground">{c.detail}</div>}
          </div>
          <span className={cn("shrink-0 text-xs font-medium", c.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")} aria-hidden>
            {c.ok ? "Pass" : "Fail"}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Faceted filter button (popover with checkboxes). Controlled; `single` keeps at most one value. */
export function FilterButton({
  title, options, value, onChange, single,
}: {
  title: string
  options: { label: string; value: string; count?: number }[]
  value: string[]
  onChange: (v: string[]) => void
  single?: boolean
}) {
  const selected = new Set(value)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <PlusCircle /> {title}
          {selected.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              {selected.size > 2 ? (
                <Badge variant="secondary" className="rounded-sm px-1 font-normal">{selected.size} selected</Badge>
              ) : (
                options.filter((o) => selected.has(o.value)).map((o) => <Badge key={o.value} variant="secondary" className="rounded-sm px-1 font-normal">{o.label}</Badge>)
              )}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = selected.has(o.value)
                return (
                  <CommandItem
                    key={o.value}
                    onSelect={() => {
                      if (single) return onChange(on ? [] : [o.value])
                      const next = new Set(selected)
                      if (on) next.delete(o.value)
                      else next.add(o.value)
                      onChange([...next])
                    }}
                  >
                    <Checkbox checked={on} className={cn("pointer-events-none", single && "rounded-full")} aria-hidden />
                    <span className="truncate">{o.label}</span>
                    {o.count !== undefined && <span className="ml-auto font-mono text-xs text-muted-foreground">{o.count}</span>}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => onChange([])} className="justify-center">Clear filter</CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Shown when a route id doesn't match any record. */
export function MissingState({ title, description, href, label }: { title: string; description: string; href: string; label: string }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon"><SearchX /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" asChild><GuardedLink href={href}>{label}</GuardedLink></Button>
      </EmptyContent>
    </Empty>
  )
}
