import { newId, quarterOf, todayKey } from "@orbit/domain"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { campaignBody, harness, inventory, ORIGIN, type Harness } from "./helpers"

let h: Harness
beforeAll(async () => {
  h = await harness()
})
afterAll(() => h?.close())

const send = (role: keyof Harness["as"], method: "post" | "put" | "patch" | "delete", path: string, body: object = {}) => h.as[role][method](path).set("Origin", ORIGIN).send(body)

describe("settings and countries", () => {
  it("creates settings with defaults on first read and audits changes as a sentence", async () => {
    const s = await h.as.analyst.get("/v1/settings")
    expect(s.body).toMatchObject({ reportingTz: "Asia/Dhaka", currency: "USD", defaults: { freqCap: { count: 6, per: "day" }, refreshSec: 60 }, rev: 0 })
    const { updatedAt: _u, currency: _c, reportingTz: _r, ...input } = s.body
    const put = await send("admin", "put", "/v1/settings", { ...input, defaults: { ...input.defaults, freqCap: { count: 4, per: "day" } } })
    expect(put.status).toBe(200)
    expect(put.body.rev).toBe(1)
    expect((await send("admin", "put", "/v1/settings", input)).status).toBe(409)
    const feed = await h.as.analyst.get("/v1/audit?targetId=global")
    expect(feed.body.items[0]).toMatchObject({ action: "settings.changed", detail: "Frequency cap 6/day → 4/day", actor: { name: "Admin" } })
  })

  it("disables a country platform-wide", async () => {
    const res = await send("owner", "patch", "/v1/countries/NP", { enabled: false })
    expect(res.body).toEqual({ code: "NP", name: "Nepal", region: "South Asia", enabled: false })
    expect((await h.as.analyst.get("/v1/audit?targetId=NP")).body.items[0].action).toBe("country.disabled")
    expect((await send("owner", "patch", "/v1/countries/XX", { enabled: false })).status).toBe(404)
  })

  it("events: create, duplicate key 409, deactivate", async () => {
    expect((await send("developer", "post", "/v1/events", { key: "trial_start", name: "Premium trial started", source: "server" })).status).toBe(201)
    expect((await send("developer", "post", "/v1/events", { key: "trial_start", name: "Again", source: "sdk" })).status).toBe(409)
    const off = await send("developer", "patch", "/v1/events/trial_start", { active: false })
    expect(off.body).toMatchObject({ key: "trial_start", active: false })
  })
})

describe("audiences", () => {
  it("deleting an audience removes it from campaigns in the same transaction", async () => {
    const inv = await inventory(h)
    const a = await send("campaign_manager", "post", "/v1/audiences", { name: "Lapsed premium trials", rule: { event: "trial_start", withinDays: 30, exclude: { event: "purchase", withinDays: 30 } } })
    expect(a.status).toBe(201)
    expect(a.body).toMatchObject({ status: "draft", estimate: null, rule: { exclude: { event: "purchase", withinDays: 30 } } })
    const body = campaignBody(inv)
    body.constraints.audienceIds = [a.body.id] as never
    const c = await send("campaign_manager", "post", "/v1/campaigns", body)
    expect(c.body.constraints.audienceIds).toEqual([a.body.id])
    const del = await send("campaign_manager", "delete", `/v1/audiences/${a.body.id}`)
    expect(del.body).toEqual({ ok: true })
    const after = (await h.as.analyst.get(`/v1/campaigns/${c.body.id}`)).body
    expect(after.constraints.audienceIds).toEqual([])
    expect(after.rev).toBe(c.body.rev + 1)
    expect((await h.as.analyst.get("/v1/audiences")).body.items.find((x: { id: string }) => x.id === a.body.id)).toBeUndefined()
    const feed = (await h.as.analyst.get(`/v1/audit?targetId=${a.body.id}`)).body.items
    expect(feed[0]).toMatchObject({ action: "audience.deleted", detail: "Removed from 1 campaign" })
  })
})

