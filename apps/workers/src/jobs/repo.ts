/**
 * Jobs data access: campaign status transitions, budget auto-pause, alert sync, heartbeat-missing detection,
 * grace-key expiry, key last-used, reconciliation, retention and index usage. Rules come from @orbit/domain.
 */
import { trusted, type Db } from "@orbit/db"
import { deriveAlerts, newId, reportingDay, REDIS_KEYS, type AlertCandidate } from "@orbit/domain"
import type { Redis } from "@orbit/server-kit"
import type { ClientSession } from "mongoose"
import { flightWindow } from "../compiler/compile"

const SYSTEM = { id: null, name: "System" }
const MAX_MS = 10_000
export const HEARTBEAT_MISSING_MS = 30 * 60_000

async function inTxn<T>(db: Db, fn: (s: ClientSession) => Promise<T>): Promise<T> {
  const s = await db.primary.startSession()
  try {
    let out!: T
    await s.withTransaction(async () => {
      out = await fn(s)
    })
    return out
  } finally {
    await s.endSession()
  }
}

/** Rev-guarded status change + audit entry in one transaction. Returns false when the doc changed meanwhile. */
async function setStatus(db: Db, c: { _id: string; name: string; rev: number }, status: string, action: string, detail: string, now: Date) {
  return inTxn(db, async (session) => {
    const r = await db.models.Campaign.updateOne({ _id: c._id, rev: c.rev }, { $set: { status }, $inc: { rev: 1 } }, { session, runValidators: true })
    if (!r.matchedCount) return false
    await db.models.AuditLog.create([{ _id: newId("auditLog"), at: now, actor: SYSTEM, action, target: { type: "campaign", id: c._id, name: c.name }, detail }], { session })
    return true
  })
}

export interface TransitionResult {
  started: string[]
  completed: string[]
}

/** scheduled → active at flight start; scheduled/active/paused → completed after flight end (campaign time zone). */
export async function runTransitions(db: Db, now = new Date()): Promise<TransitionResult> {
  const out: TransitionResult = { started: [], completed: [] }
  const camps = await db.models.Campaign.find({ status: trusted({ $in: ["scheduled", "active", "paused"] }) }, { name: 1, status: 1, flight: 1, rev: 1 }).lean().maxTimeMS(MAX_MS)
  const t = now.getTime()
  for (const c of camps) {
    const fw = flightWindow(c.flight as never)
    const doc = { _id: c._id as string, name: c.name, rev: c.rev ?? 0 }
    if (t >= fw.endMs) {
      if (await setStatus(db, doc, "completed", "campaign.completed", `Flight ended on ${fw.end}.`, now)) out.completed.push(doc._id)
    } else if (c.status === "scheduled" && t >= fw.startMs) {
      if (await setStatus(db, doc, "active", "campaign.started", `Flight started on ${fw.start}.`, now)) out.started.push(doc._id)
    }
  }
  return out
}

/** Pause active campaigns whose lifetime spend reached the budget (when settings.autoPauseOnBudget). */
export async function runAutoPause(db: Db, now = new Date()): Promise<string[]> {
  const settings = await db.models.Settings.findOne({ _id: "global" }, { autoPauseOnBudget: 1 }).lean()
  if (settings && settings.autoPauseOnBudget === false) return []
  const camps = await db.models.Campaign.find({ status: "active" }, { name: 1, budget: 1, rev: 1 }).lean().maxTimeMS(MAX_MS)
  if (!camps.length) return []
  const stats = await db.models.CampaignStats.find({ _id: trusted({ $in: camps.map((c) => c._id) }) }, { lifetime: 1 }).lean()
  const spent = new Map(stats.map((s) => [s._id as string, Number(s.lifetime?.costMicros ?? 0)]))
  const out: string[] = []
  for (const c of camps) {
    const budget = Number(c.budget.amountMicros)
    const s = spent.get(c._id as string) ?? 0
    if (budget > 0 && s >= budget) {
      if (await setStatus(db, { _id: c._id as string, name: c.name, rev: c.rev ?? 0 }, "paused", "campaign.auto_paused", "Budget fully spent; paused automatically.", now)) out.push(c._id as string)
    }
  }
  return out
}

/** production properties with a stale heartbeat → heartbeat_missing (system field: native write, rev untouched). */
export async function runHeartbeatMissing(db: Db, now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - HEARTBEAT_MISSING_MS)
  const props = await db.models.Property.find(
    { env: "production", "sdk.state": trusted({ $in: ["healthy", "degraded"] }), "sdk.lastHeartbeatAt": trusted({ $lt: cutoff }) },
    { _id: 1 },
  ).lean()
  const out: string[] = []
  for (const p of props) {
    const r = await db.models.Property.collection.updateOne(
      { _id: p._id, "sdk.state": { $in: ["healthy", "degraded"] }, "sdk.lastHeartbeatAt": { $lt: cutoff } } as never,
      { $set: { "sdk.state": "heartbeat_missing" } },
    )
    if (r.modifiedCount) out.push(p._id as string)
  }
  return out
}

