/**
 * Typed API client derived from the contract in `@orbit/domain` (guideline §3.4, §7.1).
 * No codegen: endpoint names, params, bodies and responses are all inferred from `endpoints`.
 */
import { buildPath, endpoints, type Body, type EndpointName, type Problem, type Query, type Res } from "@orbit/domain"

/** `"/v1/campaigns/:id/keys/:keyId"` → `{ id: string; keyId: string }` */
export type PathParams<P extends string> = P extends `${string}:${infer K}/${infer Rest}` ? { [k in K | keyof PathParams<`/${Rest}`>]: string } : P extends `${string}:${infer K}` ? { [k in K]: string } : Record<never, never>

type EP<N extends EndpointName> = (typeof endpoints)[N]
type HasKeys<T> = keyof T extends never ? false : true

export type CallArgs<N extends EndpointName> = (HasKeys<PathParams<EP<N>["path"]>> extends true ? { params: PathParams<EP<N>["path"]> } : { params?: undefined }) &
  ([Body<N>] extends [never] ? { body?: undefined } : { body: Body<N> }) &
  ([Query<N>] extends [never] ? { query?: undefined } : { query?: Query<N> }) & {
    /** Sent as Idempotency-Key on endpoints marked idempotent (generated when omitted). */
    idempotencyKey?: string
    signal?: AbortSignal
  }

/** Problem+json error from the API. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public problem: Problem,
  ) {
    super(problem.detail ?? problem.title)
  }
  get code() {
    return this.problem.code
  }
  /** Latest server copy on a 409 concurrency conflict. */
  get current() {
    return this.problem.current
  }
  /** Field errors keyed by path. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.errors ?? []).map((e) => [e.path, e.message]))
  }
}

export interface ClientOptions {
  baseUrl: string
  fetch?: typeof fetch
  /** Validate responses against the contract (development only; production skips for speed). */
  parseResponses?: boolean
  /** Called on 401 (e.g. redirect to sign-in). */
  onUnauthorized?: () => void
}

function toSearch(query: Record<string, unknown> | undefined) {
  if (!query) return ""
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === "") continue
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)))
    else sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

export function createClient(o: ClientOptions) {
  const f = o.fetch ?? globalThis.fetch.bind(globalThis)

  async function call<N extends EndpointName>(name: N, args: CallArgs<N> = {} as CallArgs<N>): Promise<Res<N>> {
    const ep = endpoints[name] as EP<N> & { idempotent?: boolean }
    const a = args as { params?: Record<string, string>; body?: unknown; query?: Record<string, unknown>; idempotencyKey?: string; signal?: AbortSignal }
    const url = o.baseUrl.replace(/\/$/, "") + buildPath(ep.path, a.params) + toSearch(a.query)
    const headers: Record<string, string> = { accept: "application/json" }
    if (a.body !== undefined) headers["content-type"] = "application/json"
    if (ep.idempotent) headers["idempotency-key"] = a.idempotencyKey ?? uuid()
    const res = await f(url, { method: ep.method, headers, body: a.body !== undefined ? JSON.stringify(a.body) : ep.method === "GET" ? undefined : "{}", credentials: "include", signal: a.signal })
    if (res.status === 401) o.onUnauthorized?.()
    const isJson = (res.headers.get("content-type") ?? "").includes("json")
    if (!res.ok) {
      const problem: Problem = isJson ? await res.json() : { type: "about:blank", title: res.statusText, status: res.status, code: "http_error", detail: await res.text() }
      throw new ApiError(res.status, problem)
    }
    if (!isJson) return (await res.text()) as Res<N>
    const data = await res.json()
    if (o.parseResponses) {
      const r = ep.response.safeParse(data)
      if (!r.success) {
        console.error(`[api-client] ${name} response does not match the contract`, r.error.issues.slice(0, 5))
        throw new Error(`Contract drift in ${name}: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`)
      }
      return r.data as Res<N>
    }
    return data as Res<N>
  }

  /** Download helper for CSV exports (POST body, file response). */
  async function download(name: "analyticsExport", body: Body<"analyticsExport">, fileName: string) {
    const ep = endpoints[name]
    const res = await f(o.baseUrl.replace(/\/$/, "") + ep.path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "include" })
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({ title: res.statusText, status: res.status, code: "http_error" }))) as Problem)
    const blob = await res.blob()
    const href = URL.createObjectURL(blob)
    const el = document.createElement("a")
    el.href = href
    el.download = fileName
    el.click()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  }

  /** PUT a file to a pre-signed upload ticket. */
  async function upload(ticket: Res<"createUpload">, file: Blob) {
    const res = await f(ticket.url, { method: ticket.method, headers: ticket.headers, body: file, credentials: ticket.url.startsWith(o.baseUrl) ? "include" : "omit" })
    if (!res.ok) throw new Error(`Upload failed (${res.status})`)
    return ticket.publicUrl
  }

  return { call, download, upload }
}

export type ApiClient = ReturnType<typeof createClient>
