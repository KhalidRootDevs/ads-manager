import type { Db } from "@orbit/db"
import { newId, type StreamEvent } from "@orbit/domain"
import type { MongoMemoryReplSet } from "mongodb-memory-server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { applyAttribution } from "../src/attribution/repo"
import { startDb } from "./helpers"

let rs: MongoMemoryReplSet
let db: Db
const now = Date.parse("2026-10-19T09:00:00Z")
const dims = { c: newId("campaign"), cr: newId("creative"), p: newId("property"), pl: newId("placement"), cc: "BD", dv: "ph", pf: "an", f: "banner" }
const clickId = newId("click")
const oldClick = newId("click")

beforeAll(async () => {
  ;({ rs, db } = await startDb())
})
afterAll(async () => {
  await db?.close()
  await rs?.stop()
})

const conv = (id: string, event: string, at = now) => ({ k: "conv", id: newId("request"), at, clickId: id, event, valueMicros: 2_000_000, source: "server" }) as StreamEvent

describe("attribution", () => {
  it("stores clicks and counts each conversion once", async () => {
    await applyAttribution(db, "attribution:1", [
      { offset: "1", event: { k: "clk", id: "a", at: now - 3600_000, r: "r", clickId, ...dims } as StreamEvent },
      { offset: "2", event: { k: "clk", id: "b", at: now - 9 * 86_400_000, r: "r", clickId: oldClick, ...dims } as StreamEvent },
    ], now)
    expect(await db.models.Click.countDocuments()).toBe(2)

    const r = await applyAttribution(db, "attribution:7", [
      { offset: "10", event: conv(clickId, "trial_start") },
      { offset: "11", event: conv(clickId, "trial_start") }, // duplicate in batch
      { offset: "12", event: conv(newId("click"), "trial_start") }, // unknown click
      { offset: "13", event: conv(oldClick, "trial_start") }, // outside the 7-day window
    ], now)
    expect(r).toMatchObject({ conversions: 1, duplicates: 1, unknownClick: 1, expired: 1 })

    // a later re-send (new offset) of the same conversion is deduplicated by _id
    const r2 = await applyAttribution(db, "attribution:7", [{ offset: "14", event: conv(clickId, "trial_start") }], now)
    expect(r2).toMatchObject({ conversions: 0, duplicates: 1 })
    // replay of applied offsets is skipped by the watermark
    const r3 = await applyAttribution(db, "attribution:7", [{ offset: "10", event: conv(clickId, "purchase") }], now)
    expect(r3.skipped).toBe(1)

    const stats = await db.models.CampaignStats.findById(dims.c).lean()
    expect(stats!.lifetime.conv).toBe(1)
    const row = await db.models.DeliveryDaily.findOne({ c: dims.c }).lean()
    expect(row!.m!.conv).toBe(1)
    const cv = await db.models.Conversion.findById(`${clickId}:trial_start`).lean()
    expect(cv).toMatchObject({ c: dims.c, source: "server" })
  })
})