/** Properties with > 1 % errors today (≥ 100 requests), from supply rollups. */
async function degradedProperties(db: Db, now: Date): Promise<Set<string>> {
  const rows = await db.ro.SupplyDailyRO.aggregate<{ _id: string; req: number; err: number }>([
    { $match: { d: reportingDay(now) } },
    { $group: { _id: "$p", req: { $sum: "$m.req" }, err: { $sum: "$m.err" } } },
  ]).option({ maxTimeMS: MAX_MS })
  return new Set(rows.filter((r) => r.req >= 100 && r.err / r.req > 0.01).map((r) => r._id))
}

export interface AlertSync {
  opened: number
  updated: number
  resolved: number
}

/** Open derived alerts (one open per dedupeKey, enforced by the partial unique index), refresh, resolve the rest. */
export async function syncAlerts(db: Db, now = new Date()): Promise<AlertSync> {
  const m = db.models
  const [campaigns, properties, countries, open] = await Promise.all([
    m.Campaign.find({ status: trusted({ $in: ["scheduled", "active", "paused"] }) }, { name: 1, status: 1, creativeIds: 1, targets: 1 }).lean(),
    m.Property.find({}, { name: 1, countryRule: 1, sdk: 1 }).lean(),
    m.Country.find({}, { name: 1, enabled: 1 }).lean(),
    m.Alert.find({ status: trusted({ $in: ["open", "acked"] }) }, { dedupeKey: 1, status: 1 }).lean(),
  ])
  const creatives = await m.Creative.find({ _id: trusted({ $in: [...new Set(campaigns.flatMap((c) => c.creativeIds))] }) }, { name: 1, status: 1, review: 1 }).lean()
  const derived: AlertCandidate[] = deriveAlerts({
    campaigns: campaigns.map((c) => ({ ...c, id: c._id })) as never,
    creatives: Object.fromEntries(creatives.map((c) => [c._id, { ...c, id: c._id }])) as never,
    properties: Object.fromEntries(properties.map((p) => [p._id, { ...p, id: p._id }])) as never,
    countries: countries.map((c) => ({ code: c._id as string, name: c.name, enabled: c.enabled })),
    degraded: await degradedProperties(db, now),
  })
  const want = new Map(derived.map((a) => [a.dedupeKey, a]))
  const have = new Map(open.map((a) => [a.dedupeKey, a]))
  const res: AlertSync = { opened: 0, updated: 0, resolved: 0 }
  for (const [key, a] of want) {
    if (have.has(key)) {
      await m.Alert.updateOne({ _id: have.get(key)!._id }, { $set: { lastSeenAt: now, title: a.title, message: a.message } })
      res.updated++
      continue
    }
    try {
      await m.Alert.create({ _id: newId("alert"), type: a.type, severity: a.severity, entity: a.entity, status: "open", title: a.title, message: a.message, href: a.href, dedupeKey: key, firstSeenAt: now, lastSeenAt: now, resolvedAt: null })
      res.opened++
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err // another jobs runner opened it first
    }
  }
  const stale = open.filter((a) => !want.has(a.dedupeKey)).map((a) => a._id)
  if (stale.length) {
    const r = await m.Alert.updateMany({ _id: trusted({ $in: stale }) }, { $set: { status: "resolved", resolvedAt: now } })
    res.resolved = r.modifiedCount
  }
  return res
}

/** Grace keys past graceUntil → revoked. */
export async function expireGraceKeys(db: Db, now = new Date()): Promise<number> {
  const r = await db.models.PropertyKey.updateMany({ status: "grace", graceUntil: trusted({ $lte: now }) }, { $set: { status: "revoked", revokedAt: now } })
  return r.modifiedCount
}

/** Copy `ku:<keyId>` (epoch ms, written by ad server/collector at most hourly) into property_keys.lastUsedAt. */
export async function syncKeyLastUsed(db: Db, redis: Redis): Promise<number> {
  const keys = await db.models.PropertyKey.find({ status: trusted({ $in: ["active", "grace"] }) }, { lastUsedAt: 1 }).lean()
  if (!keys.length) return 0
  const vals = await redis.mget(...keys.map((k) => REDIS_KEYS.keyUsed(k._id as string)))
  let n = 0
  for (let i = 0; i < keys.length; i++) {
    const v = Number(vals[i])
    if (!v) continue
    const at = new Date(v)
    const prev = keys[i].lastUsedAt ? new Date(keys[i].lastUsedAt as Date).getTime() : 0
    if (v <= prev) continue
    // native write: lastUsedAt is bookkeeping (ignored by the compiler's change-stream filter)
    await db.models.PropertyKey.collection.updateOne({ _id: keys[i]._id } as never, { $set: { lastUsedAt: at } })
    n++
  }
  return n
}

export interface ReconcileResult {
  campaigns: number
  repaired: { id: string; field: string; stats: number; rollups: number }[]
  spendReset: number
}

