import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { bannerCreative, campaignBody, harness, inventory, ORIGIN, type Harness } from "./helpers"

let h: Harness
beforeAll(async () => {
  h = await harness()
})
afterAll(() => h?.close())

const as = (role: "owner" | "campaign_manager" | "analyst") => ({
  post: (path: string, body: object = {}) => h.as[role].post(path).set("Origin", ORIGIN).send(body),
  patch: (path: string, body: object) => h.as[role].patch(path).set("Origin", ORIGIN).send(body),
  get: (path: string) => h.as[role].get(path),
})
const cm = as("campaign_manager")
const owner = as("owner")

describe("creative review flow", () => {
  it("draft → submit (in review) → reject → edit → resubmit → approve (ready)", async () => {
    const c = await cm.post("/v1/creatives", bannerCreative())
    expect(c.status).toBe(201)
    expect(c.body).toMatchObject({ status: "draft", currentVersion: 1, review: { state: "none" }, options: { media: "image", brandColor: "#0F766E" } })
    const sub = await cm.post(`/v1/creatives/${c.body.id}/submit`, { rev: c.body.rev })
    expect(sub.body).toMatchObject({ status: "in_review", review: { state: "pending" } })
    expect((await cm.post(`/v1/creatives/${c.body.id}/approve`, { rev: sub.body.rev })).status).toBe(403)
    const rej = await owner.post(`/v1/creatives/${c.body.id}/reject`, { rev: sub.body.rev, reason: "Logo is cut off at the edge." })
    expect(rej.body).toMatchObject({ status: "rejected", review: { state: "rejected", reason: "Logo is cut off at the edge." } })
    const edit = await cm.patch(`/v1/creatives/${c.body.id}`, { rev: rej.body.rev, copy: { headline: "Fixed headline", body: "", cta: "Watch" }, note: "Moved the logo" })
    expect(edit.body).toMatchObject({ status: "rejected", currentVersion: 2 })
    const sub2 = await cm.post(`/v1/creatives/${c.body.id}/submit`, { rev: edit.body.rev })
    expect(sub2.body.status).toBe("in_review")
    const ok = await owner.post(`/v1/creatives/${c.body.id}/approve`, { rev: sub2.body.rev })
    expect(ok.body).toMatchObject({ status: "ready", review: { state: "approved", by: h.users.owner.id } })
    const versions = await cm.get(`/v1/creatives/${c.body.id}/versions`)
    expect(versions.body.items.map((v: { v: number; note: string }) => [v.v, v.note])).toEqual([[2, "Moved the logo"], [1, "Created"]])
    const audit = await cm.get(`/v1/audit?targetId=${c.body.id}`)
    expect(audit.body.items.map((a: { action: string }) => a.action)).toEqual(["creative.approved", "creative.submitted", "creative.updated", "creative.rejected", "creative.submitted", "creative.created"])
  })

  it("an approver's submit is auto-approved; submit requires every check", async () => {
    const auto = await owner.post("/v1/creatives", { ...bannerCreative(), intent: "submit" })
    expect(auto.body.status).toBe("ready")
    const broken = await cm.post("/v1/creatives", { ...bannerCreative({ altText: "", assets: [] }), intent: "submit" })
    expect(broken.status).toBe(422)
    expect(broken.body.errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(["asset", "alt"]))
  })

  it("editing a ready creative so a check fails drops it back to draft", async () => {
    const c = await owner.post("/v1/creatives", { ...bannerCreative(), intent: "submit" })
    const ok = await cm.patch(`/v1/creatives/${c.body.id}`, { rev: c.body.rev, name: "Renamed but valid" })
    expect(ok.body.status).toBe("ready")
    const bad = await cm.patch(`/v1/creatives/${c.body.id}`, { rev: ok.body.rev, altText: "" })
    expect(bad.body).toMatchObject({ status: "draft", currentVersion: 3 })
  })

  it("archive is blocked while a live campaign uses it; restore and duplicate", async () => {
    const inv = await inventory(h)
    const camp = await owner.post("/v1/campaigns", campaignBody(inv))
    const pub = await owner.post(`/v1/campaigns/${camp.body.id}/publish`, { rev: camp.body.rev })
    expect(pub.body.status).toBe("active")
    const cr = (await owner.get(`/v1/creatives/${inv.creativeId}`)).body
    const blocked = await owner.post(`/v1/creatives/${cr.id}/archive`, { rev: cr.rev })
    expect(blocked.status).toBe(409)
    expect(blocked.body.code).toBe("in_use")
    await owner.post(`/v1/campaigns/${camp.body.id}/pause`, { rev: pub.body.rev })
    const archived = await owner.post(`/v1/creatives/${cr.id}/archive`, { rev: cr.rev })
    expect(archived.body.status).toBe("archived")
    expect((await owner.get("/v1/creatives")).body.items.some((x: { id: string }) => x.id === cr.id)).toBe(false)
    expect((await owner.get("/v1/creatives?includeArchived=true")).body.items.some((x: { id: string }) => x.id === cr.id)).toBe(true)
    expect((await owner.patch(`/v1/creatives/${cr.id}`, { rev: archived.body.rev, name: "Nope nope" })).status).toBe(409)
    const restored = await owner.post(`/v1/creatives/${cr.id}/restore`, { rev: archived.body.rev })
    expect(restored.body).toMatchObject({ status: "draft", review: { state: "none" } })
    const dup = await owner.post(`/v1/creatives/${cr.id}/duplicate`)
    expect(dup.status).toBe(201)
    expect(dup.body).toMatchObject({ name: `${cr.name} (copy)`, status: "draft", currentVersion: 1 })
  })

  it("search falls back to a case-insensitive regex off Atlas", async () => {
    await cm.post("/v1/creatives", bannerCreative({ name: "Ramadan Mubarak Popup", copy: { headline: "Iftar deals", body: "", cta: "Shop" } }))
    const byName = await cm.get("/v1/creatives?q=ramadan")
    expect(byName.body.items.map((x: { name: string }) => x.name)).toContain("Ramadan Mubarak Popup")
    const byHeadline = await cm.get("/v1/creatives?q=IFTAR")
    expect(byHeadline.body.items).toHaveLength(1)
    expect((await cm.get("/v1/creatives?q=(.*")).status).toBe(200)
  })
})