describe("budgets", () => {
  it("creates with rev null, updates with rev, defaults to the current quarter", async () => {
    const q = quarterOf(todayKey("Asia/Dhaka"))
    const created = await send("admin", "put", `/v1/budgets/Sports/${q}`, { amountMicros: 30_000_000_000, rev: null })
    expect(created.body).toMatchObject({ team: "Sports", quarter: q, amountMicros: 30_000_000_000, rev: 0 })
    expect((await send("admin", "put", `/v1/budgets/Sports/${q}`, { amountMicros: 1, rev: null })).status).toBe(409)
    const updated = await send("admin", "put", `/v1/budgets/Sports/${q}`, { amountMicros: 40_000_000_000, rev: 0 })
    expect(updated.body.rev).toBe(1)
    const stale = await send("admin", "put", `/v1/budgets/Sports/${q}`, { amountMicros: 5, rev: 0 })
    expect(stale.status).toBe(409)
    expect(stale.body.current.amountMicros).toBe(40_000_000_000)
    const list = await h.as.analyst.get("/v1/budgets")
    expect(list.body.items.map((b: { team: string }) => b.team)).toContain("Sports")
    expect((await h.as.analyst.get("/v1/budgets?quarter=2020-Q1")).body.items).toEqual([])
    const feed = (await h.as.analyst.get(`/v1/audit?targetId=${encodeURIComponent(`Sports:${q}`)}`)).body.items
    expect(feed[0].detail).toBe("$30,000 → $40,000")

    // the team budget feeds campaign validation warnings
    const inv = await inventory(h)
    const big = { ...campaignBody(inv), budget: { amountMicros: 50_000_000_000, pacing: "even", goal: null } }
    const v = await send("campaign_manager", "post", "/v1/campaigns/validate", big)
    expect(v.body.warnings.some((w: { key: string }) => w.key === "budget")).toBe(true)
  })
})

describe("team", () => {
  it("enforces role rules: no self-change, only owners grant owner, last owner stays", async () => {
    expect((await send("owner", "patch", `/v1/team/${h.users.owner.id}`, { role: "admin", rev: 0 })).status).toBe(403)
    expect((await send("admin", "patch", `/v1/team/${h.users.analyst.id}`, { role: "owner", rev: 0 })).status).toBe(403)
    expect((await send("admin", "patch", `/v1/team/${h.users.owner.id}`, { role: "analyst", rev: 0 })).status).toBe(403)
    const changed = await send("admin", "patch", `/v1/team/${h.users.analyst.id}`, { role: "developer", rev: 0 })
    expect(changed.body).toMatchObject({ role: "developer", rev: 1 })
    expect((await h.as.analyst.get(`/v1/audit?targetId=${h.users.analyst.id}`)).body.items[0]).toMatchObject({ action: "role.changed", detail: "Analyst → Developer" })
    await send("admin", "patch", `/v1/team/${h.users.analyst.id}`, { role: "analyst", rev: 1 })
    // only owners touch owners: promote admin to owner, who can then demote the original owner
    const promoted = await send("owner", "patch", `/v1/team/${h.users.admin.id}`, { role: "owner", rev: 0 })
    expect(promoted.body.role).toBe("owner")
    const demoted = await send("admin", "patch", `/v1/team/${h.users.owner.id}`, { role: "admin", rev: 0 })
    expect(demoted.status).toBe(200)
    // admin@ is now the only owner, and the former owner (now an admin) can't change an owner
    expect((await send("owner", "patch", `/v1/team/${h.users.admin.id}`, { role: "analyst", rev: promoted.body.rev })).status).toBe(403)
  })

  it("removing a member disables them and signs them out everywhere", async () => {
    const member = await send("admin", "post", "/v1/team", { email: "leaving.soon@orbit.test", role: "analyst" })
    const agent = request.agent(h.app)
    await agent.post("/v1/auth/dev-login").set("Origin", ORIGIN).send({ email: "leaving.soon@orbit.test" })
    expect((await agent.get("/v1/me")).status).toBe(200)
    const del = await send("admin", "delete", `/v1/team/${member.body.id}`)
    expect(del.body).toEqual({ ok: true })
    expect((await agent.get("/v1/me")).status).toBe(401)
    expect((await h.as.analyst.get("/v1/team")).body.items.find((u: { id: string }) => u.id === member.body.id)).toBeUndefined()
    expect(await h.db.models.Session.countDocuments({ userId: member.body.id })).toBe(0)
    // re-inviting a removed person works
    expect((await send("admin", "post", "/v1/team", { email: "leaving.soon@orbit.test", role: "analyst" })).body.status).toBe("invited")
    expect((await send("admin", "post", "/v1/team", { email: "LEAVING.soon@orbit.test", role: "analyst" })).status).toBe(409)
  })
})

