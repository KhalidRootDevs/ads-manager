import { randomBytes } from "node:crypto"
import { gzipSync } from "node:zlib"
import { REDIS_KEYS, SERVING, type ServingIndex, type StreamEvent } from "@orbit/domain"
import { hashKeySecret, parseSecrets, signToken, type TrackingPayload } from "@orbit/domain/node"
import { createLogger, createRedis } from "@orbit/server-kit"
import request from "supertest"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp, withClickId } from "../src/app"
import { PropertyDirectory } from "../src/keys"
import type { AckedProducer } from "../src/producer"

const log = createLogger("test", "silent")
const ring = parseSecrets("k1:test-tracking-secret-0123456789,k0:old-secret-0123456789", "k1")
const PEPPER = "test-key-pepper-0123456789"
const LIVE = "ok_live_COLLECTORKEY0000000000000000000000"
const TESTKEY = "ok_test_COLLECTORKEY0000000000000000000000"
const APP = "prp_01K00000000000000000000APP"
const WEB = "prp_01K00000000000000000000WEB"
const redis = createRedis("redis://localhost:6379/15", { keyPrefix: `col${randomBytes(4).toString("hex")}:` })

class MockProducer implements AckedProducer {
  sent: StreamEvent[] = []
  up = true
  async send(e: StreamEvent[]) {
    if (!this.up) throw new Error("kafka unavailable")
    this.sent.push(...e)
  }
  ready() {
    return this.up
  }
  async close() {}
}
const producer = new MockProducer()
const directory = new PropertyDirectory(redis, log)
const app = buildApp({ log, redis, producer, directory, ring, keyPepper: PEPPER, production: false })

let n = 0
const payload = (o: Partial<TrackingPayload> = {}): TrackingPayload => ({ r: `req_${Date.now()}_${n++}`, c: "cmp_1", cr: "crv_1", p: APP, pl: "plc_1", cc: "BD", dv: "ph", pf: "an", f: "banner", ts: Math.floor(Date.now() / 1000), cpi: 1800, ...o })
const tok = (o: Partial<TrackingPayload> = {}) => signToken(payload(o), ring)

beforeAll(async () => {
  const idx: ServingIndex = {
    version: "v1", builtAt: new Date().toISOString(), killSwitch: false, ecpm: {}, placements: {},
    properties: {
      [APP]: { id: APP, platform: "android", identifier: "com.test.app", active: true, testMode: false, keys: [
        { id: "key_1", hash: hashKeySecret(LIVE, PEPPER), env: "live", status: "active", graceUntil: null },
        { id: "key_2", hash: hashKeySecret(TESTKEY, PEPPER), env: "test", status: "active", graceUntil: null },
      ] },
      [WEB]: { id: WEB, platform: "web", identifier: "example.com", active: true, testMode: false, keys: [] },
    },
  }
  await redis.set(SERVING.index("v1"), gzipSync(JSON.stringify(idx)))
  await redis.set(SERVING.current, "v1")
  await directory.load()
})
afterAll(async () => {
  const keys = await redis.keys("*")
  const raw = createRedis("redis://localhost:6379/15")
  const prefix = redis.options.keyPrefix!
  if (keys.length) await raw.del(...keys.filter((k) => k.startsWith(prefix)))
  raw.disconnect()
  redis.disconnect()
})
beforeEach(() => {
  producer.sent = []
  producer.up = true
})

