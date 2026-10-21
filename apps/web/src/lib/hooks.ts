"use client"

/**
 * Shared server-state hooks (TanStack Query via @orbit/api-client). Components never keep server data in Zustand.
 */
import { can, type Campaign, type Country, type Creative, type Lookups, type Permission, type Placement, type Property, type User } from "@orbit/domain"
import { ApiError, useApiQuery } from "@orbit/api-client/react"
import { useMemo } from "react"
import { toast } from "sonner"

const EMPTY: never[] = []

export function useMe() {
  return useApiQuery("me", {}, { staleTime: 5 * 60_000, retry: false })
}

/** Whether the signed-in user may do something. The API enforces it too; this only hides controls. */
export function useCan(permission: Permission): boolean {
  const me = useMe()
  return can(me.data?.user.role, permission)
}

export function useCountries() {
  return useApiQuery("listCountries", {}, { staleTime: 5 * 60_000, select: (r) => r.items })
}
export function useSettings() {
  return useApiQuery("getSettings", {}, { staleTime: 60_000 })
}
export function useProperties() {
  return useApiQuery("listProperties", {}, { select: (r) => r.items })
}
export function usePlacements(propertyId?: string) {
  return useApiQuery("listPlacements", propertyId ? { query: { propertyId } } : {}, { select: (r) => r.items })
}
export function useCreatives(opts: { includeArchived?: boolean } = {}) {
  return useApiQuery("listCreatives", { query: opts.includeArchived ? { includeArchived: true } : {} }, { select: (r) => r.items })
}
export function useLookups() {
  return useApiQuery("lookups", {}, { staleTime: 60_000 })
}
export function useTeam() {
  return useApiQuery("listTeam", {}, { select: (r) => r.items })
}
export function useAlerts() {
  return useApiQuery("listAlerts", {}, { select: (r) => r.items, refetchInterval: 60_000 })
}

export interface Index {
  propById: Record<string, Property>
  plcById: Record<string, Placement>
  crById: Record<string, Creative>
  campById: Record<string, Lookups["campaigns"][number] | Campaign>
  userById: Record<string, Lookups["users"][number] | User>
  ctryByCode: Record<string, Country>
  countries: Country[]
  properties: Property[]
  placements: Placement[]
  creatives: Creative[]
  /** All underlying queries have data. */
  ready: boolean
  isError: boolean
}

/** Id → entity maps for labels, breadcrumbs and pickers. Built from the small reference lists. */
export function useIndex(): Index {
  const p = useProperties()
  const pl = usePlacements()
  const cr = useCreatives({ includeArchived: true })
  const lk = useLookups()
  const c = useCountries()
  return useMemo(() => {
    const properties = p.data ?? EMPTY
    const placements = pl.data ?? EMPTY
    const creatives = cr.data ?? EMPTY
    const countries = c.data ?? EMPTY
    return {
      propById: Object.fromEntries(properties.map((x) => [x.id, x])),
      plcById: Object.fromEntries(placements.map((x) => [x.id, x])),
      crById: Object.fromEntries(creatives.map((x) => [x.id, x])),
      campById: Object.fromEntries((lk.data?.campaigns ?? EMPTY).map((x) => [x.id, x])),
      userById: Object.fromEntries((lk.data?.users ?? EMPTY).map((x) => [x.id, x])),
      ctryByCode: Object.fromEntries(countries.map((x) => [x.code, x])),
      countries,
      properties,
      placements,
      creatives,
      ready: !!(p.data && pl.data && cr.data && lk.data && c.data),
      isError: p.isError || pl.isError || cr.isError || lk.isError || c.isError,
    }
  }, [p.data, pl.data, cr.data, lk.data, c.data, p.isError, pl.isError, cr.isError, lk.isError, c.isError])
}

/** Human message for an API error. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const fields = e.problem.errors?.map((x) => x.message).filter(Boolean) ?? []
    return fields.length ? `${e.message} ${fields.slice(0, 3).join(" ")}` : e.message
  }
  return e instanceof Error ? e.message : "Something went wrong."
}

/** Standard toast for failed mutations; 409 conflicts get a reload hint. */
export function toastError(e: unknown, title = "Couldn’t save") {
  if (e instanceof ApiError && e.status === 409 && e.code === "conflict")
    toast.error("Someone else changed this", { description: "Reload to see the latest version, then apply your change again." })
  else if (e instanceof ApiError && e.status === 403) toast.error("Not allowed", { description: errorMessage(e) })
  else toast.error(title, { description: errorMessage(e) })
}

/** User display name from the lookups (falls back to "—"). */
export function useUserName() {
  const { userById } = useIndex()
  return (id: string | null | undefined) => (id ? (userById[id]?.name ?? "—") : "—")
}
