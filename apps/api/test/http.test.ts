/** Optimistic concurrency, idempotency keys, problem+json errors and operator-injection defences. */
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { campaignBody, harness, inventory, ORIGIN, propertyBody, type Harness } from "./helpers"

let h: Harness
let inv: Awaited<ReturnType<typeof inventory>>
beforeAll(async () => {
  h = await harness()
  inv = await inventory(h)
})
afterAll(() => h?.close())

describe("optimistic concurrency", () => {
  it("two patches with the same rev: the second gets 409 with the current document", async () => {
    const p = (await h.as.owner.get(`/v1/properties/${inv.propertyId}`)).body
    const a = await h.as.owner.patch(`/v1/properties/${p.id}`).set("Origin", ORIGIN).send({ rev: p.rev, name: "First editor wins" })
    expect(a.status).toBe(200)
    expect(a.body.rev).toBe(p.rev + 1)
    const b = await h.as.admin.patch(`/v1/properties/${p.id}`).set("Origin", ORIGIN).send({ rev: p.rev, name: "Second editor loses" })
    expect(b.status).toBe(409)
    expect(b.body.code).toBe("conflict")
    expect(b.body.current).toMatchObject({ id: p.id, name: "First editor wins", rev: p.rev + 1 })
  })

  it("campaign patches are rev-guarded too", async () => {
    const c = (await h.as.owner.post("/v1/campaigns").set("Origin", ORIGIN).send(campaignBody(inv))).body
    const [x, y] = await Promise.all([
      h.as.owner.patch(`/v1/campaigns/${c.id}`).set("Origin", ORIGIN).send({ rev: c.rev, priority: 3 }),
      h.as.campaign_manager.patch(`/v1/campaigns/${c.id}`).set("Origin", ORIGIN).send({ rev: c.rev, priority: 1 }),
    ])
    expect([x.status, y.status].sort()).toEqual([200, 409])
  })

  it("unique violations map to 409 with a helpful message", async () => {
    const body = campaignBody({ ...inv, name: "Unique Name Campaign" })
    expect((await h.as.owner.post("/v1/campaigns").set("Origin", ORIGIN).send(body)).status).toBe(201)
    const dup = await h.as.owner.post("/v1/campaigns").set("Origin", ORIGIN).send({ ...body, name: "unique name CAMPAIGN" })
    expect(dup.status).toBe(409)
    expect(dup.body.detail).toBe("Another campaign already uses this name.")
    const prop = propertyBody({ identifier: inv.property.identifier })
    const pdup = await h.as.owner.post("/v1/properties").set("Origin", ORIGIN).send(prop)
    expect(pdup.status).toBe(409)
    expect(pdup.body.detail).toMatch(/already registered/)
  })
})

describe("idempotency", () => {
  it("same key twice → same response and one resource", async () => {
    const body = campaignBody(inv)
    const key = `idem-${Date.now()}-abcdef`
    const a = await h.as.owner.post("/v1/campaigns").set("Origin", ORIGIN).set("Idempotency-Key", key).send(body)
    const b = await h.as.owner.post("/v1/campaigns").set("Origin", ORIGIN).set("Idempotency-Key", key).send(body)
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(b.body).toEqual(a.body)
    expect(b.headers["idempotent-replayed"]).toBe("true")
    expect(await h.db.models.Campaign.countDocuments({ name: body.name })).toBe(1)
  })

  it("same key with a different body → 422", async () => {
    const key = `idem-${Date.now()}-zzzzzz`
    expect((await h.as.owner.post("/v1/campaigns").set("Origin", ORIGIN).set("Idempotency-Key", key).send(campaignBody(inv))).status).toBe(201)
    const res = await h.as.owner.post("/v1/campaigns").set("Origin", ORIGIN).set("Idempotency-Key", key).send(campaignBody(inv))
    expect(res.status).toBe(422)
    expect(res.body.code).toBe("idempotency_mismatch")
  })

  it("keys are scoped per user", async () => {
    const key = `idem-${Date.now()}-shared`
    const a = await h.as.owner.post(`/v1/properties/${inv.propertyId}/keys`).set("Origin", ORIGIN).set("Idempotency-Key", key).send({ env: "live", label: "Live key" })
    const b = await h.as.admin.post(`/v1/properties/${inv.propertyId}/keys`).set("Origin", ORIGIN).set("Idempotency-Key", key).send({ env: "live", label: "Live key" })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(b.body.key.id).not.toBe(a.body.key.id)
  })
})

describe("errors and input hardening", () => {
  it("validation errors are problem+json with field paths", async () => {
    const res = await h.as.owner.post("/v1/placements").set("Origin", ORIGIN).send({ propertyId: inv.propertyId, name: "x", format: "banner", size: "320x50", bogus: 1 })
    expect(res.status).toBe(400)
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/)
    expect(res.body).toMatchObject({ type: expect.stringContaining("/problems/bad_request"), title: "Bad request", status: 400, code: "bad_request" })
    expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(["name"]))
    expect(res.body.requestId).toBeTruthy()
  })

  it("query operator injection is rejected (?status[$ne]=x → 400)", async () => {
    const res = await h.as.owner.get("/v1/campaigns?status[$ne]=archived")
    expect(res.status).toBe(400)
    const res2 = await h.as.owner.get("/v1/placements?propertyId[$gt]=")
    expect(res2.status).toBe(400)
    const res3 = await h.as.owner.get("/v1/audit?targetId[$ne]=x")
    expect(res3.status).toBe(400)
  })

  it("body operator injection is rejected", async () => {
    const res = await request(h.app).post("/v1/auth/dev-login").set("Origin", ORIGIN).send({ email: { $ne: null } })
    expect(res.status).toBe(400)
  })

  it("unknown ids are 404, unknown routes are 404 problem+json", async () => {
    expect((await h.as.owner.get("/v1/campaigns/cmp_01J9ZZZZZZZZZZZZZZZZZZZZZZ")).status).toBe(404)
    const r = await h.as.owner.get("/v1/nope")
    expect(r.status).toBe(404)
    expect(r.body.code).toBe("not_found")
  })

  it("malformed JSON is a 400", async () => {
    const r = await h.as.owner.post("/v1/events").set("Origin", ORIGIN).set("Content-Type", "application/json").send('{"key":')
    expect(r.status).toBe(400)
  })

  it("rate limits answer 429 problem+json", async () => {
    // per user: the six sign-ins in the harness are counted per IP, the analyst's reads per user
    const t = await harness({ RATE_LIMIT_ADMIN_PER_MIN: "8" })
    try {
      const codes: number[] = []
      for (let i = 0; i < 10; i++) codes.push((await t.as.analyst.get("/v1/countries")).status)
      expect(codes.slice(0, 8).every((c) => c === 200)).toBe(true)
      expect(codes[9]).toBe(429)
      expect((await t.as.owner.get("/v1/countries")).status).toBe(200)
    } finally {
      await t.close()
    }
  })
})
