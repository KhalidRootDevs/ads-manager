import type { Db } from "@orbit/db"
import { addDays, dayStart, REDIS_KEYS, todayKey } from "@orbit/domain"
import type { MongoMemoryReplSet } from "mongodb-memory-server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { expireGraceKeys, reconcile, runAutoPause, runHeartbeatMissing, runTransitions, syncAlerts } from "../src/jobs/repo"
import { cleanRedis, makeCampaign, makeCreative, makeKey, makePlacement, makeProperty, seedBasics, startDb, testRedis } from "./helpers"

let rs: MongoMemoryReplSet
let db: Db
const redis = testRedis()

beforeAll(async () => {
  ;({ rs, db } = await startDb())
  await seedBasics(db)
})
afterAll(async () => {
  await cleanRedis(redis)
  redis.disconnect()
  await db?.close()
  await rs?.stop()
})

describe("jobs", () => {
  it("persists status transitions in the campaign time zone with audit", async () => {
    const p = await makeProperty(db)
    const pl = await makePlacement(db, p)
    const cr = await makeCreative(db)
    const t = [{ propertyId: p, countryRule: { mode: "all", countries: [] }, placementIds: [pl], destinationOverride: null }]
    const start = "2026-10-20"
    const sched = await makeCampaign(db, { status: "scheduled", creativeIds: [cr], targets: t, start, end: "2026-10-25" })
    const ending = await makeCampaign(db, { status: "active", creativeIds: [cr], targets: t, start: "2026-10-01", end: "2026-10-19" })
    // 23:59 on Oct 19 in Dhaka: nothing moves yet
    let r = await runTransitions(db, new Date(dayStart(start, "Asia/Dhaka").getTime() - 60_000))
    expect(r).toEqual({ started: [], completed: [] })
    r = await runTransitions(db, dayStart(start, "Asia/Dhaka"))
    expect(r).toEqual({ started: [sched], completed: [ending] })
    const c = await db.models.Campaign.findById(sched).lean()
    expect(c).toMatchObject({ status: "active", rev: 1 })
    const audit = await db.models.AuditLog.find({ "target.id": trustedIn([sched, ending]) }).lean()
    expect(audit.map((a) => a.action).sort()).toEqual(["campaign.completed", "campaign.started"])
    expect(audit[0].actor).toEqual({ id: null, name: "System" })
  })

  it("opens, refreshes and resolves alerts", async () => {
    const p = await makeProperty(db)
    const pl = await makePlacement(db, p)
    const cr = await makeCreative(db, { status: "in_review" })
    const today = todayKey()
    const camp = await makeCampaign(db, { creativeIds: [cr], targets: [{ propertyId: p, countryRule: { mode: "include", countries: ["US"] }, placementIds: [pl], destinationOverride: null }], start: today, end: addDays(today, 5) })
    const s1 = await syncAlerts(db)
    expect(s1.opened).toBeGreaterThanOrEqual(2) // not_delivering + country_conflict (US disabled)
    const open1 = await db.models.Alert.find({ status: "open", "entity.id": camp }).lean()
    expect(open1.map((a) => a.type).sort()).toEqual(["country_conflict", "not_delivering"])
    const s2 = await syncAlerts(db)
    expect(s2.opened).toBe(0)
    await db.models.Creative.updateOne({ _id: cr }, { $set: { status: "ready" } })
    await syncAlerts(db)
    const nd = await db.models.Alert.findOne({ dedupeKey: `not_delivering:${camp}:${cr}` }).lean()
    expect(nd!.status).toBe("resolved")
    expect(nd!.resolvedAt).toBeInstanceOf(Date)
  })

  it("detects missing heartbeats on production properties", async () => {
    const stale = await makeProperty(db, { sdk: { state: "healthy", version: "2.5.0", lastHeartbeatAt: new Date(Date.now() - 31 * 60_000) } })
    const staging = await makeProperty(db, { env: "staging", sdk: { state: "healthy", version: "2.5.0", lastHeartbeatAt: new Date(Date.now() - 31 * 60_000) } })
    const ids = await runHeartbeatMissing(db)
    expect(ids).toContain(stale)
    expect(ids).not.toContain(staging)
    const doc = await db.models.Property.findById(stale).lean()
    expect(doc!.sdk.state).toBe("heartbeat_missing")
    expect(doc!.rev).toBe(0)
  })

  it("auto-pauses on budget, expires grace keys and reconciles stats", async () => {
    const p = await makeProperty(db)
    const pl = await makePlacement(db, p)
    const cr = await makeCreative(db)
    const today = todayKey()
    const camp = await makeCampaign(db, { budgetMicros: 1000, creativeIds: [cr], targets: [{ propertyId: p, countryRule: { mode: "all", countries: [] }, placementIds: [pl], destinationOverride: null }], start: today, end: addDays(today, 5) })
    await db.models.CampaignStats.create({ _id: camp, lifetime: { imp: 99, clk: 0, conv: 0, costMicros: 5000n }, today: {}, updatedAt: new Date() })
    expect(await runAutoPause(db)).toEqual([camp])
    expect((await db.models.Campaign.findById(camp).lean())!.status).toBe("paused")

    const k = await makeKey(db, p, "ok_live_grace", "pep", { status: "grace", graceUntil: new Date(Date.now() - 1000) })
    expect(await expireGraceKeys(db)).toBe(1)
    expect((await db.models.PropertyKey.findById(k).lean())!.status).toBe("revoked")

    // stats say 99 impressions; rollups have none → repaired to 0, spend reset in Redis
    const r = await reconcile(db, redis)
    expect(r.repaired.some((x) => x.id === camp && x.field === "imp")).toBe(true)
    expect((await db.models.CampaignStats.findById(camp).lean())!.lifetime.imp).toBe(0)
    expect(await redis.get(REDIS_KEYS.spend(camp))).toBe("0")
  })
})

import { trusted } from "@orbit/db"
function trustedIn(ids: string[]) {
  return trusted({ $in: ids })
}

import { indexUsage } from "../src/jobs/repo"
describe("index usage report", () => {
  it("lists declared indexes with access counts", async () => {
    const { rows, unavailable } = await indexUsage(db)
    expect(unavailable).toEqual([])
    expect(rows.some((r) => r.collection === "delivery_daily" && r.index === "c_1_d_1")).toBe(true)
    expect(rows.find((r) => r.index === "dedupeKey_1_open")?.flagged).toBe(false) // unique → never flagged
  })
})
