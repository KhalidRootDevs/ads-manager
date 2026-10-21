import { describe, expect, it } from "vitest"
import {
  addDays, checksPass, compactKey, dateKeyInTz, dayStart, isId, zAlert, zAudience, zAuditEntry, zBudgetDto, zCampaign, zCampaignRevision, zCampaignStats, zCountryDto, zCreative,
  zCreativeVersion, zEventDefinition, zPlacement, zProperty, zPropertyKey, zRequestSample, zSettings, zUser,
} from "../src"
import { buildDemo, distribute, generateDelivery, PROTO_TODAY } from "../src/demo"

const TODAY = "2026-10-19"
const NOW = Date.parse("2026-10-19T08:30:00Z") // 14:30 Dhaka
const demo = buildDemo({ today: TODAY, now: NOW })
const out = generateDelivery(demo)

describe("buildDemo", () => {
  it("has the prototype's workspace", () => {
    expect(demo.users).toHaveLength(9)
    expect(demo.properties).toHaveLength(38)
    expect(demo.properties.filter((p) => p.platform === "web")).toHaveLength(16)
    expect(demo.placements).toHaveLength(30)
    expect(demo.creatives).toHaveLength(15)
    expect(demo.campaigns).toHaveLength(11)
    expect(demo.countries.filter((c) => !c.enabled).map((c) => c.code)).toEqual(["KR", "EG"])
  })
  it("matches the DTO schemas", () => {
    const check = <T>(schema: { parse: (x: unknown) => T }, xs: unknown[]) => xs.forEach((x) => schema.parse(x))
    check(zUser, demo.users)
    check(zCountryDto, demo.countries)
    zSettings.parse(demo.settings)
    check(zProperty, demo.properties)
    check(zPropertyKey.omit({ last4: true }), demo.propertyKeys)
    check(zPlacement, demo.placements)
    check(zCreative, demo.creatives)
    check(zCreativeVersion, demo.creativeVersions)
    check(zCampaign, demo.campaigns)
    check(zCampaignRevision, demo.campaignRevisions)
    check(zEventDefinition, demo.events)
    check(zAudience, demo.audiences)
    check(zBudgetDto, demo.budgets)
    check(zAuditEntry, demo.auditLog)
    check(zAlert, demo.alerts)
    check(zCampaignStats, out.stats)
    check(zRequestSample, out.samples)
  })
  it("uses demo login emails with Arif Hossain as owner", () => {
    const arif = demo.users.find((u) => u.name === "Arif Hossain")!
    expect(arif).toMatchObject({ email: "arif.hossain@orbit.example", role: "owner", status: "active" })
    for (const u of demo.users) expect(u.email).toMatch(/^[a-z]+\.[a-z]+@orbit\.example$/)
  })
  it("is deterministic and maps every prototype id", () => {
    const again = buildDemo({ today: TODAY, now: NOW })
    expect(again.idMap).toEqual(demo.idMap)
    expect(again.auditLog.map((a) => a.id)).toEqual(demo.auditLog.map((a) => a.id))
    expect(buildDemo({ today: TODAY, now: NOW, seed: 8 }).idMap.c1).not.toBe(demo.idMap.c1)
    expect(isId("property", demo.idMap.p1)).toBe(true)
    expect(isId("placement", demo.idMap.pl101)).toBe(true)
    expect(isId("creative", demo.idMap.cr15)).toBe(true)
    expect(isId("campaign", demo.idMap.c11)).toBe(true)
    expect(isId("user", demo.idMap.m9)).toBe(true)
    expect(isId("audience", demo.idMap.au4)).toBe(true)
  })
  it("keeps references consistent", () => {
    const ids = new Set([...demo.properties, ...demo.placements, ...demo.creatives, ...demo.users].map((x) => x.id))
    for (const c of demo.campaigns) {
      for (const id of c.creativeIds) expect(ids.has(id)).toBe(true)
      for (const t of c.targets) {
        expect(ids.has(t.propertyId)).toBe(true)
        for (const pl of t.placementIds) expect(demo.placements.find((x) => x.id === pl)!.propertyId).toBe(t.propertyId)
      }
    }
    for (const k of demo.propertyKeys) expect(ids.has(k.propertyId)).toBe(true)
    for (const a of demo.auditLog) expect(a.target.id).toBeTruthy()
    expect([...demo.auditLog].map((a) => a.at)).toEqual([...demo.auditLog].map((a) => a.at).sort())
    expect(demo.auditLog.every((a) => Date.parse(a.at) < NOW)).toBe(true)
  })
  it("ready creatives pass their format checks; rich media and the rejected native don't", () => {
    for (const c of demo.creatives.filter((x) => x.status === "ready")) expect(checksPass(c), c.name).toBe(true)
    expect(checksPass(demo.creatives.find((c) => c.format === "rich_media")!)).toBe(false)
    expect(checksPass(demo.creatives.find((c) => c.status === "rejected")!)).toBe(false)
  })
  it("precomputes health and alerts like the prototype", () => {
    const byName = (n: string) => demo.campaigns.find((c) => c.name === n)!
    expect(byName("World Cup Highlights Banner").health.issues).toEqual([])
    expect(byName("Fantasy XI Launch").health.issues.map((i) => i.code)).toEqual(["creative_not_ready"])
    expect(byName("Converter Pro Upsell").health.issues.map((i) => [i.code, i.country])).toEqual([["country_conflict", "JP"]])
    expect(byName("Weather Alerts Cross-Promo").health.issues.map((i) => i.code)).toEqual(["creative_rejected", "sdk_heartbeat_missing"])
    expect(demo.alerts.map((a) => a.type).sort()).toEqual(["country_conflict", "creative_rejected", "not_delivering", "sdk_degraded", "sdk_degraded", "sdk_degraded", "sdk_heartbeat_missing"])
    expect(demo.campaigns.filter((c) => c.status !== "archived").map((c) => c.name.toLowerCase())).toHaveLength(10)
  })
  it("shifts every date relative to today", () => {
    const later = buildDemo({ today: "2027-03-01", now: Date.parse("2027-03-01T06:00:00Z") })
    const shift = (k: string) => addDays(k, 133)
    const c1 = (d: typeof demo) => d.campaigns.find((c) => c.id === d.idMap.c1)!
    expect(c1(demo).flight).toEqual({ start: "2026-09-12", end: "2026-11-30", tz: "Asia/Dhaka" })
    expect(c1(later).flight.start).toBe(shift("2026-09-12"))
    expect(Date.parse(later.creatives[0].createdAt) - Date.parse(demo.creatives[0].createdAt)).toBe(133 * 86_400_000)
    expect(later.budgets[0].quarter).toBe("2027-Q1")
    expect(PROTO_TODAY).toBe("2026-10-19")
  })
})