/**
 * §5.5: campaign_stats lifetime must equal the sum of delivery_daily. Both are read in one snapshot so a concurrent
 * aggregator flush can't produce a false mismatch; repairs are conditional on the stats doc not having moved.
 * Then Redis spend counters are reset from the (repaired) stats.
 */
export async function reconcile(db: Db, redis: Redis): Promise<ReconcileResult> {
  const m = db.models
  const session = await db.primary.startSession()
  let sums: { _id: string; imp: number; clk: number; conv: number; cost: unknown }[] = []
  let stats: { _id: string; lifetime?: { imp?: number; clk?: number; conv?: number; costMicros?: unknown } }[] = []
  try {
    await session.withTransaction(
      async () => {
        sums = await m.DeliveryDaily.aggregate([{ $group: { _id: "$c", imp: { $sum: "$m.imp" }, clk: { $sum: "$m.clk" }, conv: { $sum: "$m.conv" }, cost: { $sum: "$m.costMicros" } } }]).session(session)
        stats = (await m.CampaignStats.find({}, { lifetime: 1 }).session(session).lean()) as never
      },
      { readConcern: { level: "snapshot" } },
    )
  } finally {
    await session.endSession()
  }
  const res: ReconcileResult = { campaigns: 0, repaired: [], spendReset: 0 }
  const byId = new Map(stats.map((s) => [s._id, s]))
  const ids = new Set([...sums.map((s) => s._id), ...stats.map((s) => s._id)])
  const sumById = new Map(sums.map((s) => [s._id, s]))
  for (const id of ids) {
    if (!id?.startsWith("cmp_")) continue
    res.campaigns++
    const want = sumById.get(id) ?? { imp: 0, clk: 0, conv: 0, cost: 0 }
    const have = byId.get(id)?.lifetime ?? {}
    const fields: [string, number, number][] = [
      ["imp", Number(have.imp ?? 0), Number(want.imp)],
      ["clk", Number(have.clk ?? 0), Number(want.clk)],
      ["conv", Number(have.conv ?? 0), Number(want.conv)],
      ["costMicros", Number(have.costMicros ?? 0), Number(want.cost ?? 0)],
    ]
    const diff = fields.filter(([, a, b]) => a !== b)
    if (!diff.length) continue
    for (const [field, a, b] of diff) res.repaired.push({ id, field, stats: a, rollups: b })
    const guard: Record<string, unknown> = { _id: id }
    if (byId.has(id)) for (const [f, a] of fields) guard[`lifetime.${f}`] = f === "costMicros" ? BigInt(a) : a
    await m.CampaignStats.updateOne(
      guard,
      { $set: { "lifetime.imp": Number(want.imp), "lifetime.clk": Number(want.clk), "lifetime.conv": Number(want.conv), "lifetime.costMicros": BigInt(Math.round(Number(want.cost ?? 0))), updatedAt: new Date() } },
      { upsert: !byId.has(id) },
    )
  }
  const fresh = await m.CampaignStats.find({}, { lifetime: 1 }).lean()
  if (fresh.length) {
    const p = redis.pipeline()
    for (const s of fresh) p.set(REDIS_KEYS.spend(s._id as string), String(Number(s.lifetime?.costMicros ?? 0)))
    await p.exec()
    res.spendReset = fresh.length
  }
  return res
}

/** Delete Orbit's own daily rollups older than 25 months (uses the `{ d: 1 }` index). */
export async function retention(db: Db, now = new Date()) {
  const cutoff = new Date(now)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 25)
  const d = reportingDay(cutoff)
  const [a, b] = await Promise.all([db.models.DeliveryDaily.deleteMany({ d: trusted({ $lt: d }) }), db.models.SupplyDaily.deleteMany({ d: trusted({ $lt: d }) })])
  return { cutoff: d.toISOString(), deliveryDeleted: a.deletedCount, supplyDeleted: b.deletedCount }
}

/** `$indexStats` per collection; flags non-unique, non-TTL indexes with zero accesses since the last restart. */
export async function indexUsage(db: Db) {
  const out: { collection: string; index: string; ops: number; flagged: boolean }[] = []
  const unavailable: { collection: string; error: string }[] = []
  const seen = new Set<string>()
  for (const model of Object.values(db.models)) {
    const name = model.collection.collectionName
    if (seen.has(name) || name === "request_samples") continue
    seen.add(name)
    try {
      const rows = await model.collection.aggregate<{ name: string; accesses: { ops: number | bigint }; spec?: { unique?: boolean; expireAfterSeconds?: number } }>([{ $indexStats: {} }]).toArray()
      for (const r of rows) {
        if (r.name === "_id_") continue
        const ops = Number(r.accesses?.ops ?? 0)
        out.push({ collection: name, index: r.name, ops, flagged: ops === 0 && !r.spec?.unique && r.spec?.expireAfterSeconds == null })
      }
    } catch (err) {
      // e.g. shared Atlas tiers / users without the indexStats privilege
      unavailable.push({ collection: name, error: (err as Error).message.slice(0, 120) })
    }
  }
  return { rows: out, unavailable }
}
