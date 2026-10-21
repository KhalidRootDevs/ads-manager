import { deliveryUpsert, emptyDeliveryDelta, emptySupplyDelta, supplyUpsert } from "@orbit/db"
import { addDays, dayStart, newId, todayKey, weekdayOfKey, WEEKDAYS } from "@orbit/domain"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { harness, inventory, ORIGIN, type Harness } from "./helpers"

let h: Harness
const today = todayKey("Asia/Dhaka")
let ids: { c1: string; c2: string; p: string; pl: string; cr: string }

async function delivery(day: string, k: { c: string; cc: string; dv?: string; imp: number; clk: number; cost: number; hour?: number }) {
  const x = { ...emptyDeliveryDelta(), imp: k.imp, clk: k.clk, view: Math.floor(k.imp / 2), costMicros: k.cost }
  x.hImp[k.hour ?? 21] = k.imp
  x.hClk[k.hour ?? 21] = k.clk
  const op = deliveryUpsert({ day, d: dayStart(day), c: k.c, p: ids.p, pl: ids.pl, cr: ids.cr, cc: k.cc, dv: k.dv ?? "ph", pf: "an", f: "banner" }, x)
  await h.db.models.DeliveryDaily.collection.bulkWrite([op as never])
}
async function supply(day: string, cc: string, req: number, nf: Record<string, number> = {}) {
  const x = { ...emptySupplyDelta(), req, elig: req - 10, fill: 0, err: 2, nf, latP50: 9, latP99: 41 }
  await h.db.models.SupplyDaily.collection.bulkWrite([supplyUpsert({ day, d: dayStart(day), p: ids.p, pl: ids.pl, cc, dv: "ph", pf: "an" }, x) as never])
}
const q = (body: object, role: keyof Harness["as"] = "analyst") => h.as[role].post("/v1/analytics/delivery").set("Origin", ORIGIN).send(body)

beforeAll(async () => {
  h = await harness()
  const inv = await inventory(h)
  const mk = async (name: string) => (await h.as.owner.post("/v1/campaigns").set("Origin", ORIGIN).send({ name, objective: "awareness", team: "Sports", flight: { start: "2026-01-01", end: "2027-12-31", tz: "Asia/Dhaka" }, creativeIds: [], targets: [], constraints: { days: ["mon"], hours: { from: 0, to: 24 }, devices: ["phone"], minAppVersion: null, freqCap: null, audienceIds: [] }, budget: { amountMicros: 1, pacing: "even", goal: null } })).body.id
  ids = { c1: await mk("Analytics One"), c2: await mk("Analytics Two"), p: inv.propertyId, pl: inv.placementId, cr: inv.creativeId }
  await delivery(today, { c: ids.c1, cc: "BD", imp: 1000, clk: 10, cost: 1_800_000, hour: 20 })
  await delivery(today, { c: ids.c2, cc: "IN", dv: "tb", imp: 500, clk: 5, cost: 900_000 })
  await delivery(addDays(today, -2), { c: ids.c1, cc: "BD", imp: 300, clk: 3, cost: 540_000 })
  await delivery(addDays(today, -10), { c: ids.c1, cc: "AE", imp: 900, clk: 9, cost: 1_620_000 }) // previous period
  await delivery(addDays(today, -40), { c: ids.c1, cc: "BD", imp: 99999, clk: 0, cost: 0 }) // out of range
  await supply(today, "BD", 2000, { no_candidates: 300, capped: 50 })
  await supply(today, "IN", 1000, { no_candidates: 100 })
  await supply(addDays(today, -10), "AE", 1800)
})
afterAll(() => h?.close())

