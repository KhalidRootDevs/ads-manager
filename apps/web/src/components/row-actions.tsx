"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Loader2, MoreHorizontal, type LucideIcon } from "lucide-react"
import { Fragment } from "react"
import { confirm, type ConfirmOptions } from "@/components/confirm-dialog"
import { GuardedLink } from "@/components/nav-guard"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export interface RowAction {
  label: string
  icon: LucideIcon
  /** Navigates (a real link, so it also opens in a new tab and respects the unsaved-changes guard). */
  href?: string
  onSelect?: () => void
  destructive?: boolean
  disabled?: boolean
  /** Ask first; `onSelect` runs only when confirmed. */
  confirm?: ConfirmOptions
  /** Short muted text on the right, e.g. a state or shortcut. */
  hint?: string
}

/** Groups are separated by a divider. Falsy entries are skipped, so callers can write `canWrite && { … }`. */
export type RowActionGroups = (RowAction | false | null | undefined)[][]

/** The ⋯ menu at the end of a table row (or the top-right of a mobile card). Renders nothing when no action applies. */
export function RowActions({ label, title, groups, busy }: { label: string; title?: string; groups: RowActionGroups; busy?: boolean }) {
  const visible = groups.map((g) => g.filter(Boolean) as RowAction[]).filter((g) => g.length)
  if (!visible.length) return null

  const run = (a: RowAction) => {
    if (!a.onSelect) return
    if (!a.confirm) return a.onSelect()
    // Let the menu close and hand back focus before the dialog takes it.
    setTimeout(() => void confirm(a.confirm!).then((ok) => ok && a.onSelect!()), 0)
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={busy}
          className="text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          {busy ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
        </Button>
      </DropdownMenuTrigger>
      {/* The menu is portalled, but React still bubbles its clicks to the row: stop them so a row click doesn't also navigate. */}
      <DropdownMenuContent align="end" sideOffset={6} className="w-56 rounded-xl p-1.5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        {title && <DropdownMenuLabel className="truncate px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{title}</DropdownMenuLabel>}
        {visible.map((g, i) => (
          <Fragment key={i}>
            {(i > 0 || title) && <DropdownMenuSeparator className="my-1" />}
            <DropdownMenuGroup>
              {g.map((a) => {
                const body = (
                  <>
                    <a.icon className={cn(!a.destructive && "text-muted-foreground")} />
                    <span className="truncate">{a.label}</span>
                    {a.hint && <DropdownMenuShortcut className="tracking-normal">{a.hint}</DropdownMenuShortcut>}
                  </>
                )
                const variant = a.destructive ? "destructive" : "default"
                return a.href && !a.disabled ? (
                  <DropdownMenuItem key={a.label} asChild variant={variant} className="cursor-pointer gap-2.5 rounded-md py-2">
                    <GuardedLink href={a.href}>{body}</GuardedLink>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem key={a.label} variant={variant} disabled={a.disabled} onSelect={() => run(a)} className="cursor-pointer gap-2.5 rounded-md py-2">
                    {body}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A right-aligned, unsortable actions column. `cell` usually returns a component that owns its mutations. */
export function actionsColumn<T>(cell: (row: T) => React.ReactNode): ColumnDef<T, unknown> {
  return {
    id: "actions",
    enableSorting: false,
    enableHiding: false,
    header: () => <span className="sr-only">Actions</span>,
    meta: { align: "right", className: "w-12" },
    cell: ({ row }) => <div className="flex justify-end">{cell(row.original)}</div>,
  }
}
