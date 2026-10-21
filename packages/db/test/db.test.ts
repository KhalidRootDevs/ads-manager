import { dayStart, newId } from "@orbit/domain"
import { MongoMemoryReplSet } from "mongodb-memory-server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { connect, declaredIndexes, deliveryUpsert, emptyDeliveryDelta, EXPECTED_INDEX_COUNT, indexDrift, runMigrations, trusted, type Db } from "../src"

let rs: MongoMemoryReplSet
let db: Db

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } })
  db = await connect({ uri: rs.getUri(), dbName: "orbit_test", service: "test", analyticsReadPreference: "primary" })
  await runMigrations(db, () => {})
})
afterAll(async () => {
  await db?.close()
  await rs?.stop()
})

describe("schema and indexes", () => {
  it("declares exactly the §6.6 inventory", () => {
    expect(declaredIndexes(db.models)).toHaveLength(EXPECTED_INDEX_COUNT)
  })

  it("has no drift after migrating", async () => {
    expect(await indexDrift(db)).toEqual([])
  })

  it("is idempotent", async () => {
    await runMigrations(db, () => {})
    expect(await indexDrift(db)).toEqual([])
  })

  it("refuses non-Orbit databases", async () => {
    await expect(connect({ uri: rs.getUri(), dbName: "samsad-portfolio", service: "test" })).rejects.toThrow(/Refusing/)
  })
})

describe("sanitizeFilter", () => {
  it("neutralises operator injection but allows trusted operators", async () => {
    const { User } = db.models
    await User.create({ _id: newId("user"), email: "a@example.com", name: "A", role: "admin", status: "active" })
    // sanitizeFilter wraps the injected operator in $eq; casting then rejects it (the API maps CastError → 400)
    await expect(User.find({ email: { $ne: null } } as never).lean()).rejects.toThrow(/Cast to string failed/)
    const ok = await User.find({ email: trusted({ $ne: null }) }).lean()
    expect(ok).toHaveLength(1)
  })

  it("enforces case-insensitive unique email", async () => {
    await expect(db.models.User.create({ _id: newId("user"), email: "A@EXAMPLE.COM", name: "A2", role: "admin", status: "active" })).rejects.toThrow(/duplicate key/)
  })
})

describe("rollup pipeline upsert", () => {
  it("creates 24-slot arrays and increments in place, idempotent per op", async () => {
    const day = "2026-10-19"
    const k = { day, d: dayStart(day), c: newId("campaign"), p: newId("property"), pl: newId("placement"), cr: newId("creative"), cc: "BD", dv: "ph", pf: "an", f: "banner" }
    const x = { ...emptyDeliveryDelta(), imp: 120, clk: 1, costMicros: 216_000 }
    x.hImp[21] = 120
    x.hClk[21] = 1
    const coll = db.models.DeliveryDaily.collection
    await coll.bulkWrite([deliveryUpsert(k, x) as never], { ordered: false })
    await coll.bulkWrite([deliveryUpsert(k, x) as never], { ordered: false })
    const doc = (await coll.findOne({})) as unknown as { m: { imp: number; costMicros: unknown }; h: { imp: number[]; clk: number[] } }
    expect(doc.m.imp).toBe(240)
    expect(Number(doc.m.costMicros)).toBe(432_000)
    expect(doc.h.imp).toHaveLength(24)
    expect(doc.h.imp[21]).toBe(240)
    expect(doc.h.clk[20]).toBe(0)
  })

  it("rejects malformed rollups via $jsonSchema", async () => {
    await expect(db.models.DeliveryDaily.collection.insertOne({ _id: "x", d: new Date(), c: "c", p: "p", pl: "pl", cr: "cr", cc: "bd", dv: "xx", pf: "an", f: "banner", m: {} } as never)).rejects.toThrow(/validation/i)
  })
})