describe("analytics delivery", () => {
  it("totals for the last 7 days with derived metrics and supply", async () => {
    const r = await q({ range: { days: 7 } })
    expect(r.status).toBe(200)
    expect(r.body.range).toEqual({ from: addDays(today, -6), to: today })
    expect(r.body.supplyAvailable).toBe(true)
    expect(r.body.totals).toMatchObject({ imp: 1800, clk: 18, req: 3000, err: 4, cost: 3.24 })
    expect(r.body.totals.ctr).toBeCloseTo(0.01)
    expect(r.body.totals.fill).toBeCloseTo(0.6)
    expect(r.body.totals.ecpm).toBeCloseTo(1.8)
    expect(r.body.previous).toBeNull()
    expect(r.body.rows).toEqual([])
  })

  it("groups by country with labels, share and supply per row", async () => {
    const r = await q({ range: { days: 7 }, groupBy: "country" })
    expect(r.body.rows.map((x: { key: string }) => x.key)).toEqual(["BD", "IN"])
    expect(r.body.rows[0]).toMatchObject({ label: "Bangladesh", sub: "South Asia", imp: 1300, req: 2000, href: null })
    expect(r.body.rows[0].share + r.body.rows[1].share).toBeCloseTo(1)
  })

  it("groups by day zero-filled and chronological", async () => {
    const r = await q({ range: { days: 7 }, groupBy: "day" })
    expect(r.body.rows.map((x: { key: string }) => x.key)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)))
    expect(r.body.rows[6].imp).toBe(1500)
    expect(r.body.rows[4].imp).toBe(300)
    expect(r.body.rows[0]).toMatchObject({ imp: 0, req: 0, ctr: 0 })
  })

  it("supply is null when filtered by campaign (or grouped by creative)", async () => {
    const r = await q({ range: { days: 7 }, filters: { campaign: [ids.c1] }, groupBy: "campaign" })
    expect(r.body.supplyAvailable).toBe(false)
    expect(r.body.totals).toMatchObject({ imp: 1300, req: null, elig: null, err: null, fill: null })
    expect(r.body.rows).toHaveLength(1)
    expect(r.body.rows[0]).toMatchObject({ key: ids.c1, label: "Analytics One", sub: "Draft", href: `/campaigns/${ids.c1}` })
    expect((await q({ range: { days: 7 }, groupBy: "creative" })).body.supplyAvailable).toBe(false)
  })

  it("compares with the previous period of the same length", async () => {
    const r = await q({ range: { days: 7 }, compare: "previous_period" })
    expect(r.body.previousRange).toEqual({ from: addDays(today, -13), to: addDays(today, -7) })
    expect(r.body.previous).toMatchObject({ imp: 900, req: 1800 })
  })

  it("filters by region, platform and device; groups by platform and device with labels", async () => {
    expect((await q({ range: { days: 7 }, filters: { region: ["South Asia"] } })).body.totals.imp).toBe(1800)
    expect((await q({ range: { days: 30 }, filters: { region: ["Middle East"] } })).body.totals.imp).toBe(900)
    expect((await q({ range: { days: 7 }, filters: { device: ["tablet"] } })).body.totals.imp).toBe(500)
    expect((await q({ range: { days: 7 }, filters: { platform: ["ios"] } })).body.totals.imp).toBe(0)
    const dev = await q({ range: { days: 7 }, groupBy: "device" })
    expect(dev.body.rows.map((x: { key: string; label: string }) => [x.key, x.label])).toEqual([["phone", "Phone"], ["tablet", "Tablet"]])
    const reg = await q({ range: { days: 30 }, groupBy: "region" })
    expect(reg.body.rows.map((x: { key: string }) => x.key)).toEqual(["South Asia", "Middle East"])
    const plat = await q({ range: { days: 7 }, groupBy: "platform" })
    expect(plat.body.rows[0]).toMatchObject({ key: "android", label: "Android" })
  })

  it("explicit from/to ranges are validated", async () => {
    expect((await q({ range: { from: today, to: addDays(today, -1) } })).status).toBe(400)
    expect((await q({ range: { from: addDays(today, -2), to: addDays(today, -2) } })).body.totals.imp).toBe(300)
  })

  it("caches results for 60 s", async () => {
    const body = { range: { days: 3 }, groupBy: "country" }
    const a = await q(body)
    await h.db.models.DeliveryDaily.collection.deleteMany({ c: ids.c2 })
    const b = await q(body)
    expect(b.body).toEqual(a.body)
    await delivery(today, { c: ids.c2, cc: "IN", dv: "tb", imp: 500, clk: 5, cost: 900_000 })
  })
})

describe("heatmap, no-fill and export", () => {
  it("heatmap is 7×24 Monday→Sunday in Asia/Dhaka", async () => {
    const r = await h.as.analyst.post("/v1/analytics/heatmap").set("Origin", ORIGIN).send({ range: { days: 7 } })
    expect(r.status).toBe(200)
    expect(r.body.tz).toBe("Asia/Dhaka")
    expect(r.body.matrix).toHaveLength(7)
    expect(r.body.matrix.every((row: number[]) => row.length === 24)).toBe(true)
    const wd = WEEKDAYS.indexOf(weekdayOfKey(today))
    expect(r.body.matrix[wd][20]).toBe(1000)
    expect(r.body.matrix[wd][21]).toBe(500)
    expect(r.body.matrix.flat().reduce((a: number, b: number) => a + b, 0)).toBe(1800)
    const clk = await h.as.analyst.post("/v1/analytics/heatmap").set("Origin", ORIGIN).send({ range: { days: 7 }, metric: "clk", filters: { campaign: [ids.c1] } })
    expect(clk.body.matrix[wd][20]).toBe(10)
  })

  it("no-fill reasons and worst latencies", async () => {
    const r = await h.as.analyst.post("/v1/analytics/no-fill").set("Origin", ORIGIN).send({ range: { days: 7 } })
    expect(r.body).toEqual({ reasons: [{ reason: "no_candidates", count: 400 }, { reason: "capped", count: 50 }], latencyP50: 9, latencyP99: 41 })
    const none = await h.as.analyst.post("/v1/analytics/no-fill").set("Origin", ORIGIN).send({ range: { days: 7 }, filters: { campaign: [ids.c1] } })
    expect(none.body).toEqual({ reasons: [], latencyP50: null, latencyP99: null })
  })

  it("exports CSV (reports.export required)", async () => {
    const r = await h.as.analyst.post("/v1/analytics/export.csv").set("Origin", ORIGIN).send({ range: { days: 7 }, groupBy: "country" })
    expect(r.status).toBe(200)
    expect(r.headers["content-type"]).toMatch(/text\/csv/)
    expect(r.headers["content-disposition"]).toMatch(/attachment; filename="orbit-country-.*\.csv"/)
    const lines = r.text.trim().split("\r\n")
    expect(lines[0]).toBe("key,label,sub,req,elig,err,imp,view,clk,vs,vc,conv,cost,ctr,fill,ecpm,vcr,viewRate,share")
    expect(lines).toHaveLength(3)
    expect(lines[1]).toMatch(/^BD,Bangladesh,South Asia,2000,/)
    expect((await h.as.read_only.post("/v1/analytics/export.csv").set("Origin", ORIGIN).send({ range: { days: 7 } })).status).toBe(403)
  })

  it("rejects unknown dimensions and injected filters", async () => {
    expect((await q({ range: { days: 7 }, groupBy: "uid" })).status).toBe(400)
    expect((await q({ range: { days: 7 }, filters: { campaign: [{ $ne: null }] } })).status).toBe(400)
    expect((await q({ range: { days: 7 }, filters: { campaign: [newId("campaign")] } })).body.totals.imp).toBe(0)
  })
})
