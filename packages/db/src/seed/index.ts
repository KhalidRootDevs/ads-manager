/**
 * Demo seed (`pnpm db:seed`). Builds the demo workspace from `@orbit/domain/demo`, converts the DTO shapes to
 * persisted documents and inserts them:
 * - operational collections through the Mongoose models (`insertMany`, ordered: false, batches of 1000), so the
 *   schemas (strict: "throw") and the `$jsonSchema` validators both check every document;
 * - rollups and request samples through the native driver (`Model.collection.insertMany`) with explicit BSON types.
 *
 * Safety: `resetDatabase()` only runs `deleteMany({})` on Orbit's own models inside the connected Orbit database.
 * It never drops anything and never touches `_migrations`.
 */
import { dayStart, todayKey, type Campaign } from "@orbit/domain"
import { buildDemo, generateDelivery, refreshHealth, spentByCampaign, type Demo, type DeliveryOutput } from "@orbit/domain/demo"
import { generateKeySecret, hashKeySecret } from "@orbit/domain/node"
import mongoose, { type Model } from "mongoose"
import type { Db, Models } from "../connection"
import { MIGRATIONS, runMigrations } from "../migrate"

const { Long } = mongoose.mongo

export interface SeedOptions {
  /** Base URL for demo asset files (e.g. `${CDN_BASE_URL}/${DEMO_UPLOAD_ID}`). */
  cdnBase?: string
  /** Reporting day to build the demo for (default: today in Asia/Dhaka). */
  today?: string
  seed?: number
  now?: number
  /** Days of analytics history (default 60). */
  days?: number
  /** KEY_PEPPER used to hash SDK key secrets. */
  pepper: string
  batchSize?: number
  /** Concurrent batches per collection. */
  concurrency?: number
  log?: (s: string) => void
}

export interface DemoKeySecret {
  keyId: string
  propertyId: string
  env: "live" | "test"
  secret: string
}

export interface SeedResult {
  counts: Record<string, number>
  demo: Demo
  analytics: DeliveryOutput
  /** Clear-text secrets of every active key. Never log them. */
  secrets: DemoKeySecret[]
  ms: number
}

const date = (s: string | null | undefined) => (s == null ? null : new Date(s))

/** Verify that all migrations ran; run the missing ones (idempotent). */
export async function ensureMigrated(db: Db, log: (s: string) => void = () => {}) {
  const done = new Set((await db.primary.db!.collection<{ _id: string }>("_migrations").find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id))
  if (MIGRATIONS.every((m) => done.has(m.id))) return false
  log("Migrations missing: running them first")
  await runMigrations(db, log)
  return true
}

/** True when the Orbit database already holds demo (or real) campaigns. */
export async function hasData(db: Db) {
  return (await db.models.Campaign.estimatedDocumentCount()) > 0
}

/** Empty Orbit's own collections (deleteMany only; no drops, `_migrations` untouched). Returns deleted counts. */
export async function resetDatabase(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  await Promise.all(
    Object.values(db.models).map(async (m) => {
      const name = m.collection.collectionName
      const res = await m.collection.deleteMany({})
      out[name] = res.deletedCount
    }),
  )
  return out
}

