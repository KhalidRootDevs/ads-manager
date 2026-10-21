"use client"

import {
  type ColumnDef, type ColumnFiltersState, type FilterFn, type Row, type SortingState, type VisibilityState, type Column,
  flexRender, getCoreRowModel, getFacetedRowModel, getFacetedUniqueValues, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3, PlusCircle, Search, X } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** Label used in the column picker and mobile cards. */
    label?: string
    align?: "left" | "right"
    /** Hide this column inside mobile cards. */
    hideOnMobile?: boolean
    /** Render as the card title on mobile. */
    primary?: boolean
    className?: string
  }
}

export interface FacetFilter {
  columnId: string
  title: string
  options: { label: string; value: string }[]
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  searchPlaceholder?: string
  /** Text used by the search box; defaults to all string values of the row. */
  searchText?: (row: T) => string
  filters?: FacetFilter[]
  /** Extra toolbar content; pass a function to receive the currently filtered + sorted rows (e.g. for export). */
  toolbar?: React.ReactNode | ((rows: T[]) => React.ReactNode)
  pageSize?: number
  onRowClick?: (row: T) => void
  initialSorting?: SortingState
  initialHidden?: VisibilityState
  emptyMessage?: React.ReactNode
  footer?: React.ReactNode[]
  /** Keep a real table (with horizontal scroll) on mobile instead of cards. */
  scrollOnMobile?: boolean
  className?: string
  dense?: boolean
  /** Hide the search box (useful for short tables). */
  hideSearch?: boolean
  /** Controlled search box, e.g. for server-side search. When set, rows are not filtered by the search text client-side. */
  search?: { value: string; onChange: (value: string) => void }
}

