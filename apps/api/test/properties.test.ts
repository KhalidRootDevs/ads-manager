import { hashKeySecret } from "@orbit/domain/node"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { harness, inventory, ORIGIN, propertyBody, type Harness } from "./helpers"

let h: Harness
beforeAll(async () => {
  h = await harness()
})
afterAll(() => h?.close())

const post = (path: string, body: object = {}) => h.as.developer.post(path).set("Origin", ORIGIN).send(body)

describe("properties and keys", () => {
  it("registers a property with a one-time test key (only the hash is stored)", async () => {
    const res = await post("/v1/properties", propertyBody({ identifier: "  Com.Example.App  " }))
    expect(res.status).toBe(201)
    expect(res.body.property).toMatchObject({ identifier: "com.example.app", status: "pending", testMode: true, sdk: { state: "not_integrated", version: null } })
    expect(res.body.testKey.secret).toMatch(/^ok_test_[0-9A-Za-z]{32}$/)
    expect(res.body.testKey.key).toMatchObject({ env: "test", status: "active", prefix: "ok_test_", last4: res.body.testKey.secret.slice(-4) })
    const stored = await h.db.models.PropertyKey.findById(res.body.testKey.key.id).lean()
    expect(stored!.hash).toBe(hashKeySecret(res.body.testKey.secret, h.env.KEY_PEPPER))
    const keys = await h.as.analyst.get(`/v1/properties/${res.body.property.id}/keys`)
    expect(JSON.stringify(keys.body)).not.toContain(stored!.hash)
    expect(JSON.stringify(keys.body)).not.toContain(res.body.testKey.secret)
  })

  it("rotation puts the old key in a 24 h grace period and returns a new secret; revoke is immediate", async () => {
    const { propertyId } = await inventory(h)
    const created = await post(`/v1/properties/${propertyId}/keys`, { env: "live", label: "Production SDK key" })
    expect(created.status).toBe(201)
    const rotated = await post(`/v1/properties/${propertyId}/keys/${created.body.key.id}/rotate`)
    expect(rotated.status).toBe(200)
    expect(rotated.body.secret).not.toBe(created.body.secret)
    expect(rotated.body.key).toMatchObject({ status: "active", env: "live", label: "Production SDK key" })
    const keys = (await h.as.analyst.get(`/v1/properties/${propertyId}/keys`)).body.items
    const old = keys.find((k: { id: string }) => k.id === created.body.key.id)
    expect(old.status).toBe("grace")
    const graceMs = new Date(old.graceUntil).getTime() - Date.now()
    expect(graceMs).toBeGreaterThan(23.9 * 3600_000)
    expect(graceMs).toBeLessThanOrEqual(24 * 3600_000)
    expect((await post(`/v1/properties/${propertyId}/keys/${created.body.key.id}/rotate`)).status).toBe(409)
    const revoked = await post(`/v1/properties/${propertyId}/keys/${rotated.body.key.id}/revoke`)
    expect(revoked.body).toMatchObject({ status: "revoked" })
    expect(revoked.body.revokedAt).toBeTruthy()
    const audit = (await h.as.analyst.get(`/v1/audit?targetId=${propertyId}`)).body.items.map((a: { action: string }) => a.action)
    expect(audit.slice(0, 3)).toEqual(["key.revoked", "key.rotated", "key.created"])
  })

  it("pause / activate are rev-guarded", async () => {
    const { property } = await inventory(h)
    const paused = await post(`/v1/properties/${property.id}/pause`, { rev: property.rev })
    expect(paused.body.status).toBe("paused")
    expect((await post(`/v1/properties/${property.id}/activate`, { rev: property.rev })).status).toBe(409)
    expect((await post(`/v1/properties/${property.id}/activate`, { rev: paused.body.rev })).body.status).toBe("active")
  })

  it("test request goes through the ad server and marks a new property as integrated", async () => {
    const { propertyId, placementId } = await inventory(h)
    let sent: { url: string; headers: Record<string, string>; body: { propertyId: string; placementId?: string } } | null = null
    h.setFetch(async (url, init) => {
      sent = { url: String(url), headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) }
      return new Response(JSON.stringify({ at: new Date().toISOString(), propertyId, placementId, placementName: "Home Banner", country: "BD", result: "200 Served (test)", latencyMs: 12, sdk: "test" }), { status: 200, headers: { "content-type": "application/json" } })
    })
    const res = await post(`/v1/properties/${propertyId}/test-request`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ propertyId, result: "200 Served (test)", latencyMs: 12 })
    expect(sent!.url).toBe("http://ad-server.test/internal/test-serve")
    expect(sent!.headers["x-orbit-internal"]).toBe(h.env.INTERNAL_TOKEN)
    expect(sent!.body).toEqual({ propertyId, placementId })
    const p = (await h.as.analyst.get(`/v1/properties/${propertyId}`)).body
    expect(p).toMatchObject({ status: "active", sdk: { state: "healthy", version: "test" } })

    h.setFetch(async () => {
      throw new TypeError("fetch failed")
    })
    const down = await post(`/v1/properties/${propertyId}/test-request`)
    expect(down.status).toBe(503)
    expect(down.body.detail).toMatch(/ad server isn’t reachable/)
  })

  it("diagnostics returns the latest request samples with placement names", async () => {
    const { propertyId, placementId } = await inventory(h)
    const now = Date.now()
    await h.db.models.RequestSample.collection.insertMany([
      { at: new Date(now - 60_000), k: { p: propertyId, pl: placementId }, cc: "BD", result: "200", latencyMs: 9, sdk: "6.2.1" },
      { at: new Date(now - 30_000), k: { p: propertyId, pl: placementId }, cc: "IN", result: "204 no_candidates", latencyMs: 4, sdk: "6.2.1" },
      { at: new Date(now - 30 * 3600_000), k: { p: propertyId, pl: placementId }, cc: "BD", result: "200", latencyMs: 9, sdk: "6.2.0" },
    ])
    const res = await h.as.analyst.get(`/v1/properties/${propertyId}/diagnostics`)
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(2)
    expect(res.body.items[0]).toMatchObject({ country: "IN", result: "204 no_candidates", placementId, sdk: "6.2.1" })
    expect(res.body.items[0].placementName).toMatch(/Home Banner/)
  })
})