/** DTO → document conversions. Exported for tests. */
export function toDocuments(demo: Demo, analytics: DeliveryOutput, pepper: string) {
  const secrets: DemoKeySecret[] = []
  const users = demo.users.map(({ id, lastActiveAt, createdAt, updatedAt, ...u }) => ({ _id: id, ...u, sso: null, lastActiveAt: date(lastActiveAt), createdAt: date(createdAt), updatedAt: date(updatedAt) }))
  const countries = demo.countries.map((c) => ({ _id: c.code, name: c.name, region: c.region, enabled: c.enabled, isoNumeric: null }))
  const { updatedAt: settingsAt, ...settings } = demo.settings
  const settingsDocs = [{ _id: "global", ...settings, killSwitch: false, createdAt: date(settingsAt), updatedAt: date(settingsAt) }]
  const properties = demo.properties.map(({ id, sdk, createdAt, updatedAt, ...p }) => ({
    _id: id, ...p, sdk: { ...sdk, lastHeartbeatAt: date(sdk.lastHeartbeatAt) }, createdAt: date(createdAt), updatedAt: date(updatedAt),
  }))
  const propertyKeys = demo.propertyKeys.map((k) => {
    const g = generateKeySecret(k.env)
    if (k.status !== "revoked") secrets.push({ keyId: k.id, propertyId: k.propertyId, env: k.env, secret: g.secret })
    return {
      _id: k.id, propertyId: k.propertyId, label: k.label, env: k.env, prefix: g.prefix, last4: g.last4, hash: hashKeySecret(g.secret, pepper), status: k.status,
      graceUntil: date(k.graceUntil), createdBy: k.createdBy, lastUsedAt: date(k.lastUsedAt), revokedAt: date(k.revokedAt), revokedBy: k.revokedBy,
      createdAt: date(k.createdAt), updatedAt: date(k.revokedAt ?? k.createdAt),
    }
  })
  const placements = demo.placements.map(({ id, createdAt, updatedAt, ...p }) => ({ _id: id, ...p, createdAt: date(createdAt), updatedAt: date(updatedAt) }))
  const creatives = demo.creatives.map(({ id, review, createdAt, updatedAt, ...c }) => ({
    _id: id, ...c, review: { ...review, at: date(review.at) }, createdAt: date(createdAt), updatedAt: date(updatedAt),
  }))
  const creativeVersions = demo.creativeVersions.map(({ id, at, ...v }) => ({ _id: id, ...v, at: date(at) }))
  const campaigns = demo.campaigns.map((c) => campaignDoc(c))
  const campaignRevisions = demo.campaignRevisions.map(({ id, at, ...r }) => ({ _id: id, ...r, at: date(at) }))
  const campaignStats = analytics.stats.map((s) => ({
    _id: s.campaignId, lifetime: { ...s.lifetime, costMicros: BigInt(s.lifetime.costMicros) },
    today: { ...s.today, d: dayStart(s.today.d), costMicros: BigInt(s.today.costMicros) }, updatedAt: date(s.updatedAt),
  }))
  const events = demo.events.map(({ key, lastSeenAt, createdAt, ...e }) => ({ _id: key, ...e, lastSeenAt: date(lastSeenAt), createdAt: date(createdAt), updatedAt: date(createdAt) }))
  const budgets = demo.budgets.map((b) => ({
    _id: `${b.team}:${b.quarter}`, team: b.team, quarter: b.quarter, amountMicros: BigInt(b.amountMicros), updatedBy: b.updatedBy, rev: b.rev, createdAt: date(b.updatedAt), updatedAt: date(b.updatedAt),
  }))
  const audiences = demo.audiences.map(({ id, estimate, createdAt, updatedAt, ...a }) => ({
    _id: id, ...a, estimate: estimate ? { size: estimate.size, at: date(estimate.at) } : null, createdAt: date(createdAt), updatedAt: date(updatedAt),
  }))
  const auditLog = demo.auditLog.map(({ id, at, ...a }) => ({ _id: id, at: date(at), ...a, diff: null, ip: null, requestId: null }))
  const alerts = demo.alerts.map(({ id, firstSeenAt, lastSeenAt, resolvedAt, ...a }) => ({
    _id: id, ...a, firstSeenAt: date(firstSeenAt), lastSeenAt: date(lastSeenAt), resolvedAt: date(resolvedAt), ackedBy: null,
  }))
  const delivery = analytics.delivery.map((x) => ({ ...x, m: { ...x.m, costMicros: Long.fromNumber(x.m.costMicros) } }))
  const supply = analytics.supply
  const samples = analytics.samples.map((s) => ({ at: new Date(s.at), k: { p: s.propertyId, pl: s.placementId }, cc: s.country, result: s.result, latencyMs: s.latencyMs, sdk: s.sdk }))
  return {
    secrets,
    operational: {
      User: users, Country: countries, Settings: settingsDocs, Property: properties, PropertyKey: propertyKeys, Placement: placements, Creative: creatives,
      CreativeVersion: creativeVersions, Campaign: campaigns, CampaignRevision: campaignRevisions, CampaignStats: campaignStats, EventDefinition: events,
      Budget: budgets, Audience: audiences, AuditLog: auditLog, Alert: alerts,
    } satisfies Partial<Record<keyof Models, unknown[]>>,
    native: { DeliveryDaily: delivery, SupplyDaily: supply, RequestSample: samples } satisfies Partial<Record<keyof Models, unknown[]>>,
  }
}

/** Flights are calendar dates in the campaign time zone, stored as that zone's local midnight. */
function campaignDoc(c: Campaign) {
  const { id, flight, budget, health, publishedAt, archivedAt, createdAt, updatedAt, ...rest } = c
  return {
    _id: id, ...rest,
    flight: { start: dayStart(flight.start, flight.tz), end: dayStart(flight.end, flight.tz), tz: flight.tz },
    budget: { ...budget, amountMicros: BigInt(budget.amountMicros) },
    health: { issues: health.issues, checkedAt: date(health.checkedAt) },
    ...(c.status === "archived" ? {} : { live: true }),
    publishedAt: date(publishedAt), archivedAt: date(archivedAt), createdAt: date(createdAt), updatedAt: date(updatedAt),
  }
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

/** Build and insert the demo workspace. The caller decides about existing data (see `hasData` / `resetDatabase`). */
export async function seedDatabase(db: Db, opts: SeedOptions): Promise<SeedResult> {
  const t0 = Date.now()
  const log = opts.log ?? (() => {})
  const batch = opts.batchSize ?? 1000
  const conc = opts.concurrency ?? 4
  const demo = buildDemo({ today: opts.today ?? todayKey(), seed: opts.seed, now: opts.now, cdnBase: opts.cdnBase })
  const analytics = generateDelivery(demo, { days: opts.days ?? 60 })
  refreshHealth(demo, spentByCampaign(analytics.stats))
  const docs = toDocuments(demo, analytics, opts.pepper)
  const counts: Record<string, number> = {}

  const jobs: Promise<void>[] = []
  for (const [name, list] of Object.entries(docs.operational) as [keyof Models, Record<string, unknown>[]][]) {
    const model = db.models[name] as unknown as Model<unknown>
    jobs.push(
      pool(chunks(list, batch), conc, async (part) => {
        await model.insertMany(part, { ordered: false, throwOnValidationError: true })
      }).then(() => void (counts[model.collection.collectionName] = list.length)),
    )
  }
  for (const [name, list] of Object.entries(docs.native) as [keyof Models, Record<string, unknown>[]][]) {
    const coll = db.models[name].collection
    jobs.push(
      pool(chunks(list, batch), conc, async (part) => {
        await coll.insertMany(part as never[], { ordered: false })
      }).then(() => void (counts[coll.collectionName] = list.length)),
    )
  }
  await Promise.all(jobs)
  log(`Seeded ${Object.values(counts).reduce((a, b) => a + b, 0).toLocaleString("en-US")} documents in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  return { counts, demo, analytics, secrets: docs.secrets, ms: Date.now() - t0 }
}


export * from "./assets"
