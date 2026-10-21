/**
 * ad-server HTTP layer (§4.1, §7.3). No MongoDB: everything comes from the in-memory serving index and Redis.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { timingSafeEqual } from "node:crypto"
import { APP_HEADER, INTERNAL_HEADER, KEY_HEADER, newId, supplyResultLabel, zServeRequest, type Device, type ServeRequest } from "@orbit/domain"
import { createApp, finalizeApp, metrics, type Logger } from "@orbit/server-kit"
import type { Express, Request, Response } from "express"
import { z } from "zod"
import { anyWebOrigin, authenticate, decide, supplyEvent, touchKey, type Deps } from "./decision"
import type { Geo } from "./geo"

export interface AppOptions {
  log: Logger
  deps: Deps
  geo: Geo
  production: boolean
  defaultCountry: string
  internalToken: string
  sdkMinVersion: string
  /** path to packages/sdk-web/dist/orbit.js */
  tagPath: string
}

const zTestServe = z.object({ propertyId: z.string().min(4).max(40), placementId: z.string().min(4).max(40).nullable().optional() })
const zConfigQuery = z.object({ app: z.string().min(4).max(40) })

const sameToken = (a: string | undefined, b: string) => {
  if (!a) return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const ms = (t0: bigint) => Number(process.hrtime.bigint() - t0) / 1e6

export function buildApp(o: AppOptions): Express {
  const { deps, log } = o
  const allowLocal = !o.production
  const app = createApp({ name: "ad-server", log, jsonLimit: "16kb", quietHttpLog: true, helmet: false })

  /** CORS for /v1/serve and /v1/config: reflect registered web-property origins only, never credentials. */
  const cors = (req: Request, res: Response, propertyId: string | undefined) => {
    const origin = req.header("origin")
    if (!origin) return
    const p = deps.store.current
    const prop = propertyId ? p?.index.properties[propertyId] : undefined
    const ok = prop ? prop.platform === "web" && authenticate(p!, propertyId, undefined, origin, { keyPepper: "", allowLocalOrigins: allowLocal }, Date.now()).ok : anyWebOrigin(p, origin, allowLocal)
    res.setHeader("Vary", "Origin")
    if (!ok) return
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", `content-type, ${APP_HEADER}, ${KEY_HEADER}`)
    res.setHeader("Access-Control-Expose-Headers", "x-orbit-no-fill, x-request-id")
    res.setHeader("Access-Control-Max-Age", "600")
  }
  for (const path of ["/v1/serve", "/v1/config"]) {
    app.options(path, (req, res) => {
      cors(req, res, undefined)
      res.status(204).end()
    })
  }

  const countryOf = (req: Request) => {
    const dbg = req.header("x-orbit-debug-country")
    if (!o.production && dbg && /^[A-Z]{2}$/.test(dbg)) return dbg
    return o.geo.country(req.ip)
  }

  app.post("/v1/serve", async (req, res) => {
    const t0 = process.hrtime.bigint()
    const now = Date.now()
    const appId = req.header(APP_HEADER)
    cors(req, res, appId)
    res.setHeader("Cache-Control", "no-store")
    const p = deps.store.current
    if (!p) {
      metrics.inc("serve_requests", { result: "unavailable" })
      return res.status(503).json({ code: "not_ready" })
    }
    const parsed = zServeRequest.safeParse(req.body)
    if (!parsed.success) {
      metrics.inc("serve_requests", { result: "bad_request" })
      return res.status(400).json({ code: "bad_request", errors: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })) })
    }
    const auth = authenticate(p, appId, req.header(KEY_HEADER), req.header("origin"), { keyPepper: deps.cfg.keyPepper, allowLocalOrigins: allowLocal }, now)
    if (!auth.ok) {
      metrics.inc("serve_requests", { result: auth.code })
      return res.status(auth.status).json({ code: auth.code })
    }
    touchKey(deps.redis, auth.key, now)
    const body: ServeRequest = parsed.data
    const test = body.test || auth.testKey
    const country = countryOf(req)
    let result: "filled" | "no_fill" | "error" = "error"
    let reason: string | null = null
    let requestId = newId("request")
    try {
      const r = await decide(deps, { prop: auth.prop, req: body, country, test, now })
      if (r.filled) {
        result = "filled"
        requestId = r.response.requestId
        res.status(200).json(r.response)
      } else {
        result = "no_fill"
        reason = r.reason
        res.setHeader("x-orbit-no-fill", r.reason)
        res.status(204).end()
      }
    } catch (err) {
      reason = "internal"
      log.error({ err }, "decision failed")
      if (!res.headersSent) res.status(500).json({ code: "internal" })
    }
    const latencyMs = ms(t0)
    metrics.observe("serve_decision_seconds", latencyMs / 1000, { result })
    metrics.inc("serve_requests", { result: result === "no_fill" ? `no_fill:${reason}` : result })
    deps.sink.enqueue(supplyEvent(deps, { requestId, prop: auth.prop, placementId: body.placementId, country, device: body.device.type as Device, result, reason, latencyMs, sdk: body.sdkVersion ?? null, test, now }))
  })

  app.get("/v1/config", (req, res) => {
    const q = zConfigQuery.safeParse(req.query)
    if (!q.success) return res.status(400).json({ code: "bad_request" })
    cors(req, res, q.data.app)
    const p = deps.store.current
    if (!p) return res.status(503).json({ code: "not_ready" })
    const prop = p.index.properties[q.data.app]
    if (!prop) return res.status(404).json({ code: "unknown_app" })
    const placements: Record<string, { active: boolean; format: string; size: string; refreshSec: number | null }> = {}
    for (const pl of Object.values(p.index.placements)) if (pl.propertyId === prop.id) placements[pl.id] = { active: pl.active, format: pl.format, size: pl.size, refreshSec: pl.refreshSec }
    res.setHeader("Cache-Control", "public, max-age=60")
    res.json({ app: prop.id, disabled: p.index.killSwitch || !prop.active, killSwitch: p.index.killSwitch, testMode: prop.testMode, sdkMinVersion: o.sdkMinVersion, placements, configTtlSec: 300, version: p.index.version })
  })

  /** Admin API "Send test request" (contract: apps/api → POST /internal/test-serve). */
  app.post("/internal/test-serve", async (req, res) => {
    if (!sameToken(req.header(INTERNAL_HEADER), o.internalToken)) return res.status(401).json({ code: "unauthorized" })
    const b = zTestServe.safeParse(req.body)
    if (!b.success) return res.status(400).json({ code: "bad_request" })
    const p = deps.store.current
    if (!p) return res.status(503).json({ code: "not_ready" })
    const t0 = process.hrtime.bigint()
    const now = Date.now()
    const at = new Date(now).toISOString()
    const prop = p.index.properties[b.data.propertyId]
    if (!prop) return res.json({ at, propertyId: b.data.propertyId, placementId: b.data.placementId ?? null, placementName: null, country: o.defaultCountry, result: "404 No fill: unknown_property", latencyMs: ms(t0), sdk: null })
    const all = Object.values(p.index.placements).filter((x) => x.propertyId === prop.id)
    const pl = b.data.placementId ? p.index.placements[b.data.placementId] : (all.find((x) => x.active) ?? all[0])
    if (!pl) {
      return res.json({ at, propertyId: prop.id, placementId: b.data.placementId ?? null, placementName: null, country: o.defaultCountry, result: "204 No fill: unknown_placement", latencyMs: ms(t0), sdk: null })
    }
    const cand = pl.candidates.find((c) => c.countries.length)
    const country = cand?.countries[0] ?? o.defaultCountry
    const device: Device = (cand?.devices[0] as Device | undefined) ?? (prop.platform === "web" ? "desktop" : "phone")
    const body: ServeRequest = { placementId: pl.id, device: { type: device }, test: true, sdkVersion: undefined }
    let result: "filled" | "no_fill" | "error" = "error"
    let reason: string | null = null
    let requestId = newId("request")
    try {
      const r = await decide(deps, { prop, req: body, country, test: true, now })
      if (r.filled) {
        result = "filled"
        requestId = r.response.requestId
      } else {
        result = "no_fill"
        reason = r.reason
      }
    } catch (err) {
      reason = "internal"
      log.error({ err }, "test decision failed")
    }
    const latencyMs = Math.round(ms(t0) * 100) / 100
    deps.sink.enqueue(supplyEvent(deps, { requestId, prop, placementId: pl.id, country, device, result, reason, latencyMs, sdk: null, test: true, now }))
    res.json({ at, propertyId: prop.id, placementId: pl.id, placementName: pl.name ?? null, country, result: supplyResultLabel(result, reason, true), latencyMs, sdk: null })
  })

  // Web tag (cached 5 min; re-read when the file changes)
  let tag: { mtime: number; body: Buffer } | null = null
  app.get("/tag/orbit.js", (_req, res) => {
    if (!existsSync(o.tagPath)) return res.status(404).type("text/plain").send("web tag not built: pnpm --filter @orbit/sdk-web build")
    const mtime = statSync(o.tagPath).mtimeMs
    if (!tag || tag.mtime !== mtime) tag = { mtime, body: readFileSync(o.tagPath) }
    res.setHeader("Cache-Control", "public, max-age=300")
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.type("application/javascript").send(tag.body)
  })

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true })
  })
  app.get("/readyz", (_req, res) => {
    const c = deps.store.current
    if (!c) return res.status(503).json({ ok: false, reason: "no serving index loaded" })
    res.json({ ok: true, version: c.index.version, builtAt: c.index.builtAt, redis: deps.redis.status })
  })

  finalizeApp(app, log)
  return app
}
