/**
 * Collector HTTP layer (§5.2, §7.3): verify signed tokens, dedupe in Redis, filter known bots, produce to
 * events.v1 and answer only after the broker acks. No MongoDB.
 *
 * Redis down → dedupe is skipped (events accepted) and downstream idempotency takes over: rollups are
 * exactly-once per stream offset, conversions dedupe on `clickId:event`, clicks on clickId. A replayed beacon
 * during a Redis outage can therefore be counted twice in delivery rollups; the window is bounded by the outage.
 */
import { APP_HEADER, BEACON_TYPES, findKey, KEY_HEADER, newId, originAllowed, REDIS_KEYS, zBeaconBatch, zConversionBatch, zHeartbeat, type BeaconType, type StreamEvent } from "@orbit/domain"
import { CLICK_TOKEN_TTL_SEC, hashKeySecret, IMPRESSION_TOKEN_TTL_SEC, verifyToken, type TrackingPayload, type TrackingSecrets } from "@orbit/domain/node"
import { createApp, finalizeApp, metrics, type Logger, type Redis } from "@orbit/server-kit"
import express, { type Express, type Request, type Response } from "express"
import type { PropertyDirectory } from "./keys"
import type { AckedProducer } from "./producer"

export interface CollectorOptions {
  log: Logger
  redis: Redis
  producer: AckedProducer
  directory: PropertyDirectory
  ring: TrackingSecrets
  keyPepper: string
  production: boolean
  redisTimeoutMs?: number
}

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
export const BOT_UA = /bot\b|bot\/|crawler|spider|crawling|slurp|headlesschrome|phantomjs|lighthouse|pingdom|uptimerobot|facebookexternalhit|python-requests|go-http-client|wget\/|curl\//i
const DEDUPE_TTL_SEC = 86_400
const MAX_SKEW_MS = 5 * 60_000

type DeliveryKind = BeaconType
const isBeaconType = (t: string): t is BeaconType => (BEACON_TYPES as readonly string[]).includes(t)