/** Use as `filterFn: facetFilterFn` on columns referenced by `filters`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const facetFilterFn: FilterFn<any> = (row, id, value: string[]) => !value?.length || value.includes(String(row.getValue(id)))

export function DataTable<T>({
  columns, data, searchPlaceholder = "Search…", searchText, filters = [], toolbar, pageSize = 10, onRowClick, initialSorting = [], initialHidden = {},
  emptyMessage = "No results.", footer, scrollOnMobile, className, dense, hideSearch, search,
}: DataTableProps<T>) {
  const isMobile = useIsMobile()
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [visibility, setVisibility] = useState<VisibilityState>(initialHidden)
  const [globalFilter, setGlobalFilter] = useState("")

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility: visibility, globalFilter: search ? "" : globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setVisibility,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _id, value: string) => {
      const q = String(value ?? "").toLowerCase().trim()
      if (!q) return true
      const text = searchText ? searchText(row.original) : Object.values(row.original as object).filter((v) => typeof v === "string").join(" ")
      return text.toLowerCase().includes(q)
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    initialState: { pagination: { pageSize } },
    autoResetPageIndex: true,
  })

  const searchValue = search ? search.value : globalFilter
  const setSearch = search ? search.onChange : setGlobalFilter
  const filtered = columnFilters.length > 0 || !!searchValue
  const rows = table.getRowModel().rows
  const total = table.getFilteredRowModel().rows.length
  const { pageIndex, pageSize: ps } = table.getState().pagination
  const cards = isMobile && !scrollOnMobile

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className={cn("relative w-full sm:w-64", hideSearch && "hidden")}>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchValue} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="pl-8" />
        </div>
        {filters.map((f) => {
          const col = table.getColumn(f.columnId)
          return col ? <FacetedFilter key={f.columnId} column={col} title={f.title} options={f.options} /> : null
        })}
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => { table.resetColumnFilters(); setSearch("") }}>
            Reset <X />
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {typeof toolbar === "function" ? toolbar(table.getSortedRowModel().rows.map((r) => r.original)) : toolbar}
          {!cards && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="hidden md:inline-flex"><Columns3 /> Columns</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table.getAllColumns().filter((c) => c.getCanHide() && c.columnDef.meta?.label).map((c) => (
                  <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} onSelect={(e) => e.preventDefault()}>
                    {c.columnDef.meta?.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {cards ? (
        <div className="flex flex-col gap-2">
          {rows.length ? rows.map((row) => <MobileCard key={row.id} row={row} onClick={onRowClick} />) : <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader className="bg-muted/50">
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent">
                  {hg.headers.map((h) => (
                    <TableHead key={h.id} className={cn("h-10 text-xs font-medium text-muted-foreground", h.column.columnDef.meta?.align === "right" && "text-right", h.column.columnDef.meta?.className)}>
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.length ? (
                rows.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={onRowClick ? (e) => { if (!(e.target as HTMLElement).closest("a,button,input,[role=checkbox],[role=menuitem]")) onRowClick(row.original) } : undefined}
                    className={cn(onRowClick && "cursor-pointer")}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={cn(dense ? "py-2" : "py-3", cell.column.columnDef.meta?.align === "right" && "text-right tabular-nums", cell.column.columnDef.meta?.className)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-28 text-center text-sm text-muted-foreground">{emptyMessage}</TableCell>
                </TableRow>
              )}
            </TableBody>
            {footer && rows.length > 0 && (
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  {table.getVisibleLeafColumns().map((c, i) => (
                    <TableCell key={c.id} className={cn("py-2.5 font-semibold", c.columnDef.meta?.align === "right" && "text-right tabular-nums", c.columnDef.meta?.className)}>{footer[table.getAllLeafColumns().indexOf(c)] ?? (i === 0 ? "Total" : "")}</TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      )}

      {total > ps && (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{pageIndex * ps + 1}–{Math.min((pageIndex + 1) * ps, total)} of {total}</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page"><ChevronLeft /></Button>
            <span className="px-2 tabular-nums">Page {pageIndex + 1} of {table.getPageCount()}</span>
            <Button variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page"><ChevronRight /></Button>
          </div>
        </div>
      )}
    </div>
  )
}

function MobileCard<T>({ row, onClick }: { row: Row<T>; onClick?: (r: T) => void }) {
  const cells = row.getVisibleCells()
  const actions = cells.find((c) => c.column.id === "actions")
  const primary = cells.find((c) => c.column.columnDef.meta?.primary) ?? cells[0]
  const rest = cells.filter((c) => c !== primary && c !== actions && !c.column.columnDef.meta?.hideOnMobile && c.column.columnDef.meta?.label)
  return (
    <div
      className={cn("rounded-lg border bg-card p-4 text-sm", onClick && "cursor-pointer active:bg-muted/50")}
      onClick={onClick ? (e) => { if (!(e.target as HTMLElement).closest("a,button,input,[role=checkbox],[role=menuitem]")) onClick(row.original) } : undefined}
    >
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">{flexRender(primary.column.columnDef.cell, primary.getContext())}</div>
        {actions && <div className="-mt-1 -mr-2 shrink-0">{flexRender(actions.column.columnDef.cell, actions.getContext())}</div>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {rest.map((c) => (
          <div key={c.id} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{c.column.columnDef.meta?.label}</dt>
            <dd className="mt-0.5 min-w-0 truncate">{flexRender(c.column.columnDef.cell, c.getContext())}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function SortHeader<T>({ column, title, align }: { column: Column<T, unknown>; title: string; align?: "right" }) {
  const s = column.getIsSorted()
  return (
    <Button variant="ghost" size="sm" className={cn("-mx-2 h-8 gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground", align === "right" && "ml-auto flex")} onClick={() => column.toggleSorting(s === "asc")}>
      {title}
      {s === "asc" ? <ArrowUp className="size-3.5" /> : s === "desc" ? <ArrowDown className="size-3.5" /> : <ChevronsUpDown className="size-3.5 opacity-50" />}
    </Button>
  )
}

function FacetedFilter<T>({ column, title, options }: { column: Column<T, unknown>; title: string; options: { label: string; value: string }[] }) {
  const facets = column.getFacetedUniqueValues()
  const selected = new Set((column.getFilterValue() as string[]) ?? [])
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
                      const next = new Set(selected)
                      if (on) next.delete(o.value); else next.add(o.value)
                      column.setFilterValue(next.size ? [...next] : undefined)
                    }}
                  >
                    <Checkbox checked={on} className="pointer-events-none" aria-hidden />
                    <span className="truncate">{o.label}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{facets.get(o.value) ?? 0}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => column.setFilterValue(undefined)} className="justify-center">Clear filter</CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
