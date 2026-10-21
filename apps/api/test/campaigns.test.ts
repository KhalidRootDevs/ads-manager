import { addDays, todayKey } from "@orbit/domain"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { campaignBody, harness, inventory, ORIGIN, type Harness } from "./helpers"

let h: Harness
let inv: Awaited<ReturnType<typeof inventory>>
beforeAll(async () => {
  h = await harness()
  inv = await inventory(h)
})
afterAll(() => h?.close())

const post = (path: string, body: object = {}) => h.as.campaign_manager.post(path).set("Origin", ORIGIN).send(body)
const patch = (path: string, body: object) => h.as.campaign_manager.patch(path).set("Origin", ORIGIN).send(body)

describe("campaign lifecycle", () => {
  it("draft → validate errors → fix → publish → pause → resume → archive frees the name → restore", async () => {
    const name = "Lifecycle Campaign"
    const draft = await post("/v1/campaigns", { ...campaignBody({ ...inv, name }), creativeIds: [], targets: [{ propertyId: inv.propertyId, countryRule: { mode: "include", countries: ["BD"] }, placementIds: [], allocationPct: null, destinationOverride: null }] })
    expect(draft.status).toBe(201)
    expect(draft.body).toMatchObject({ status: "draft", rev: 0, publishedRev: null, flight: { start: "2026-01-01", end: "2027-12-31", tz: "Asia/Dhaka" } })
    const id = draft.body.id

    // the flight is stored as local midnights in the campaign time zone; end = start of the last day (inclusive)
    const stored = await h.db.models.Campaign.findById(id).lean()
    expect(stored!.flight.start.toISOString()).toBe("2025-12-31T18:00:00.000Z")
    expect(stored!.flight.end.toISOString()).toBe("2027-12-30T18:00:00.000Z")
    expect(stored!.live).toBe(true)

    const v1 = await post(`/v1/campaigns/${id}/validate`)
    expect(v1.status).toBe(200)
    expect(v1.body.errors.map((e: { step: number }) => e.step)).toEqual(expect.arrayContaining([2, 5]))

    const blocked = await post(`/v1/campaigns/${id}/publish`, { rev: 0 })
    expect(blocked.status).toBe(422)
    expect(blocked.body.code).toBe("unprocessable")
    expect(blocked.body.errors.length).toBeGreaterThan(0)

    const fixed = await patch(`/v1/campaigns/${id}`, { rev: 0, creativeIds: [inv.creativeId], targets: campaignBody(inv).targets })
    expect(fixed.status).toBe(200)
    expect((await post(`/v1/campaigns/${id}/validate`)).body.errors).toEqual([])

    const pub = await post(`/v1/campaigns/${id}/publish`, { rev: fixed.body.rev })
    expect(pub.status).toBe(200)
    expect(pub.body).toMatchObject({ status: "active", publishedRev: fixed.body.rev + 1, rev: fixed.body.rev + 1 })
    expect(pub.body.publishedAt).toBeTruthy()
    expect(pub.body.health.checkedAt).toBeTruthy()

    const revs = await h.as.analyst.get(`/v1/campaigns/${id}/revisions`)
    expect(revs.body.items).toHaveLength(1)
    expect(revs.body.items[0]).toMatchObject({ id: `${id}:${pub.body.rev}`, rev: pub.body.rev, publishedByName: "Campaign Manager" })
    expect(revs.body.items[0].diff[0]).toBe("First publish")
    const feed = await h.as.analyst.get(`/v1/audit?targetId=${id}`)
    expect(feed.body.items.map((a: { action: string }) => a.action)).toEqual(["campaign.published", "campaign.updated", "campaign.created"])

    // edit + republish: the revision diff says what changed
    const edited = await patch(`/v1/campaigns/${id}`, { rev: pub.body.rev, constraints: { ...campaignBody(inv).constraints, freqCap: { count: 6, per: "day" } } })
    expect(edited.body.status).toBe("active")
    const pub2 = await post(`/v1/campaigns/${id}/publish`, { rev: edited.body.rev })
    expect(pub2.status).toBe(200)
    const revs2 = (await h.as.analyst.get(`/v1/campaigns/${id}/revisions`)).body.items
    expect(revs2[0].diff).toContain("Frequency cap 4/day → 6/day")

    const paused = await post(`/v1/campaigns/${id}/pause`, { rev: pub2.body.rev })
    expect(paused.body.status).toBe("paused")
    const resumed = await post(`/v1/campaigns/${id}/resume`, { rev: paused.body.rev })
    expect(resumed.body.status).toBe("active")
    expect((await post(`/v1/campaigns/${id}/resume`, { rev: resumed.body.rev })).status).toBe(409)

    const archived = await post(`/v1/campaigns/${id}/archive`, { rev: resumed.body.rev })
    expect(archived.body).toMatchObject({ status: "archived" })
    expect(archived.body.archivedAt).toBeTruthy()
    expect((await h.db.models.Campaign.findById(id).lean())!.live).toBeUndefined()
    expect((await patch(`/v1/campaigns/${id}`, { rev: archived.body.rev, priority: 1 })).status).toBe(409)

    // the name is free again
    const reuse = await post("/v1/campaigns", campaignBody({ ...inv, name }))
    expect(reuse.status).toBe(201)
    const clash = await post(`/v1/campaigns/${id}/restore`, { rev: archived.body.rev })
    expect(clash.status).toBe(409)
    expect(clash.body.detail).toMatch(/already uses this name/)
    await post(`/v1/campaigns/${reuse.body.id}/archive`, { rev: reuse.body.rev })
    const restored = await post(`/v1/campaigns/${id}/restore`, { rev: archived.body.rev })
    expect(restored.status).toBe(200)
    expect(restored.body).toMatchObject({ status: "draft", archivedAt: null })
  })

  it("a future flight publishes as scheduled", async () => {
    const start = addDays(todayKey("Asia/Dhaka"), 10)
    const c = await post("/v1/campaigns", campaignBody({ ...inv, start, end: addDays(start, 30) }))
    const pub = await post(`/v1/campaigns/${c.body.id}/publish`, { rev: c.body.rev })
    expect(pub.body.status).toBe("scheduled")
    const feed = await h.as.analyst.get(`/v1/audit?targetId=${c.body.id}&limit=1`)
    expect(feed.body.items[0].action).toBe("campaign.scheduled")
  })

  it("publish is idempotent with a key", async () => {
    const c = await post("/v1/campaigns", campaignBody(inv))
    const a = await h.as.owner.post(`/v1/campaigns/${c.body.id}/publish`).set("Origin", ORIGIN).set("Idempotency-Key", `pub-${c.body.id}`).send({ rev: c.body.rev })
    const b = await h.as.owner.post(`/v1/campaigns/${c.body.id}/publish`).set("Origin", ORIGIN).set("Idempotency-Key", `pub-${c.body.id}`).send({ rev: c.body.rev })
    expect(a.status).toBe(200)
    expect(b.body).toEqual(a.body)
    expect(await h.db.models.CampaignRevision.countDocuments({ campaignId: c.body.id })).toBe(1)
  })

  it("duplicate creates a draft copy", async () => {
    const c = await post("/v1/campaigns", campaignBody({ ...inv, name: "Dup Source" }))
    const d1 = await post(`/v1/campaigns/${c.body.id}/duplicate`)
    const d2 = await post(`/v1/campaigns/${c.body.id}/duplicate`)
    expect(d1.status).toBe(201)
    expect(d1.body).toMatchObject({ name: "Dup Source (copy)", status: "draft" })
    expect(d2.body.name).toBe("Dup Source (copy 2)")
  })

  it("validates an unsaved payload (wizard Review step)", async () => {
    const res = await post("/v1/campaigns/validate", { ...campaignBody(inv), name: "x", budget: { amountMicros: 0, pacing: "even", goal: null } })
    expect(res.status).toBe(200)
    expect(res.body.errors.map((e: { key: string }) => e.key)).toEqual(expect.arrayContaining(["name", "budget"]))
  })

  it("targeting matrix flags conflicts and disabled countries", async () => {
    const body = campaignBody(inv)
    body.targets[0].countryRule = { mode: "include", countries: ["BD", "US", "JP"] }
    const c = await post("/v1/campaigns", body)
    const m = await h.as.analyst.get(`/v1/campaigns/${c.body.id}/targeting-matrix`)
    expect(m.status).toBe(200)
    const state = (cc: string) => m.body.cells.find((x: { country: string }) => x.country === cc)?.state
    expect(state("BD")).toBe("serving")
    expect(state("US")).toBe("conflict") // outside the property's include list
    expect(state("JP")).toBe("conflict") // disabled platform-wide but named
    expect(state("IN")).toBe("excluded")
  })

  it("lists with cursor pagination, filters and stats; counts per status", async () => {
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push((await post("/v1/campaigns", campaignBody({ ...inv, name: `Paged ${i}` }))).body.id)
    await h.db.models.CampaignStats.create({ _id: ids[0], lifetime: { imp: 100, clk: 3, conv: 1, costMicros: 180000n }, today: { d: new Date(), imp: 10, clk: 1, conv: 0, costMicros: 18000n }, updatedAt: new Date() })
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const res = await h.as.analyst.get(`/v1/campaigns?limit=2&q=Paged${cursor ? `&cursor=${cursor}` : ""}`)
      expect(res.status).toBe(200)
      seen.push(...res.body.items.map((x: { id: string }) => x.id))
      cursor = res.body.nextCursor
      pages++
    } while (cursor && pages < 10)
    expect(seen).toHaveLength(5)
    expect(new Set(seen)).toEqual(new Set(ids))
    const all = await h.as.analyst.get(`/v1/campaigns?q=Paged&limit=10`)
    expect(all.body.items.find((x: { id: string }) => x.id === ids[0]).stats.lifetime).toEqual({ imp: 100, clk: 3, conv: 1, costMicros: 180000 })

    const byProp = await h.as.analyst.get(`/v1/campaigns?propertyId=${inv.propertyId}&status=draft&limit=100`)
    expect(byProp.body.items.every((x: { status: string }) => x.status === "draft")).toBe(true)
    const byStatus = await h.as.analyst.get(`/v1/campaigns?status=archived&status=active&limit=100`)
    expect(byStatus.body.items.every((x: { status: string }) => ["archived", "active"].includes(x.status))).toBe(true)
    const byCreative = await h.as.analyst.get(`/v1/campaigns?creativeId=${inv.creativeId}&limit=100`)
    expect(byCreative.body.items.length).toBeGreaterThan(5)

    const counts = await h.as.analyst.get("/v1/campaigns/counts")
    expect(counts.body.counts.draft).toBeGreaterThanOrEqual(5)
    expect(typeof counts.body.needsAttention).toBe("number")

    const one = await h.as.analyst.get(`/v1/campaigns/${ids[0]}`)
    expect(one.body.stats.today.imp).toBe(10)
  })
})
