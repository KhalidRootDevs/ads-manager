import { gunzipSync } from "node:zlib"
import type { Db } from "@orbit/db"
import { addDays, dayStart, SERVING, todayKey, type ServingIndex } from "@orbit/domain"
import type { MongoMemoryReplSet } from "mongodb-memory-server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { compileOnce } from "../src/compiler"
import { flightKey } from "../src/compiler/compile"
import { IGNORED_FIELDS, openStreams } from "../src/compiler/streams"
import { cleanRedis, log, makeCampaign, makeCreative, makeKey, makePlacement, makeProperty, seedBasics, startDb, testRedis } from "./helpers"

let rs: MongoMemoryReplSet
let db: Db
const redis = testRedis()
const ids: Record<string, string> = {}

beforeAll(async () => {
  ;({ rs, db } = await startDb())
  await seedBasics(db)
  ids.prop = await makeProperty(db) // exclude PK; US disabled platform-wide
  ids.paused = await makeProperty(db, { status: "paused" })
  ids.key = await makeKey(db, ids.prop, "ok_live_secret1", "pep")
  ids.revoked = await makeKey(db, ids.prop, "ok_live_secret2", "pep", { status: "revoked" })
  ids.banner = await makePlacement(db, ids.prop)
  ids.native = await makePlacement(db, ids.prop, { format: "native", size: "fluid" })
  ids.pausedPl = await makePlacement(db, ids.prop, { status: "paused" })
  ids.big = await makePlacement(db, ids.prop, { size: "320x100" })
  ids.cr = await makeCreative(db)
  ids.crDraft = await makeCreative(db, { status: "draft" })
  const today = todayKey("Asia/Dhaka")
  ids.camp = await makeCampaign(db, {
    creativeIds: [ids.cr, ids.crDraft], start: today, end: addDays(today, 10),
    targets: [{ propertyId: ids.prop, countryRule: { mode: "include", countries: ["BD", "PK", "US"] }, placementIds: [ids.banner, ids.native, ids.pausedPl, ids.big], destinationOverride: null }],
  })
  ids.draftOnly = await makeCampaign(db, { creativeIds: [ids.crDraft], start: today, end: addDays(today, 3), targets: [{ propertyId: ids.prop, countryRule: { mode: "all", countries: [] }, placementIds: [ids.banner], destinationOverride: null }] })
  ids.paused1 = await makeCampaign(db, { status: "paused", creativeIds: [ids.cr], start: today, end: addDays(today, 3), targets: [{ propertyId: ids.prop, countryRule: { mode: "all", countries: [] }, placementIds: [ids.banner], destinationOverride: null }] })
})
afterAll(async () => {
  await cleanRedis(redis)
  redis.disconnect()
  await db?.close()
  await rs?.stop()
})

async function current(): Promise<ServingIndex> {
  const v = await redis.get(SERVING.current)
  const buf = await redis.getBuffer(SERVING.index(v!))
  return JSON.parse(gunzipSync(buf!).toString())
}

describe("config-compiler", () => {
  it("publishes a gzip index with correct candidates", async () => {
    const { version } = await compileOnce(db, redis, log)
    const idx = await current()
    expect(idx.version).toBe(version)
    const banner = idx.placements[ids.banner]
    expect(banner.candidates.map((c) => c.campaignId)).toEqual([ids.camp]) // draft-only and paused campaigns are not compiled in
    const c = banner.candidates[0]
    expect(c.countries).toEqual(["BD"]) // PK excluded by the property, US disabled → conflicts removed
    expect(c.creatives.map((x) => x.id)).toEqual([ids.cr]) // draft creative excluded
    expect(c.creatives[0].payload.clickUrl).toBe("https://example.com/land?utm_source=orbit&utm_medium=banner")
    const today = todayKey("Asia/Dhaka")
    expect(c.startMs).toBe(dayStart(today, "Asia/Dhaka").getTime())
    expect(c.endMs).toBe(dayStart(addDays(today, 11), "Asia/Dhaka").getTime())
    expect(idx.placements[ids.native].candidates).toHaveLength(0) // incompatible format
    expect(idx.placements[ids.big].candidates).toHaveLength(0) // size mismatch
    expect(idx.placements[ids.pausedPl].active).toBe(false)
    expect(idx.properties[ids.paused].active).toBe(false)
    expect(idx.properties[ids.prop].keys.map((k) => k.id)).toEqual([ids.key]) // revoked key not shipped
    expect(idx.ecpm.banner).toBeGreaterThan(0)
  })

  it("persists campaign health without touching rev/updatedAt, only when it changed", async () => {
    const before = await db.models.Campaign.findById(ids.camp).lean()
    expect(before!.health.issues.map((i) => i.code).sort()).toEqual(["country_conflict", "country_conflict", "creative_not_ready"])
    expect(before!.rev).toBe(0)
    const checked = before!.health.checkedAt
    await compileOnce(db, redis, log)
    const after = await db.models.Campaign.findById(ids.camp).lean()
    expect(after!.health.checkedAt).toEqual(checked) // unchanged → no write
    expect((after as { updatedAt?: Date }).updatedAt).toEqual((before as { updatedAt?: Date }).updatedAt)
  })

  it("keeps the last 3 versions", async () => {
    await compileOnce(db, redis, log)
    await compileOnce(db, redis, log)
    expect(await redis.llen(SERVING.versions)).toBe(3)
  })

  it("flight keys accept UTC-midnight and tz-midnight dates", () => {
    expect(flightKey(new Date("2026-10-19T00:00:00Z"), "Asia/Dhaka")).toBe("2026-10-19")
    expect(flightKey(dayStart("2026-10-19", "Asia/Dhaka"), "Asia/Dhaka")).toBe("2026-10-19")
  })

  it("change streams fire on serving changes and ignore health-only writes", async () => {
    const seen: string[] = []
    const s = await openStreams(db, redis, log, (c) => seen.push(c), () => {})
    await new Promise((r) => setTimeout(r, 500))
    await db.models.Campaign.collection.updateOne({ _id: ids.camp } as never, { $set: { "health.checkedAt": new Date() } })
    await db.models.Property.collection.updateOne({ _id: ids.prop } as never, { $set: { "sdk.lastHeartbeatAt": new Date() } })
    await db.models.Placement.updateOne({ _id: ids.big }, { $set: { status: "paused" } })
    await new Promise((r) => setTimeout(r, 1500))
    await s.close()
    expect(seen).toEqual(["placements"])
    expect(IGNORED_FIELDS.test("health.issues")).toBe(true)
    expect(IGNORED_FIELDS.test("status")).toBe(false)
  })
})
