import { DEVICE_CODE, freqBucket, REDIS_KEYS, spendHourBucket, type StreamEvent } from "@orbit/domain"
import { hashUid, verifyToken, IMPRESSION_TOKEN_TTL_SEC } from "@orbit/domain/node"
import { createRedis } from "@orbit/server-kit"
import request from "supertest"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "../src/app"
import { IndexStore } from "../src/index-store"
import { MemorySink } from "../src/producer"
import { APP, candidate, CMP, CMP_LOW, cfg, clean, EXPIRED, fixtureIndex, GRACE, LIVE, log, PL, PL_PAUSED, PL_WEB, publish, ring, TEST, testRedis, WEB } from "./fixtures"

const redis = testRedis()
const sink = new MemorySink()
const store = new IndexStore(redis, log)
const geo = { country: () => "BD" }
const opts = { log, geo, production: false, defaultCountry: "BD", internalToken: "internal-token-0123456789", sdkMinVersion: "2.0.0", tagPath: "/nonexistent/orbit.js" }
const app = buildApp({ ...opts, deps: { store, redis, sink, cfg, rnd: () => 0.3 } })
const body = (o: object = {}) => ({ placementId: PL, device: { type: "phone", appVersion: "6.2.1" }, uid: "u_1", consent: { personalised: true }, sdkVersion: "2.5.0", ...o })
const serve = (o: object = {}, key: string | null = LIVE, app0 = APP) => {
  const r = request(app).post("/v1/serve").set("x-orbit-app", app0)
  if (key) r.set("x-orbit-key", key)
  return r.send(body(o))
}
const lastSupply = () => sink.events.filter((e) => e.k === "supply").at(-1) as Extract<StreamEvent, { k: "supply" }>

afterAll(async () => {
  await clean(redis)
  redis.disconnect()
})
beforeEach(async () => {
  await clean(redis)
  await publish(redis, fixtureIndex())
  await store.load()
})

describe("readiness", () => {
  it("fails /readyz until an index is loaded", async () => {
    const empty = buildApp({ ...opts, deps: { store: new IndexStore(redis, log), redis, sink, cfg } })
    expect((await request(empty).get("/readyz")).status).toBe(503)
    expect((await request(app).get("/readyz")).status).toBe(200)
  })
  it("keeps the last good index when a load fails", async () => {
    const v = store.current!.index.version
    expect(await store.load("missing-version")).toBe(false)
    expect(store.current!.index.version).toBe(v)
  })
})

describe("authentication", () => {
  it("accepts live, test and in-grace keys", async () => {
    expect((await serve()).status).toBe(200)
    expect((await serve({}, GRACE)).status).toBe(200)
    const t = await serve({}, TEST)
    expect(t.status).toBe(200)
    expect(t.body.ad.test).toBe(true) // test keys force test mode
    expect(lastSupply()).toMatchObject({ t: 1, sample: 1 })
  })
  it("rejects expired grace, unknown and missing keys and unknown apps", async () => {
    expect((await serve({}, EXPIRED)).status).toBe(401)
    expect((await serve({}, "ok_live_nope")).status).toBe(401)
    expect((await serve({}, null)).status).toBe(401)
    expect((await serve({}, LIVE, "prp_nope0000")).status).toBe(401)
  })
  it("authenticates web properties by Origin and reflects CORS", async () => {
    const ok = await request(app).post("/v1/serve").set("x-orbit-app", WEB).set("origin", "https://news.example.com").send(body({ placementId: PL_WEB, device: { type: "desktop" } }))
    expect(ok.status).toBe(200)
    expect(ok.headers["access-control-allow-origin"]).toBe("https://news.example.com")
    expect(ok.headers["access-control-allow-credentials"]).toBeUndefined()
    const bad = await request(app).post("/v1/serve").set("x-orbit-app", WEB).set("origin", "https://evil-example.com").send(body({ placementId: PL_WEB }))
    expect(bad.status).toBe(403)
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined()
    const local = await request(app).post("/v1/serve").set("x-orbit-app", WEB).set("origin", "http://localhost:5173").send(body({ placementId: PL_WEB }))
    expect(local.status).toBe(200)
    const pre = await request(app).options("/v1/serve").set("origin", "https://example.com").set("access-control-request-method", "POST")
    expect(pre.status).toBe(204)
    expect(pre.headers["access-control-allow-origin"]).toBe("https://example.com")
  })
})

