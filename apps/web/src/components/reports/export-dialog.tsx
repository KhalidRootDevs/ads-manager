"use client"

import { useApiQuery } from "@orbit/api-client/react"
import type { DeliveryQuery } from "@orbit/domain"
import { Download, FileSpreadsheet } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/hooks"

/**
 * Server-side CSV export (`analyticsExport`, needs `reports.export`). The file is fetched once when the dialog opens,
 * previewed, and saved from the same response, so preview and download always match.
 */
export function ExportDialog({
  open, onOpenChange, filename, body, summary,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  filename: string
  body: DeliveryQuery
  summary: string
}) {
  const q = useApiQuery("analyticsExport", open ? { body } : null, { staleTime: 60_000 })
  const csv = typeof q.data === "string" ? q.data : ""
  const lines = csv ? csv.trimEnd().split("\n") : []
  const rowCount = Math.max(0, lines.length - 1)
  const preview = lines.slice(0, 7).join("\n")

  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      toast.success(`Downloaded ${filename}`, { description: `${rowCount} ${rowCount === 1 ? "row" : "rows"}` })
      onOpenChange(false)
    } catch {
      toast.error("Download blocked", { description: "Your browser didn’t allow the file. The CSV preview is shown in the dialog." })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export CSV</DialogTitle>
          <DialogDescription>Export of the current breakdown and filters. {summary}</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-3">
          {q.isError ? (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">Couldn’t prepare the export. {errorMessage(q.error)}</p>
          ) : q.isPending ? (
            <div className="flex flex-col gap-3" aria-busy="true" aria-label="Preparing export">
              <Skeleton className="h-14" />
              <Skeleton className="h-40" />
            </div>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-muted/40 p-3">
                <FileSpreadsheet className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-sm">{filename}</span>
                  <span className="text-xs text-muted-foreground">{rowCount} {rowCount === 1 ? "row" : "rows"} + header · {(new Blob([csv]).size / 1024).toFixed(1)} KB</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Preview (first {Math.min(6, rowCount)} rows)</span>
                <pre className="max-h-56 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre" tabIndex={0} aria-label="CSV preview">{preview}</pre>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={download} disabled={!csv || rowCount === 0}><Download /> Download</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
