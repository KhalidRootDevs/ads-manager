import { randomBytes } from "node:crypto"
import { connect, runMigrations, type Db } from "@orbit/db"
import { newId } from "@orbit/domain"
import { hashKeySecret } from "@orbit/domain/node"
import { createLogger, createRedis, type Redis } from "@orbit/server-kit"
import { MongoMemoryReplSet } from "mongodb-memory-server"

export const log = createLogger("test", "silent")
/** Fixture inserts with plain strings for enum fields (Mongoose's literal types are stricter than test data). */
const M = (db: Db) => db.models as unknown as Record<string, { create(d: unknown): Promise<unknown> }>

export async function startDb(): Promise<{ rs: MongoMemoryReplSet; db: Db }> {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } })
  const db = await connect({ uri: rs.getUri(), dbName: "orbit_test", service: "test", analyticsReadPreference: "primary" })
  await runMigrations(db, () => {})
  return { rs, db }
}

/** Redis DB 15 with a unique key prefix per test file. */
export function testRedis(): Redis {
  return createRedis("redis://localhost:6379/15", { keyPrefix: `t${randomBytes(4).toString("hex")}:` })
}

export async function cleanRedis(r: Redis) {
  const prefix = r.options.keyPrefix ?? ""
  const keys = await r.keys("*") // ioredis prefixes the pattern; results carry the prefix
  const raw = createRedis("redis://localhost:6379/15")
  if (keys.length) await raw.del(...keys.filter((k) => k.startsWith(prefix)))
  raw.disconnect()
}

const sdk = { state: "healthy", version: "2.5.0", lastHeartbeatAt: new Date() }

export async function seedBasics(db: Db) {
  const m = db.models
  await M(db).Country.create([
    { _id: "BD", name: "Bangladesh", region: "Asia", enabled: true },
    { _id: "IN", name: "India", region: "Asia", enabled: true },
    { _id: "PK", name: "Pakistan", region: "Asia", enabled: true },
    { _id: "US", name: "United States", region: "Americas", enabled: false },
  ])
  await M(db).Settings.create({ _id: "global", reportingTz: "Asia/Dhaka", currency: "USD", defaults: { freqCap: null, refreshSec: 60 }, tracking: { clicks: true, viewability: true, ipTruncation: true }, autoPauseOnBudget: true, killSwitch: false })
}

export async function makeProperty(db: Db, o: Partial<{ platform: string; identifier: string; status: string; countryRule: object; env: string; sdk: object }> = {}) {
  const id = newId("property")
  await M(db).Property.create({
    _id: id, name: `Prop ${id.slice(-4)}`, platform: o.platform ?? "android", identifier: o.identifier ?? `com.test.app${id.slice(-6).toLowerCase()}`, team: "Sports",
    env: o.env ?? "production", status: o.status ?? "active", formats: ["banner", "native"], countryRule: o.countryRule ?? { mode: "exclude", countries: ["PK"] }, sdk: o.sdk ?? sdk, testMode: false,
  })
  return id
}

export async function makeKey(db: Db, propertyId: string, secret: string, pepper: string, o: Partial<{ status: string; env: string; graceUntil: Date | null }> = {}) {
  const id = newId("key")
  await M(db).PropertyKey.create({ _id: id, propertyId, label: "test key", env: o.env ?? "live", prefix: "ok_live_", last4: secret.slice(-4), hash: hashKeySecret(secret, pepper), status: o.status ?? "active", graceUntil: o.graceUntil ?? null })
  return id
}

export async function makePlacement(db: Db, propertyId: string, o: Partial<{ format: string; size: string; status: string; name: string }> = {}) {
  const id = newId("placement")
  await M(db).Placement.create({ _id: id, propertyId, name: o.name ?? `Slot ${id.slice(-5)}`, format: o.format ?? "banner", size: o.size ?? "320x50", status: o.status ?? "active", minAppVersion: null, freqCap: null, refreshSec: null })
  return id
}

export async function makeCreative(db: Db, o: Partial<{ format: string; size: string; status: string }> = {}) {
  const id = newId("creative")
  await M(db).Creative.create({
    _id: id, name: `Creative ${id.slice(-4)}`, format: o.format ?? "banner", size: o.size ?? "320x50", status: o.status ?? "ready",
    assets: [{ kind: "image", url: "https://cdn.example.com/a.png", name: "a.png", mime: "image/png", bytes: 1000, width: 320, height: 50, durationSec: null, sha256: null }],
    copy: { headline: "Hello", body: "", cta: "Go" }, destination: { url: "https://example.com/land", deepLink: null, utm: { source: "orbit", medium: "banner", campaign: "" } },
    altText: "alt", options: {}, review: { state: "approved", by: null, at: null, reason: null },
  })
  return id
}

export async function makeCampaign(db: Db, o: { creativeIds: string[]; targets: object[]; status?: string; start: string; end: string; tz?: string; budgetMicros?: number; name?: string }) {
  const id = newId("campaign")
  await M(db).Campaign.create({
    _id: id, name: o.name ?? `Campaign ${id.slice(-6)}`, objective: "awareness", status: o.status ?? "active", team: "Sports",
    flight: { start: new Date(o.start + "T00:00:00Z"), end: new Date(o.end + "T00:00:00Z"), tz: o.tz ?? "Asia/Dhaka" },
    priority: 2, creativeIds: o.creativeIds, targets: o.targets,
    constraints: { days: [], hours: { from: 0, to: 24 }, devices: [], minAppVersion: null, freqCap: null, audienceIds: [] },
    budget: { amountMicros: BigInt(o.budgetMicros ?? 100_000_000), pacing: "even", goal: null }, live: true,
  })
  return id
}
