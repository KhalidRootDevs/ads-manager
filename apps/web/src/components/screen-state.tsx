"use client"

import { AlertTriangle, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/hooks"

export interface QueryLike {
  isPending: boolean
  isError: boolean
  error?: unknown
  refetch: () => unknown
  isRefetching?: boolean
}

/**
 * Loading / error / empty / content states for a page section driven by one or more queries.
 * Pass every query the section needs; the first error wins.
 */
export function ScreenState({
  query, isEmpty = false, children, empty, loading,
}: {
  query: QueryLike | QueryLike[]
  isEmpty?: boolean
  children: React.ReactNode
  /** First-run empty state for this section. */
  empty?: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }
  loading?: React.ReactNode
}) {
  const qs = Array.isArray(query) ? query : [query]
  const failed = qs.find((q) => q.isError)
  if (failed)
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon"><AlertTriangle /></EmptyMedia>
          <EmptyTitle>Couldn’t load this page</EmptyTitle>
          <EmptyDescription>{errorMessage(failed.error)} Live campaigns keep serving; only this view is affected.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => qs.forEach((q) => q.isError && q.refetch())} disabled={qs.some((q) => q.isRefetching)}>
            <RotateCw /> Retry
          </Button>
        </EmptyContent>
      </Empty>
    )
  if (qs.some((q) => q.isPending)) return <>{loading ?? <DefaultSkeleton />}</>
  if (isEmpty && empty)
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">{empty.icon}</EmptyMedia>
          <EmptyTitle>{empty.title}</EmptyTitle>
          <EmptyDescription>{empty.description}</EmptyDescription>
        </EmptyHeader>
        {empty.action && <EmptyContent>{empty.action}</EmptyContent>}
      </Empty>
    )
  return <>{children}</>
}

export function DefaultSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
    </div>
  )
}