describe("alerts, lookups and the activity feed", () => {
  it("lists open + acked alerts newest first and acknowledges", async () => {
    const now = new Date()
    const mk = (status: string) => ({ _id: newId("alert"), type: "sdk_heartbeat_missing", severity: "critical", entity: { type: "property", id: newId("property") }, status, title: `Alert ${status}`, message: "No heartbeat", href: "/properties", dedupeKey: newId("alert"), firstSeenAt: now, lastSeenAt: now })
    const docs = [mk("open"), mk("resolved"), mk("open")]
    await h.db.models.Alert.insertMany(docs)
    const list = await h.as.analyst.get("/v1/alerts")
    expect(list.body.items.map((a: { id: string }) => a.id)).toEqual([docs[2]._id, docs[0]._id])
    const ack = await send("developer", "post", `/v1/alerts/${docs[0]._id}/ack`)
    expect(ack.body.status).toBe("acked")
    expect((await h.db.models.Alert.findById(docs[0]._id).lean())!.ackedBy).toBe(h.users.developer.id)
    expect((await send("developer", "post", `/v1/alerts/${docs[1]._id}/ack`)).status).toBe(409)
  })

  it("lookups list names for labels", async () => {
    await inventory(h)
    const l = await h.as.analyst.get("/v1/lookups")
    expect(l.body.properties.length).toBeGreaterThan(0)
    expect(l.body.placements[0]).toHaveProperty("propertyId")
    expect(l.body.users.length).toBeGreaterThanOrEqual(6)
  })

  it("audit feed paginates newest first with an _id cursor and filters by date", async () => {
    const page1 = await h.as.analyst.get("/v1/audit?limit=3")
    expect(page1.body.items).toHaveLength(3)
    const page2 = await h.as.analyst.get(`/v1/audit?limit=3&cursor=${page1.body.nextCursor}`)
    expect(page2.body.items[0].id < page1.body.items[2].id).toBe(true)
    const all = await h.as.analyst.get("/v1/audit?limit=100")
    const ids = all.body.items.map((x: { id: string }) => x.id)
    expect([...ids].sort().reverse()).toEqual(ids)
    expect(all.body.items[0].actor.name).toBeTruthy()
    const today = todayKey("Asia/Dhaka")
    expect((await h.as.analyst.get(`/v1/audit?from=${today}&to=${today}&limit=100`)).body.items.length).toBe(all.body.items.length)
    expect((await h.as.analyst.get("/v1/audit?from=2020-01-01&to=2020-01-02")).body.items).toEqual([])
    const stored = await h.db.models.AuditLog.findOne({}).lean()
    expect(stored!.ip).toMatch(/\/(24|48)$/)
    expect(stored!.requestId).toBeTruthy()
  })
})

describe("uploads (local driver)", () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])
  it("issues a ticket, accepts the signed PUT and serves the file immutably", async () => {
    const t = await send("campaign_manager", "post", "/v1/uploads", { fileName: "World Cup 320x50.PNG", mime: "image/png", bytes: PNG.length })
    expect(t.status).toBe(201)
    expect(t.body).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/png" } })
    expect(t.body.publicUrl).toMatch(/^http:\/\/localhost:4000\/media\/upl_[0-9A-Z]{26}\/world-cup-320x50\.png$/)
    const url = new URL(t.body.url)
    const bad = await request(h.app).put(url.pathname + url.search.replace(/sig=[^&]+/, "sig=forged")).set("Content-Type", "image/png").send(PNG)
    expect(bad.status).toBe(403)
    const wrongType = await request(h.app).put(url.pathname + url.search).set("Content-Type", "image/png").send(Buffer.from("<html><script>alert(1)</script></html>......"))
    expect(wrongType.status).toBe(422)
    const put = await request(h.app).put(url.pathname + url.search).set("Content-Type", "image/png").send(PNG)
    expect(put.status).toBe(200)
    const media = await request(h.app).get(new URL(t.body.publicUrl).pathname)
    expect(media.status).toBe(200)
    expect(media.headers["cache-control"]).toMatch(/immutable/)
    expect(media.headers["x-content-type-options"]).toBe("nosniff")
    expect(media.headers["cross-origin-resource-policy"]).toBe("cross-origin")
    expect(Buffer.compare(media.body, PNG)).toBe(0)
    expect((await request(h.app).put(url.pathname + url.search).set("Content-Type", "image/png").send(PNG)).status).toBe(404) // one-time
  })

  it("rejects oversize images and non-media types", async () => {
    expect((await send("campaign_manager", "post", "/v1/uploads", { fileName: "huge.png", mime: "image/png", bytes: 5_000_000 })).status).toBe(422)
    expect((await send("campaign_manager", "post", "/v1/uploads", { fileName: "x.svg", mime: "image/svg+xml", bytes: 10 })).status).toBe(400)
    expect((await send("analyst", "post", "/v1/uploads", { fileName: "x.png", mime: "image/png", bytes: 10 })).status).toBe(403)
  })
})