describe("beacons", () => {
  it("accepts valid tokens (JSON and text/plain sendBeacon) and dedupes per type × request", async () => {
    const t = tok()
    const r = await request(app).post("/v1/e").send({ events: [{ type: "imp", token: t }, { type: "view", token: t }] })
    expect(r.status).toBe(204)
    expect(producer.sent.map((e) => e.k)).toEqual(["imp", "view"])
    expect(producer.sent[0]).toMatchObject({ c: "cmp_1", cpi: 1800, dv: "ph" })
    expect(producer.sent[1]).toMatchObject({ cpi: 0 })
    const dup = await request(app).post("/v1/e").set("content-type", "text/plain;charset=UTF-8").send(JSON.stringify({ events: [{ type: "imp", token: t }] }))
    expect(dup.status).toBe(204)
    expect(producer.sent).toHaveLength(2)
  })

  it("verifies tokens with key rotation and rejects tampered, expired and unknown-kid tokens", async () => {
    const old = signToken(payload(), { active: "k0", secrets: ring.secrets })
    const t = tok()
    const [kid, body, sig] = t.split(".")
    const tampered = `${kid}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), cpi: 999999 })).toString("base64url")}.${sig}`
    const expired = tok({ ts: Math.floor(Date.now() / 1000) - 25 * 3600 })
    const unknown = signToken(payload(), { active: "k9", secrets: { k9: "zzzzzzzzzzzzzzzz" } })
    const r = await request(app).post("/v1/e").send({ events: [{ type: "imp", token: old }, { type: "imp", token: tampered }, { type: "imp", token: expired }, { type: "imp", token: unknown }] })
    expect(r.status).toBe(204)
    expect(producer.sent).toHaveLength(1)
  })

  it("serves the pixel fallback", async () => {
    const r = await request(app).get(`/t/imp/${tok()}`)
    expect(r.status).toBe(200)
    expect(r.headers["content-type"]).toBe("image/gif")
    expect(r.headers["cache-control"]).toContain("no-store")
    expect(producer.sent).toHaveLength(1)
  })

  it("drops known bots", async () => {
    const r = await request(app).post("/v1/e").set("user-agent", "Googlebot/2.1 (+http://www.google.com/bot.html)").send({ events: [{ type: "imp", token: tok() }] })
    expect(r.status).toBe(204)
    expect(producer.sent).toHaveLength(0)
  })

  it("returns 503 when Kafka is unavailable and lets the retry through", async () => {
    const t = tok()
    producer.up = false
    const r = await request(app).post("/v1/e").send({ events: [{ type: "imp", token: t }] })
    expect(r.status).toBe(503)
    producer.up = true
    await new Promise((res) => setTimeout(res, 20))
    const retry = await request(app).post("/v1/e").send({ events: [{ type: "imp", token: t }] })
    expect(retry.status).toBe(204)
    expect(producer.sent).toHaveLength(1)
  })

  it("rejects oversize batches", async () => {
    const r = await request(app).post("/v1/e").send({ events: Array.from({ length: 51 }, () => ({ type: "imp", token: tok() })) })
    expect(r.status).toBe(400)
  })
})

describe("clicks", () => {
  it("redirects with a clickId, emits clk once per request", async () => {
    const t = signToken({ ...payload(), d: "https://example.com/land?utm_source=orbit" }, ring)
    const r = await request(app).get(`/c/${t}`)
    expect(r.status).toBe(302)
    const loc = new URL(r.headers.location)
    const clickId = loc.searchParams.get("orbit_click")!
    expect(clickId).toMatch(/^clk_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(loc.searchParams.get("utm_source")).toBe("orbit")
    expect(producer.sent[0]).toMatchObject({ k: "clk", clickId })
    const again = await request(app).get(`/c/${t}`)
    expect(new URL(again.headers.location).searchParams.get("orbit_click")).toBe(clickId)
    expect(producer.sent).toHaveLength(1)
  })
  it("supports deep links and rejects bad tokens", async () => {
    expect(withClickId("drmsport://highlights/x", "clk_1")).toBe("drmsport://highlights/x?orbit_click=clk_1")
    expect(withClickId("https://a.com/p?x=1#top", "clk_1")).toBe("https://a.com/p?x=1&orbit_click=clk_1#top")
    expect((await request(app).get("/c/garbage.token.here")).status).toBe(404)
    const js = signToken({ ...payload(), d: "javascript:alert(1)" }, ring)
    expect((await request(app).get(`/c/${js}`)).status).toBe(404)
  })
})

describe("conversions and heartbeat", () => {
  const conv = { conversions: [{ clickId: "clk_01K0000000000000000000000A", event: "trial_start", valueMicros: 1000 }] }
  it("requires a live property key", async () => {
    expect((await request(app).post("/v1/conversions").set("x-orbit-app", APP).set("x-orbit-key", TESTKEY).send(conv)).status).toBe(401)
    expect((await request(app).post("/v1/conversions").set("x-orbit-app", APP).send(conv)).status).toBe(401)
    const ok = await request(app).post("/v1/conversions").set("x-orbit-app", APP).set("x-orbit-key", LIVE).send(conv)
    expect(ok.status).toBe(202)
    expect(producer.sent[0]).toMatchObject({ k: "conv", clickId: conv.conversions[0].clickId, event: "trial_start", source: "server" })
    producer.up = false
    expect((await request(app).post("/v1/conversions").set("x-orbit-app", APP).set("x-orbit-key", LIVE).send(conv)).status).toBe(503)
  })
  it("accepts heartbeats from app keys and web origins", async () => {
    expect((await request(app).post("/v1/heartbeat").set("x-orbit-app", APP).set("x-orbit-key", LIVE).send({ sdkVersion: "2.5.0" })).status).toBe(204)
    expect((await request(app).post("/v1/heartbeat").set("x-orbit-app", WEB).set("origin", "https://www.example.com").send({ sdkVersion: "2.5.0", platform: "web" })).status).toBe(204)
    expect((await request(app).post("/v1/heartbeat").set("x-orbit-app", WEB).set("origin", "https://evil.com").send({ sdkVersion: "2.5.0" })).status).toBe(403)
    expect(producer.sent.map((e) => e.k)).toEqual(["hb", "hb"])
  })
  it("dedupe key format", () => {
    expect(REDIS_KEYS.dedupe("imp", "req_1")).toBe("dd:imp:req_1")
  })
})
