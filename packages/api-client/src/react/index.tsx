/**
 * TanStack Query bindings for the Orbit API (guideline §3.4).
 * - Query keys: `[resource, endpointName, args]`, where resource is the first path segment after /v1.
 *   Invalidating `[resource]` refreshes every query of that resource.
 * - Mutations invalidate their resource plus the cross-cutting feeds (lookups, audit, alerts) on success.
 */
"use client"

import { endpoints, type EndpointName, type Res } from "@orbit/domain"
import {
  keepPreviousData, QueryClient, useMutation, useQuery, useQueryClient, type QueryKey, type UseMutationOptions, type UseQueryOptions,
} from "@tanstack/react-query"
import { createContext, useContext, type ReactNode } from "react"
import { ApiError, type ApiClient, type CallArgs } from "../client"

const ClientCtx = createContext<ApiClient | null>(null)

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ClientCtx.Provider value={client}>{children}</ClientCtx.Provider>
}

export function useApi(): ApiClient {
  const c = useContext(ClientCtx)
  if (!c) throw new Error("useApi() needs <ApiProvider>")
  return c
}

export function resourceOf(name: EndpointName): string {
  return endpoints[name].path.split("/")[2] ?? "misc"
}

export function apiKey<N extends EndpointName>(name: N, args?: Partial<CallArgs<N>>): QueryKey {
  const { signal: _s, idempotencyKey: _i, ...rest } = (args ?? {}) as Record<string, unknown>
  return [resourceOf(name), name, rest]
}

const ANALYTICS_STALE = 60_000
const ENTITY_STALE = 30_000

/** Query any endpoint (GET, or POST endpoints that are reads: analytics, validate). */
export function useApiQuery<N extends EndpointName, TData = Res<N>>(
  name: N,
  args: CallArgs<N> | null,
  options: Omit<UseQueryOptions<Res<N>, ApiError, TData>, "queryKey" | "queryFn"> = {},
) {
  const api = useApi()
  const analytics = resourceOf(name) === "analytics"
  return useQuery<Res<N>, ApiError, TData>({
    queryKey: apiKey(name, args ?? undefined),
    queryFn: ({ signal }) => api.call(name, { ...(args as object), signal } as CallArgs<N>),
    enabled: args !== null && options.enabled !== false,
    staleTime: analytics ? ANALYTICS_STALE : ENTITY_STALE,
    ...(analytics ? { placeholderData: keepPreviousData as never } : {}),
    ...options,
  })
}

/** Extra resources whose data depends on another resource (e.g. campaign health depends on creatives). */
const DEPENDENTS: Record<string, string[]> = {
  creatives: ["campaigns"],
  properties: ["campaigns", "placements"],
  placements: ["campaigns", "properties"],
  countries: ["campaigns", "properties"],
  audiences: ["campaigns"],
  campaigns: ["analytics"],
  budgets: ["campaigns"],
}

export interface ApiMutationOptions<N extends EndpointName, Ctx = unknown> extends Omit<UseMutationOptions<Res<N>, ApiError, CallArgs<N>, Ctx>, "mutationFn"> {
  /** Additional resources (query-key prefixes) to invalidate on success. */
  invalidate?: string[]
}

export function useApiMutation<N extends EndpointName, Ctx = unknown>(name: N, options: ApiMutationOptions<N, Ctx> = {}) {
  const api = useApi()
  const qc = useQueryClient()
  const { invalidate = [], onSuccess, ...rest } = options
  return useMutation<Res<N>, ApiError, CallArgs<N>, Ctx>({
    mutationFn: (args) => api.call(name, args),
    ...rest,
    onSuccess: async (data, vars, ctx, mctx) => {
      const res = resourceOf(name)
      const keys = new Set([res, "lookups", "audit", "alerts", ...(DEPENDENTS[res] ?? []), ...invalidate])
      await Promise.all([...keys].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      await onSuccess?.(data, vars, ctx, mctx)
    },
  })
}

/** QueryClient with the production defaults from §3.4. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: ENTITY_STALE,
        refetchOnWindowFocus: true,
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  })
}

export { ApiError }