describe("placements", () => {
  it("validates format and size against the property, and names per property", async () => {
    const { propertyId } = await inventory(h)
    const notEnabled = await post("/v1/placements", { propertyId, name: "Popup", format: "web_popup", size: "480x360" })
    expect(notEnabled.status).toBe(422)
    const badSize = await post("/v1/placements", { propertyId, name: "Big banner", format: "banner", size: "300x250" })
    expect(badSize.status).toBe(422)
    const inter = await post("/v1/placements", { propertyId, name: "Match break", format: "interstitial", size: "fullscreen", freqCap: { count: 2, per: "hour" } })
    expect(inter.status).toBe(201)
    expect(inter.body).toMatchObject({ format: "interstitial", size: "fullscreen", freqCap: { count: 2, per: "hour" }, status: "active", minAppVersion: null })
    const dup = await post("/v1/placements", { propertyId, name: "MATCH BREAK", format: "interstitial", size: "fullscreen" })
    expect(dup.status).toBe(409)
    expect(dup.body.detail).toMatch(/already exists on this property/)
    const list = await h.as.analyst.get(`/v1/placements?propertyId=${propertyId}`)
    expect(list.body.items.every((x: { propertyId: string }) => x.propertyId === propertyId)).toBe(true)
    const paused = await h.as.developer.patch(`/v1/placements/${inter.body.id}`).set("Origin", ORIGIN).send({ rev: inter.body.rev, status: "paused" })
    expect(paused.body.status).toBe("paused")
    expect((await h.as.analyst.get(`/v1/audit?targetId=${inter.body.id}`)).body.items[0].action).toBe("placement.paused")
  })
})
