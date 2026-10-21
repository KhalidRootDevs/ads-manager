"use client"

import { ApiError } from "@orbit/api-client"
import { AlertTriangle, RotateCw } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useMe } from "@/lib/hooks"

/** Requires a session. Unauthenticated users go to /sign-in and come back afterwards. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const me = useMe()
  const router = useRouter()
  const unauthorized = me.error instanceof ApiError && me.error.status === 401
  useEffect(() => {
    if (unauthorized) router.replace(`/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`)
  }, [unauthorized, router])

  if (me.data) return <>{children}</>
  if (me.isError && !unauthorized)
    return (
      <div className="grid min-h-svh place-items-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <AlertTriangle className="size-6 text-amber-600" />
          <h1 className="text-lg font-semibold">Can’t reach the Orbit API</h1>
          <p className="text-sm text-muted-foreground">The admin API didn’t respond. Live campaigns keep serving; only the admin is affected.</p>
          <Button variant="outline" onClick={() => me.refetch()}><RotateCw /> Retry</Button>
        </div>
      </div>
    )
  return (
    <div className="flex min-h-svh">
      <div className="hidden w-64 border-r p-4 md:block"><Skeleton className="h-8 w-40" /></div>
      <div className="flex flex-1 flex-col gap-4 p-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>
    </div>
  )
}
