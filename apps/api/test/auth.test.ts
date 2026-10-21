import { permissionsOf } from "@orbit/domain"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { harness, ORIGIN, type Harness } from "./helpers"

let h: Harness
beforeAll(async () => {
  h = await harness()
})
afterAll(() => h?.close())

describe("auth", () => {
  it("dev-login sets an HttpOnly SameSite=Lax session cookie and returns the user with permissions", async () => {
    const res = await request(h.app).post("/v1/auth/dev-login").set("Origin", ORIGIN).send({ email: h.users.analyst.email.toUpperCase() })
    expect(res.status).toBe(200)
    expect(res.body.user.role).toBe("analyst")
    expect(res.body.permissions).toEqual(permissionsOf("analyst"))
    const cookie = String(res.headers["set-cookie"])
    expect(cookie).toMatch(/orbit_sid=/)
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Lax/)
    expect(cookie).not.toMatch(/Secure/)
    // only the token's hash is stored
    const token = /orbit_sid=([^;]+)/.exec(cookie)![1]
    expect(await h.db.models.Session.findById(token).lean()).toBeNull()
  })

  it("GET /v1/me works with the cookie and is 401 without it", async () => {
    const me = await h.as.owner.get("/v1/me")
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe(h.users.owner.email)
    const anon = await request(h.app).get("/v1/me")
    expect(anon.status).toBe(401)
    expect(anon.headers["content-type"]).toMatch(/application\/problem\+json/)
    expect(anon.body).toMatchObject({ status: 401, code: "unauthorized", title: "Unauthorized" })
    expect(typeof anon.body.requestId).toBe("string")
  })

  it("rejects unknown and disabled accounts", async () => {
    expect((await request(h.app).post("/v1/auth/dev-login").set("Origin", ORIGIN).send({ email: "nobody@orbit.test" })).status).toBe(401)
  })

  it("accepts an invite on first sign-in (invited → active)", async () => {
    const inv = await h.as.owner.post("/v1/team").set("Origin", ORIGIN).send({ email: "new.person@orbit.test", role: "analyst" })
    expect(inv.status).toBe(201)
    expect(inv.body).toMatchObject({ status: "invited", name: "New Person" })
    const res = await request(h.app).post("/v1/auth/dev-login").set("Origin", ORIGIN).send({ email: "new.person@orbit.test" })
    expect(res.status).toBe(200)
    expect(res.body.user.status).toBe("active")
  })

  it("logout deletes the session server-side", async () => {
    const agent = request.agent(h.app)
    await agent.post("/v1/auth/dev-login").set("Origin", ORIGIN).send({ email: h.users.developer.email })
    expect((await agent.get("/v1/me")).status).toBe(200)
    const out = await agent.post("/v1/auth/logout").set("Origin", ORIGIN)
    expect(out.status).toBe(200)
    expect(out.body).toEqual({ ok: true })
    expect((await agent.get("/v1/me")).status).toBe(401)
  })

  it("CSRF: a state-changing request from another origin is rejected", async () => {
    const res = await h.as.owner.post("/v1/events").set("Origin", "https://evil.example").send({ key: "evil_event", name: "Evil event", source: "sdk" })
    expect(res.status).toBe(403)
    expect(res.body.detail).toMatch(/Cross-site/)
  })

  it("CORS allows only WEB_ORIGIN with credentials", async () => {
    const ok = await request(h.app).options("/v1/me").set("Origin", ORIGIN).set("Access-Control-Request-Method", "GET")
    expect(ok.headers["access-control-allow-origin"]).toBe(ORIGIN)
    expect(ok.headers["access-control-allow-credentials"]).toBe("true")
    const bad = await request(h.app).options("/v1/me").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "GET")
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined()
  })

  it("health, readiness and OpenAPI", async () => {
    expect((await request(h.app).get("/healthz")).body).toEqual({ ok: true })
    const ready = await request(h.app).get("/readyz")
    expect(ready.status).toBe(200)
    expect(ready.body).toMatchObject({ mongo: "ok", redis: "ok" })
    const doc = await request(h.app).get("/v1/openapi.json")
    expect(doc.status).toBe(200)
    expect(doc.body.openapi).toBe("3.1.0")
    expect(doc.body.paths["/v1/campaigns/{id}/publish"].post.operationId).toBe("publishCampaign")
  })
})

describe("dev-login is disabled outside development", () => {
  let off: Harness
  beforeAll(async () => {
    off = await harness()
    off.env.AUTH_DEV_LOGIN = false
  })
  afterAll(() => off?.close())
  it("returns 404", async () => {
    const res = await request(off.app).post("/v1/auth/dev-login").set("Origin", ORIGIN).send({ email: off.users.owner.email })
    expect(res.status).toBe(404)
  })
})
