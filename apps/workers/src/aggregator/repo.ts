/**
 * Aggregator persistence: one MongoDB transaction per partition batch containing the rollup bulk writes
 * (built only by @orbit/db rollups.ts) and the partition watermark in `rollup_offsets` → exactly-once effect.
 */
import { deliveryUpsert, statsUpsert, supplyUpsert, type Db } from "@orbit/db"
import { reportingDay } from "@orbit/domain"
import type { ClientSession } from "mongoose"
import { offsetGt } from "../kafka"
import { aggregate, type Aggregate, type InMsg, type SampleDoc } from "./aggregate"

const CHUNK = 1_000

async function bulk(coll: { bulkWrite(ops: never[], o: object): Promise<unknown> }, ops: unknown[], session: ClientSession) {
  for (let i = 0; i < ops.length; i += CHUNK) await coll.bulkWrite(ops.slice(i, i + CHUNK) as never[], { ordered: false, session })
}

export async function readWatermark(db: Db, id: string, session?: ClientSession): Promise<string | null> {
  const q = db.models.RollupOffset.findOne({ _id: id }, { offset: 1 }).lean()
  if (session) q.session(session)
  const doc = await q
  return (doc?.offset as string | undefined) ?? null
}

export interface ApplyResult {
  /** messages above the watermark (null when everything was already applied) */
  agg: Aggregate | null
  skipped: number
  lastOffset: string | null
}

/**
 * Apply one partition batch. Messages at or below the stored watermark are skipped, so re-delivery after a crash
 * (Kafka offsets are committed only after this transaction) never double counts.
 */
export async function applyRollups(db: Db, watermarkId: string, msgs: InMsg[], now = Date.now()): Promise<ApplyResult> {
  if (!msgs.length) return { agg: null, skipped: 0, lastOffset: null }
  const m = db.models
  const session = await db.primary.startSession()
  let result: ApplyResult = { agg: null, skipped: msgs.length, lastOffset: null }
  try {
    await session.withTransaction(async () => {
      const wm = await readWatermark(db, watermarkId, session)
      const fresh = msgs.filter((x) => offsetGt(x.offset, wm))
      if (!fresh.length) {
        result = { agg: null, skipped: msgs.length, lastOffset: wm }
        return
      }
      const agg = aggregate(fresh, now)
      const currentDay = reportingDay(now)
      const at = new Date(now)
      await bulk(m.DeliveryDaily.collection as never, [...agg.delivery.values()].map((r) => deliveryUpsert(r.key, r.delta)), session)
      await bulk(m.SupplyDaily.collection as never, [...agg.supply.values()].map((r) => supplyUpsert(r.key, r.delta)), session)
      await bulk(m.CampaignStats.collection as never, [...agg.stats.values()].map((s) => statsUpsert(s.campaignId, s.delta, s.day, currentDay, at)), session)
      const last = fresh.reduce((a, x) => (BigInt(x.offset) > BigInt(a) ? x.offset : a), fresh[0].offset)
      await m.RollupOffset.updateOne({ _id: watermarkId }, { $set: { offset: last, updatedAt: at } }, { upsert: true, session })
      result = { agg, skipped: msgs.length - fresh.length, lastOffset: last }
    })
  } finally {
    await session.endSession()
  }
  return result
}

/** request_samples is a time-series collection (no multi-document transactions): inserted after the commit. */
export async function insertSamples(db: Db, docs: SampleDoc[]) {
  if (docs.length) await db.models.RequestSample.collection.insertMany(docs as never[], { ordered: false })
}

/**
 * Heartbeat → `properties.sdk`, via the native collection so `rev`/`updatedAt` are untouched (system field).
 * The state flips to healthy only when it isn't healthy/degraded already, so routine heartbeats only touch
 * `sdk.lastHeartbeatAt`/`sdk.version` (ignored by the compiler's change-stream filter).
 */
export async function writeHeartbeat(db: Db, p: string, sdk: string, at: Date) {
  const coll = db.models.Property.collection
  const r = await coll.updateOne({ _id: p, "sdk.state": { $nin: ["healthy", "degraded"] } } as never, { $set: { "sdk.state": "healthy", "sdk.version": sdk, "sdk.lastHeartbeatAt": at } })
  if (!r.matchedCount) await coll.updateOne({ _id: p } as never, { $set: { "sdk.version": sdk, "sdk.lastHeartbeatAt": at } })
}
