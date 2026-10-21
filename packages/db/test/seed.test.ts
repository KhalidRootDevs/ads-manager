import { dateKeyInTz } from "@orbit/domain"
import { hashKeySecret } from "@orbit/domain/node"
import { MongoMemoryReplSet } from "mongodb-memory-server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { connect, deliveryId, indexDrift, supplyId, VALIDATORS, type Db } from "../src"
import { ensureMigrated, hasData, resetDatabase, seedDatabase, type SeedResult } from "../src/seed"

let rs: MongoMemoryReplSet
let db: Db
let res: SeedResult
const PEPPER = "test-pepper"
const TODAY = "2026-10-19"
const NOW = Date.parse("2026-10-19T08:30:00Z") // 14:30 in Dhaka

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } })
  db = await connect({ uri: rs.getUri(), dbName: "orbit_seed_test", service: "test", analyticsReadPreference: "primary" })
  expect(await ensureMigrated(db)).toBe(true)
  res = await seedDatabase(db, { pepper: PEPPER, today: TODAY, now: NOW })
}, 180_000)
afterAll(async () => {
  await db?.close()
  await rs?.stop()
})

describe("seed", () => {
  it("does not re-run migrations once applied", async () => {
    expect(await ensureMigrated(db)).toBe(false)
  })

  it("inserts the demo workspace", async () => {
    const m = db.models
    expect(await hasData(db)).toBe(true)
    expect(await m.User.countDocuments()).toBe(9)
    expect(await m.Property.countDocuments()).toBe(38)
    expect(await m.Placement.countDocuments()).toBe(30)
    expect(await m.Creative.countDocuments()).toBe(15)
    expect(await m.Campaign.countDocuments()).toBe(11)
    expect(await m.Country.countDocuments()).toBe(res.demo.countries.length)
    expect(await m.Settings.countDocuments()).toBe(1)
    expect(await m.PropertyKey.countDocuments()).toBe(res.demo.propertyKeys.length)
    expect(await m.Alert.countDocuments()).toBe(res.demo.alerts.length)
    expect(await m.CampaignStats.countDocuments()).toBe(res.analytics.stats.length)
    expect(await m.DeliveryDaily.collection.countDocuments()).toBe(res.analytics.delivery.length)
    expect(await m.SupplyDaily.collection.countDocuments()).toBe(res.analytics.supply.length)
    expect(await m.RequestSample.collection.countDocuments()).toBe(res.analytics.samples.length)
    for (const [name, n] of Object.entries(res.counts)) expect(await db.primary.db!.collection(name).countDocuments(), name).toBe(n)
  })

  it("stores the owner for dev login and hashed keys only", async () => {
    const owner = await db.models.User.findOne({ email: "arif.hossain@orbit.example" }).lean()
    expect(owner?.role).toBe("owner")
    const key = await db.models.PropertyKey.findOne({ status: "active", env: "live" }).lean()
    const secret = res.secrets.find((s) => s.keyId === key!._id)!.secret
    expect(key!.hash).toBe(hashKeySecret(secret, PEPPER))
    expect(JSON.stringify(key)).not.toContain(secret)
    expect(secret.slice(-4)).toBe(key!.last4)
  })

  it("uses the right BSON types", async () => {
    const coll = (n: string) => db.primary.db!.collection(n)
    expect(await coll("campaigns").countDocuments({ "budget.amountMicros": { $type: "long" } })).toBe(11)
    expect(await coll("campaigns").countDocuments({ "flight.start": { $type: "date" } })).toBe(11)
    expect(await coll("campaigns").countDocuments({ live: true })).toBe(10)
    expect(await coll("budgets").countDocuments({ amountMicros: { $type: "long" } })).toBe(6)
    expect(await coll("delivery_daily").countDocuments({ "m.costMicros": { $not: { $type: "long" } } })).toBe(0)
    expect(await coll("delivery_daily").countDocuments({ d: { $not: { $type: "date" } } })).toBe(0)
    const d = await coll("delivery_daily").findOne({})
    expect(d!.h.imp).toHaveLength(24)
    expect(d!._id).toBe(deliveryId({ day: dateKeyInTz(d!.d), c: d!.c, p: d!.p, pl: d!.pl, cr: d!.cr, cc: d!.cc, dv: d!.dv, pf: d!.pf, f: d!.f }))
    const s = await coll("supply_daily").findOne({})
    expect(s!._id).toBe(supplyId({ day: dateKeyInTz(s!.d), p: s!.p, pl: s!.pl, cc: s!.cc, dv: s!.dv, pf: s!.pf }))
  })

  it("passes every $jsonSchema validator (re-validated in place)", async () => {
    for (const [name, validator] of Object.entries(VALIDATORS)) {
      const total = await db.primary.db!.collection(name).countDocuments()
      if (!total) continue
      const bad = await db.primary.db!.collection(name).countDocuments({ $nor: [validator] })
      expect(bad, name).toBe(0)
    }
  })

  it("passes Mongoose validation on read-back", async () => {
    const m = db.models
    for (const model of [m.User, m.Property, m.PropertyKey, m.Placement, m.Creative, m.Campaign, m.Budget, m.Audience, m.AuditLog, m.Alert, m.Settings]) {
      const docs = await (model as unknown as import("mongoose").Model<unknown>).find({})
      for (const doc of docs) await expect(doc.validate(), model.modelName).resolves.toBeUndefined()
    }
  })

  it("has no index drift", async () => {
    expect(await indexDrift(db)).toEqual([])
  })

  it("reset empties only Orbit collections and keeps _migrations", async () => {
    const deleted = await resetDatabase(db)
    expect(deleted.campaigns).toBe(11)
    expect(await hasData(db)).toBe(false)
    expect(await db.primary.db!.collection("_migrations").countDocuments()).toBeGreaterThan(0)
    // and the seed can run again on the emptied collections
    const again = await seedDatabase(db, { pepper: PEPPER, today: TODAY, now: NOW })
    expect(again.counts.campaigns).toBe(11)
    expect(await indexDrift(db)).toEqual([])
  })
})