export function buildApp(o: CollectorOptions): Express {
  const { log, redis, producer, directory } = o
  const allowLocal = !o.production
  const app = createApp({
    name: "collector", log, jsonLimit: "64kb", quietHttpLog: true, helmet: false,
    // beacons are signed, so a permissive CORS policy without credentials is fine
    cors: { origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["content-type", APP_HEADER, KEY_HEADER], maxAge: 600 },
  })
  const timeout = o.redisTimeoutMs ?? 50

  /** SET NX dedupe. true = first time; Redis problems → true (accept; downstream idempotency). */
  async function firstTime(type: string, requestId: string, value = "1"): Promise<true | string | false> {
    if (redis.status !== "ready") {
      metrics.inc("collector_dedupe_skipped", { reason: "redis_down" })
      return true
    }
    try {
      const r = await Promise.race([redis.set(REDIS_KEYS.dedupe(type, requestId), value, "EX", DEDUPE_TTL_SEC, "NX"), new Promise<"timeout">((res) => setTimeout(() => res("timeout"), timeout))])
      if (r === "timeout") {
        metrics.inc("collector_dedupe_skipped", { reason: "timeout" })
        return true
      }
      if (r === "OK") return true
      return value === "1" ? false : ((await redis.get(REDIS_KEYS.dedupe(type, requestId)).catch(() => null)) ?? false)
    } catch {
      metrics.inc("collector_dedupe_skipped", { reason: "error" })
      return true
    }
  }
  const release = (keys: [string, string][]) => {
    if (keys.length && redis.status === "ready") redis.del(...keys.map(([t, r]) => REDIS_KEYS.dedupe(t, r))).catch(() => {})
  }

  const isBot = (req: Request) => BOT_UA.test(req.header("user-agent") ?? "")

  function deliveryEvent(kind: DeliveryKind, p: TrackingPayload, clientAt: number | undefined, now: number): StreamEvent {
    // receive time, unless the SDK's queued timestamp is plausible (after issue, not in the future)
    const at = clientAt && clientAt >= p.ts * 1000 - MAX_SKEW_MS && clientAt <= now + MAX_SKEW_MS ? Math.min(clientAt, now) : now
    return { k: kind, id: newId("request"), at, r: p.r, cpi: kind === "imp" ? p.cpi : 0, c: p.c, cr: p.cr, p: p.p, pl: p.pl, cc: p.cc, dv: p.dv, pf: p.pf, f: p.f, ...(p.t ? { t: 1 as const } : {}) }
  }

  /** Verify + dedupe beacons; returns events to produce and the dedupe keys taken. */
  async function accept(items: { type: string; token: string; at?: number }[], now: number) {
    const events: StreamEvent[] = []
    const taken: [string, string][] = []
    for (const it of items) {
      if (!isBeaconType(it.type)) {
        metrics.inc("collector_events", { result: "bad_type" })
        continue
      }
      const v = verifyToken(it.token, o.ring, IMPRESSION_TOKEN_TTL_SEC, Math.floor(now / 1000))
      if (!v.ok) {
        metrics.inc("collector_events", { result: "invalid_token", reason: v.error })
        continue
      }
      if (!(await firstTime(it.type, v.payload.r))) {
        metrics.inc("collector_events", { result: "duplicate", type: it.type })
        continue
      }
      taken.push([it.type, v.payload.r])
      events.push(deliveryEvent(it.type, v.payload, it.at, now))
    }
    return { events, taken }
  }

  async function produce(res: Response, events: StreamEvent[], taken: [string, string][], ok: () => void) {
    if (!events.length) return ok()
    try {
      await producer.send(events)
      for (const e of events) metrics.inc("collector_events", { result: "accepted", type: e.k })
      ok()
    } catch {
      release(taken) // let the SDK's retry through
      res.setHeader("Retry-After", "5")
      res.status(503).json({ code: "unavailable", detail: "Event stream unavailable; retry later." })
    }
  }

  // sendBeacon posts text/plain (no preflight): parse it as JSON too
  app.post("/v1/e", express.text({ type: "text/plain", limit: "64kb" }), async (req, res) => {
    let raw: unknown = req.body
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw)
      } catch {
        return res.status(400).json({ code: "bad_request" })
      }
    }
    const b = zBeaconBatch.safeParse(raw)
    if (!b.success) return res.status(400).json({ code: "bad_request", errors: b.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })) })
    if (isBot(req)) {
      metrics.inc("collector_events", { result: "bot" }, b.data.events.length)
      return res.status(204).end()
    }
    const { events, taken } = await accept(b.data.events, Date.now())
    await produce(res, events, taken, () => res.status(204).end())
  })

  // Pixel fallback: GET /t/<type>/<token> → 1×1 GIF
  app.get("/t/:type/:token", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0")
    const send = () => res.status(200).type("image/gif").send(GIF)
    if (isBot(req)) {
      metrics.inc("collector_events", { result: "bot" })
      return send()
    }
    const { events, taken } = await accept([{ type: String(req.params.type), token: String(req.params.token) }], Date.now())
    await produce(res, events, taken, send)
  })

  // Click redirect: verify (7 d) → clickId → clk event → 302 to the token destination
  app.get("/c/:token", async (req, res) => {
    res.setHeader("Cache-Control", "no-store")
    const now = Date.now()
    const v = verifyToken(String(req.params.token), o.ring, CLICK_TOKEN_TTL_SEC, Math.floor(now / 1000))
    if (!v.ok) {
      metrics.inc("collector_events", { result: "invalid_token", reason: v.error, type: "clk" })
      return res.status(404).type("text/plain").send("This link has expired.")
    }
    const dest = v.payload.d ?? ""
    if (!/^https?:\/\//i.test(dest) && !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(dest)) return res.status(404).type("text/plain").send("This ad has no destination.")
    if (/^(javascript|data|vbscript|file):/i.test(dest)) return res.status(404).end()
    let clickId = newId("click")
    if (!isBot(req)) {
      const first = await firstTime("clk", v.payload.r, clickId)
      if (first === true) {
        const e: StreamEvent = { k: "clk", id: newId("request"), at: now, r: v.payload.r, clickId, c: v.payload.c, cr: v.payload.cr, p: v.payload.p, pl: v.payload.pl, cc: v.payload.cc, dv: v.payload.dv, pf: v.payload.pf, f: v.payload.f, ...(v.payload.u ? { u: v.payload.u } : {}), ...(v.payload.t ? { t: 1 as const } : {}) }
        try {
          await producer.send([e])
          metrics.inc("collector_events", { result: "accepted", type: "clk" })
        } catch {
          // the user still gets their destination; the click is lost (counted) rather than blocking navigation
          metrics.inc("collector_events", { result: "lost", type: "clk" })
          release([["clk", v.payload.r]])
        }
      } else if (typeof first === "string") {
        clickId = first // repeat click on the same ad: same clickId, counted once
        metrics.inc("collector_events", { result: "duplicate", type: "clk" })
      }
    } else metrics.inc("collector_events", { result: "bot", type: "clk" })
    res.redirect(302, withClickId(dest, clickId))
  })

  /** Server-to-server conversions: live property key required. */
  app.post("/v1/conversions", async (req, res) => {
    const props = directory.properties
    if (!props) return res.status(503).json({ code: "not_ready" })
    const prop = props[req.header(APP_HEADER) ?? ""]
    const secret = req.header(KEY_HEADER)
    const key = prop && secret ? findKey(prop, hashKeySecret(secret, o.keyPepper), Date.now()) : null
    if (!prop || !key || key.env !== "live") return res.status(401).json({ code: "invalid_key" })
    const b = zConversionBatch.safeParse(req.body)
    if (!b.success) return res.status(400).json({ code: "bad_request", errors: b.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })) })
    const now = Date.now()
    const events: StreamEvent[] = b.data.conversions.map((c) => ({ k: "conv", id: newId("request"), at: c.at && c.at <= now + MAX_SKEW_MS ? Math.min(c.at, now) : now, clickId: c.clickId, event: c.event, valueMicros: c.valueMicros, source: "server" }))
    await produce(res, events, [], () => res.status(202).json({ accepted: events.length }))
  })

  /** SDK heartbeat: app key or web origin. */
  app.post("/v1/heartbeat", async (req, res) => {
    const props = directory.properties
    if (!props) return res.status(503).json({ code: "not_ready" })
    const prop = props[req.header(APP_HEADER) ?? ""]
    if (!prop) return res.status(401).json({ code: "unknown_app" })
    const secret = req.header(KEY_HEADER)
    const ok = secret ? !!findKey(prop, hashKeySecret(secret, o.keyPepper), Date.now()) : prop.platform === "web" && originAllowed(prop.identifier, req.header("origin"), allowLocal)
    if (!ok) return res.status(secret ? 401 : 403).json({ code: "unauthorized" })
    const b = zHeartbeat.safeParse(req.body)
    if (!b.success) return res.status(400).json({ code: "bad_request" })
    const e: StreamEvent = { k: "hb", id: newId("request"), at: Date.now(), p: prop.id, sdk: b.data.sdkVersion, testMode: b.data.testMode }
    await produce(res, [e], [], () => res.status(204).end())
  })

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true })
  })
  app.get("/readyz", (_req, res) => {
    const ok = producer.ready()
    res.status(ok ? 200 : 503).json({ ok, kafka: producer.ready(), redis: redis.status, index: directory.version })
  })

  finalizeApp(app, log)
  return app
}

/** Append `orbit_click=<id>` to https URLs and deep links (preserving any #fragment). */
export function withClickId(dest: string, clickId: string): string {
  const hash = dest.indexOf("#")
  const base = hash >= 0 ? dest.slice(0, hash) : dest
  const frag = hash >= 0 ? dest.slice(hash) : ""
  return `${base}${base.includes("?") ? "&" : "?"}orbit_click=${encodeURIComponent(clickId)}${frag}`
}