describe("decision", () => {
  it("serves with signed tracking and click tokens", async () => {
    const r = await serve()
    expect(r.status).toBe(200)
    const imp = r.body.ad.tracking.impression as string
    expect(imp.startsWith("http://t.test/t/imp/")).toBe(true)
    const v = verifyToken(imp.split("/").pop()!, ring, IMPRESSION_TOKEN_TTL_SEC)
    expect(v.ok && v.payload).toMatchObject({ c: CMP, p: APP, pl: PL, cc: "BD", dv: "ph", pf: "an", f: "banner", cpi: 1800, u: hashUid("u_1", cfg.uidPepper) })
    const click = verifyToken((r.body.ad.click.url as string).split("/c/")[1], ring, 600)
    expect(click.ok && click.payload.d).toBe("https://example.com/land?utm_source=orbit")
    expect(lastSupply()).toMatchObject({ result: "filled", p: APP, pl: PL, dv: DEVICE_CODE.phone })
    // freq counter incremented after the response
    await new Promise((r) => setTimeout(r, 50))
    const k = REDIS_KEYS.freq(hashUid("u_1", cfg.uidPepper), CMP, freqBucket("day", Date.now(), "Asia/Dhaka"))
    expect(await redis.get(k)).toBe("1")
  })

  it("reports no-fill reasons", async () => {
    const country = await serve().set("x-orbit-debug-country", "PK")
    expect(country.status).toBe(204)
    expect(country.headers["x-orbit-no-fill"]).toBe("country")
    expect(lastSupply()).toMatchObject({ result: "no_fill", reason: "country", cc: "PK" })
    expect((await serve({ placementId: PL_PAUSED })).headers["x-orbit-no-fill"]).toBe("paused_placement")
    expect((await serve({ placementId: "plc_unknown" })).headers["x-orbit-no-fill"]).toBe("unknown_placement")
    await publish(redis, fixtureIndex([candidate({ startMs: Date.now() + 3600_000 })]))
    await store.load()
    expect((await serve()).headers["x-orbit-no-fill"]).toBe("schedule")
  })

  it("applies frequency caps only with consent", async () => {
    const k = REDIS_KEYS.freq(hashUid("u_1", cfg.uidPepper), CMP, freqBucket("day", Date.now(), "Asia/Dhaka"))
    await redis.set(k, "3")
    const capped = await serve()
    expect(capped.status).toBe(204)
    expect(capped.headers["x-orbit-no-fill"]).toBe("capped")
    expect((await serve({ consent: { personalised: false } })).status).toBe(200) // contextual, no caps
  })

  it("falls back to the lower tier when the top campaign is capped", async () => {
    await publish(redis, fixtureIndex([candidate({ priority: 3 }), candidate({ campaignId: CMP_LOW, priority: 1, freqCap: null })]))
    await store.load()
    await redis.set(REDIS_KEYS.freq(hashUid("u_1", cfg.uidPepper), CMP, freqBucket("day", Date.now(), "Asia/Dhaka")), "9")
    const r = await serve()
    expect(r.body.ad.campaignId).toBe(CMP_LOW)
  })

  it("paces: budget exhausted and even hourly allowance", async () => {
    await redis.set(REDIS_KEYS.spend(CMP), "100000000")
    expect((await serve()).headers["x-orbit-no-fill"]).toBe("paced")
    await redis.del(REDIS_KEYS.spend(CMP))
    await publish(redis, fixtureIndex([candidate({ pacing: "even" })]))
    await store.load()
    expect((await serve()).status).toBe(200)
    // ~100 $ over ~11 days ≈ 0.38 $/h; 1 $ spent this hour → paced
    await redis.set(REDIS_KEYS.spend(CMP), "1000000")
    await redis.set(REDIS_KEYS.spendHour(CMP, spendHourBucket(Date.now())), "1000000")
    expect((await serve()).headers["x-orbit-no-fill"]).toBe("paced")
  })

  it("serves without caps when Redis is down (degraded mode)", async () => {
    const down = createRedis("redis://localhost:1/15", { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0 })
    down.on("error", () => {})
    const degraded = buildApp({ ...opts, deps: { store, redis: down, sink, cfg, rnd: () => 0.3 } })
    await redis.set(REDIS_KEYS.freq(hashUid("u_1", cfg.uidPepper), CMP, freqBucket("day", Date.now(), "Asia/Dhaka")), "9")
    const r = await request(degraded).post("/v1/serve").set("x-orbit-app", APP).set("x-orbit-key", LIVE).send(body())
    expect(r.status).toBe(200)
    down.disconnect()
  })
})

describe("internal + config", () => {
  it("runs a test request with the API contract", async () => {
    expect((await request(app).post("/internal/test-serve").send({ propertyId: APP })).status).toBe(401)
    const r = await request(app).post("/internal/test-serve").set("x-orbit-internal", opts.internalToken).send({ propertyId: APP })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ propertyId: APP, placementId: PL, placementName: "Home banner", country: "BD", result: "200 Served (test)", sdk: null })
    expect(typeof r.body.latencyMs).toBe("number")
    expect(lastSupply()).toMatchObject({ t: 1, sample: 1 })
    const nf = await request(app).post("/internal/test-serve").set("x-orbit-internal", opts.internalToken).send({ propertyId: APP, placementId: PL_PAUSED })
    expect(nf.body.result).toBe("204 No fill: paused_placement (test)")
  })
  it("returns remote config", async () => {
    const r = await request(app).get(`/v1/config?app=${APP}`)
    expect(r.body).toMatchObject({ app: APP, disabled: false, killSwitch: false, sdkMinVersion: "2.0.0" })
    expect(r.body.placements[PL]).toMatchObject({ active: true, refreshSec: 60 })
  })
  it("rejects bad bodies", async () => {
    expect((await request(app).post("/v1/serve").set("x-orbit-app", APP).set("x-orbit-key", LIVE).send({ nope: 1 })).status).toBe(400)
  })
})