describe("generateDelivery", () => {
  it("keeps the document count bounded", () => {
    expect(out.delivery.length).toBeGreaterThan(1000)
    expect(out.delivery.length).toBeLessThan(150_000)
    expect(out.supply.length).toBeLessThan(150_000)
    expect(new Set(out.delivery.map((d) => d._id)).size).toBe(out.delivery.length)
    expect(new Set(out.supply.map((d) => d._id)).size).toBe(out.supply.length)
  })
  it("delivery rows are internally consistent", () => {
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
    for (const d of out.delivery) {
      expect(d.m.imp).toBeGreaterThan(0)
      expect(d.m.clk).toBeLessThanOrEqual(d.m.imp)
      expect(d.m.view).toBeLessThanOrEqual(d.m.imp)
      expect(d.m.vc).toBeLessThanOrEqual(d.m.vs)
      expect(d.m.conv).toBeLessThanOrEqual(d.m.clk)
      expect(Number.isInteger(d.m.costMicros)).toBe(true)
      expect(d.h.imp).toHaveLength(24)
      expect(d.h.clk).toHaveLength(24)
      expect(sum(d.h.imp)).toBe(d.m.imp)
      expect(sum(d.h.clk)).toBe(d.m.clk)
      expect(d._id.startsWith(compactKey(dateKeyInTz(d.d)) + "|" + d.c)).toBe(true)
      expect(d.d.getTime()).toBe(dayStart(dateKeyInTz(d.d)).getTime())
    }
  })
  it("today only has hours up to now (14:30 Dhaka)", () => {
    const today = dayStart(TODAY).getTime()
    const rows = out.delivery.filter((d) => d.d.getTime() === today)
    expect(rows.length).toBeGreaterThan(0)
    for (const d of rows) expect(d.h.imp.slice(15).every((x) => x === 0)).toBe(true)
    for (const s of out.supply.filter((x) => x.d.getTime() === today)) expect(s.h.req.slice(15).every((x) => x === 0)).toBe(true)
  })
  it("supply fill equals delivered impressions per grain, and requests cover it", () => {
    const filled = new Map<string, number>()
    for (const d of out.delivery) {
      const k = [d._id.split("|")[0], d.p, d.pl, d.cc, d.dv].join("|")
      filled.set(k, (filled.get(k) ?? 0) + d.m.imp)
    }
    const supply = new Map(out.supply.map((s) => [s._id, s]))
    for (const [k, imp] of filled) {
      expect(supply.has(k), k).toBe(true)
      expect(supply.get(k)!.m.fill).toBe(imp)
    }
    for (const s of out.supply) {
      expect(s.m.fill).toBe(filled.get(s._id) ?? 0)
      expect(s.m.req).toBeGreaterThanOrEqual(s.m.fill + s.m.err)
      expect(s.m.elig).toBeGreaterThanOrEqual(s.m.fill)
      expect(Object.values(s.m.nf).reduce((a, b) => a + b, 0)).toBe(s.m.req - s.m.fill - s.m.err)
      expect(s.h.req.reduce((a, b) => a + b, 0)).toBe(s.m.req)
      expect(s.m.latP99).toBeGreaterThanOrEqual(s.m.latP50)
    }
    // placements without campaigns still get (unfilled) requests
    const unused = demo.idMap.pl103
    expect(out.supply.some((s) => s.pl === unused && s.m.req > 0 && s.m.fill === 0 && s.m.nf.no_candidates > 0)).toBe(true)
    expect(out.supply.filter((s) => s.pl === demo.idMap.pl162).every((s) => s.m.fill === 0 && s.m.nf.paused_placement === s.m.req - s.m.err)).toBe(true)
  })
  it("respects flights, stop days and heartbeats", () => {
    const c = (proto: string) => out.delivery.filter((d) => d.c === demo.idMap[proto])
    expect(c("c4")).toEqual([]) // scheduled
    expect(c("c5")).toEqual([]) // creative in review
    expect(c("c8")).toEqual([]) // draft
    const lastDay = (proto: string) => c(proto).reduce((a, d) => Math.max(a, d.d.getTime()), 0)
    expect(lastDay("c3")).toBe(dayStart(addDays(TODAY, -5)).getTime())
    expect(lastDay("c10")).toBe(dayStart(addDays(TODAY, -7)).getTime())
    expect(lastDay("c7")).toBe(dayStart("2026-09-30").getTime())
    const p16 = demo.idMap.p16
    expect(out.supply.some((s) => s.p === p16 && s.d.getTime() === dayStart(TODAY).getTime())).toBe(false)
    expect(out.samples.filter((s) => s.propertyId === p16).every((s) => Date.parse(s.at) <= NOW - 26 * 3_600_000)).toBe(true)
  })
  it("stats add up the rows (plus pre-window history)", () => {
    for (const s of out.stats) {
      const rows = out.delivery.filter((d) => d.c === s.campaignId)
      const imp = rows.reduce((a, d) => a + d.m.imp, 0)
      const hist = demo.sim.campaigns[s.campaignId].histSpendMicros
      if (!hist) expect(s.lifetime.imp).toBe(imp)
      else expect(s.lifetime.imp).toBeGreaterThan(imp)
      const todayImp = rows.filter((d) => d.d.getTime() === dayStart(TODAY).getTime()).reduce((a, d) => a + d.m.imp, 0)
      expect(s.today).toMatchObject({ d: TODAY, imp: todayImp })
    }
    expect(out.stats.find((s) => s.campaignId === demo.idMap.c11)!.lifetime.costMicros).toBe(4_870_000_000)
  })
  it("samples cover the last 24 hours", () => {
    expect(out.samples.length).toBeGreaterThan(100)
    for (const s of out.samples) expect(Date.parse(s.at)).toBeGreaterThanOrEqual(NOW - 24 * 3_600_000)
  })
  it("distribute splits exactly", () => {
    expect(distribute(10, [1, 1, 1])).toEqual([4, 3, 3])
    expect(distribute(0, [1, 2])).toEqual([0, 0])
    expect(distribute(5, [0, 0])).toEqual([5, 0])
  })
})
