import type { Db } from "@orbit/db"
import { dateKeyInTz, newId, REDIS_KEYS, reportingDay, type StreamEvent } from "@orbit/domain"
import type { MongoMemoryReplSet } from "mongodb-memory-server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { afterCommit } from "../src/aggregator"
import { aggregate } from "../src/aggregator/aggregate"
import { applyRollups } from "../src/aggregator/repo"
import { cleanRedis, log, makeProperty, startDb, testRedis } from "./helpers"

let rs: MongoMemoryReplSet
let db: Db
const redis = testRedis()
const now = Date.parse("2026-10-19T09:00:00Z") // 15:00 Asia/Dhaka
const dims = { c: newId("campaign"), cr: newId("creative"), p: newId("property"), pl: newId("placement"), cc: "BD", dv: "ph", pf: "an", f: "banner" }

const imp = (at: number, extra: Partial<StreamEvent> = {}) => ({ k: "imp", id: newId("request"), at, r: newId("request"), cpi: 1800, ...dims, ...extra }) as StreamEvent
const supply = (at: number, result: "filled" | "no_fill", reason: string | null, extra: object = {}) =>
  ({ k: "supply", id: newId("request"), at, r: newId("request"), p: dims.p, pl: dims.pl, cc: "BD", dv: "ph", pf: "an", result, reason, latencyMs: 4, sdk: "2.5.0", ...extra }) as StreamEvent

beforeAll(async () => {
  ;({ rs, db } = await startDb())
})
afterAll(async () => {
  await cleanRedis(redis)
  redis.disconnect()
  await db?.close()
  await rs?.stop()
})

const batch: { offset: string; event: StreamEvent }[] = []
beforeAll(() => {
  let o = 100
  const push = (e: StreamEvent) => batch.push({ offset: String(o++), event: e })
  push(imp(now - 60_000))
  push(imp(now - 30_000))
  push({ ...imp(now - 20_000), k: "view" } as StreamEvent)
  push({ k: "clk", id: "x", at: now - 10_000, r: "r", clickId: newId("click"), ...dims } as StreamEvent)
  push(imp(now - 5_000, { t: 1 } as never)) // test → skipped
  push(imp(now - 20 * 3600_000)) // late but < 24 h: 13:00Z Oct 18 = 19:00 Dhaka → Oct 18 bucket
  push(imp(now - 30 * 3600_000)) // > 24 h → DLQ
  push(supply(now - 1000, "filled", null))
  push(supply(now - 900, "no_fill", "country", { sample: 1 }))
  push(supply(now - 800, "no_fill", "no_candidates"))
  push(supply(now - 700, "filled", null, { t: 1 })) // test supply: sampled, not rolled up
})

describe("rollup aggregator", () => {
  it("aggregates in memory (pure)", () => {
    const a = aggregate(batch, now)
    expect(a.counts.test).toBe(2)
    expect(a.dlq).toEqual([{ offset: "106", reason: "late" }])
    expect(a.samples.map((s) => s.result)).toEqual(["204 No fill: country", "200 Served (test)"])
  })

  it("applies a batch transactionally and skips it on replay", async () => {
    const r1 = await applyRollups(db, "events.v1:3", batch, now)
    expect(r1.lastOffset).toBe("110")
    await afterCommit(db, redis, r1.agg!, log)
    const r2 = await applyRollups(db, "events.v1:3", batch, now) // redelivery after a crash before the Kafka commit
    expect(r2.agg).toBeNull()

    const rows = await db.models.DeliveryDaily.find({ c: dims.c }).lean()
    const today = rows.find((r) => r.d.getTime() === reportingDay(now).getTime())!
    expect(today.m!.imp).toBe(2)
    expect(today.m!.view).toBe(1)
    expect(today.m!.clk).toBe(1)
    expect(Number(today.m!.costMicros)).toBe(3600)
    expect(today.h!.imp[14]).toBe(2) // 08:59Z = 14:59 Asia/Dhaka
    const late = rows.find((r) => r.d.getTime() !== reportingDay(now).getTime())!
    expect(dateKeyInTz(late.d)).toBe("2026-10-18")
    expect(late.m!.imp).toBe(1)

    const stats = await db.models.CampaignStats.findById(dims.c).lean()
    expect(stats!.lifetime.imp).toBe(3)
    expect(stats!.lifetime.clk).toBe(1)
    expect(Number(stats!.lifetime.costMicros)).toBe(5400)
    expect(stats!.today.imp).toBe(2)

    const sup = await db.models.SupplyDaily.find({ p: dims.p }).lean()
    expect(sup).toHaveLength(1)
    expect(sup[0].m).toMatchObject({ req: 3, elig: 2, fill: 1, err: 0, nf: { country: 1, no_candidates: 1 } })

    const samples = await db.models.RequestSample.find({ "k.p": dims.p }).lean()
    expect(samples).toHaveLength(2)

    expect(await redis.get(REDIS_KEYS.spend(dims.c))).toBe("5400")
    const wm = await db.models.RollupOffset.findById("events.v1:3").lean()
    expect(wm!.offset).toBe("110")
  })

  it("applies only the messages above the watermark when a batch overlaps", async () => {
    const more = [...batch.slice(-2), { offset: "111", event: imp(now - 1000) }]
    const r = await applyRollups(db, "events.v1:3", more, now)
    expect(r.skipped).toBe(2)
    const stats = await db.models.CampaignStats.findById(dims.c).lean()
    expect(stats!.lifetime.imp).toBe(4)
  })

  it("updates the property heartbeat without touching rev", async () => {
    const p = await makeProperty(db, { sdk: { state: "heartbeat_missing", version: "2.0.0", lastHeartbeatAt: null } })
    const r = await applyRollups(db, "events.v1:5", [{ offset: "1", event: { k: "hb", id: "h", at: now, p, sdk: "2.5.0", testMode: false } }], now)
    await afterCommit(db, redis, r.agg!, log)
    const doc = await db.models.Property.findById(p).lean()
    expect(doc!.sdk).toMatchObject({ state: "healthy", version: "2.5.0" })
    expect(doc!.rev).toBe(0)
  })
})
