/**
 * Attribution (§5, §6.5 clicks/conversions): clicks are stored by clickId; conversions are matched to their click
 * within the 7-day window, deduplicated by `_id = clickId:event`, and counted into delivery_daily/campaign_stats.
 * Everything happens in one transaction per partition batch with the `attribution:<partition>` watermark.
 */
import { deliveryUpsert, emptyDeliveryDelta, statsUpsert, trusted, type Db } from "@orbit/db"
import { dateKeyInTz, reportingDay, type StreamEvent } from "@orbit/domain"
import { offsetGt } from "../kafka"
import { readWatermark } from "../aggregator/repo"

export const ATTRIBUTION_WINDOW_MS = 7 * 86_400_000

type Clk = Extract<StreamEvent, { k: "clk" }>
type Conv = Extract<StreamEvent, { k: "conv" }>

export interface AttributionResult {
  clicks: number
  conversions: number
  duplicates: number
  unknownClick: number
  expired: number
  skipped: number
}

export async function applyAttribution(db: Db, watermarkId: string, msgs: { offset: string; event: StreamEvent | null }[], now = Date.now()): Promise<AttributionResult> {
  const m = db.models
  const res: AttributionResult = { clicks: 0, conversions: 0, duplicates: 0, unknownClick: 0, expired: 0, skipped: 0 }
  if (!msgs.length) return res
  const session = await db.primary.startSession()
  try {
    await session.withTransaction(async () => {
      Object.assign(res, { clicks: 0, conversions: 0, duplicates: 0, unknownClick: 0, expired: 0, skipped: 0 })
      const wm = await readWatermark(db, watermarkId, session)
      const fresh = msgs.filter((x) => offsetGt(x.offset, wm))
      res.skipped = msgs.length - fresh.length
      if (!fresh.length) return
      const clicks = new Map<string, Clk>()
      const convs = new Map<string, Conv>()
      for (const { event: e } of fresh) {
        if (!e) continue
        if (e.k === "clk" && e.t !== 1) clicks.set(e.clickId, e)
        else if (e.k === "conv") {
          const id = `${e.clickId}:${e.event}`
          if (!convs.has(id)) convs.set(id, e)
          else res.duplicates++
        }
      }
      // 1. clicks (insert-if-absent; replays and duplicates are no-ops)
      for (const c of clicks.values()) {
        const r = await m.Click.updateOne(
          { _id: c.clickId },
          { $setOnInsert: { c: c.c, cr: c.cr, p: c.p, pl: c.pl, cc: c.cc, dv: c.dv, pf: c.pf, f: c.f, uid: c.u ?? null, at: new Date(c.at) } },
          { upsert: true, session },
        )
        if (r.upsertedCount) res.clicks++
      }
      // 2. conversions
      if (convs.size) {
        const ids = [...convs.keys()]
        const existing = new Set((await m.Conversion.find({ _id: trusted({ $in: ids }) }, { _id: 1 }).session(session).lean()).map((d) => d._id as string))
        const clickIds = [...new Set([...convs.values()].map((c) => c.clickId))]
        const found = new Map((await m.Click.find({ _id: trusted({ $in: clickIds }) }).session(session).lean()).map((d) => [d._id as string, d]))
        const docs: Record<string, unknown>[] = []
        const delivery = new Map<string, ReturnType<typeof deliveryUpsert>>()
        const rows = new Map<string, { key: Parameters<typeof deliveryUpsert>[0]; delta: ReturnType<typeof emptyDeliveryDelta> }>()
        const stats = new Map<string, { c: string; day: Date; n: number }>()
        for (const [id, cv] of convs) {
          if (existing.has(id)) {
            res.duplicates++
            continue
          }
          const click = found.get(cv.clickId)
          if (!click) {
            res.unknownClick++
            continue
          }
          if (cv.at - new Date(click.at).getTime() > ATTRIBUTION_WINDOW_MS || cv.at < new Date(click.at).getTime() - 60_000) {
            res.expired++
            continue
          }
          docs.push({ _id: id, event: cv.event, valueMicros: cv.valueMicros, c: click.c, cr: click.cr, p: click.p, pl: click.pl, cc: click.cc, dv: click.dv, source: cv.source, at: new Date(cv.at) })
          const day = dateKeyInTz(cv.at)
          const key = { day, d: reportingDay(cv.at), c: click.c!, p: click.p!, pl: click.pl!, cr: click.cr!, cc: click.cc!, dv: click.dv!, pf: click.pf!, f: click.f! }
          const rk = [day, key.c, key.p, key.pl, key.cr, key.cc, key.dv].join("|")
          const row = rows.get(rk) ?? { key, delta: emptyDeliveryDelta() }
          row.delta.conv++
          rows.set(rk, row)
          const sk = `${key.c}|${day}`
          const st = stats.get(sk) ?? { c: key.c, day: key.d, n: 0 }
          st.n++
          stats.set(sk, st)
          res.conversions++
        }
        if (docs.length) await m.Conversion.insertMany(docs, { session })
        for (const [k, r] of rows) delivery.set(k, deliveryUpsert(r.key, r.delta))
        if (delivery.size) await m.DeliveryDaily.collection.bulkWrite([...delivery.values()] as never[], { ordered: false, session })
        const currentDay = reportingDay(now)
        if (stats.size)
          await m.CampaignStats.collection.bulkWrite([...stats.values()].map((s) => statsUpsert(s.c, { imp: 0, clk: 0, conv: s.n, costMicros: 0 }, s.day, currentDay, new Date(now))) as never[], { ordered: false, session })
      }
      const last = fresh.reduce((a, x) => (BigInt(x.offset) > BigInt(a) ? x.offset : a), fresh[0].offset)
      await m.RollupOffset.updateOne({ _id: watermarkId }, { $set: { offset: last, updatedAt: new Date(now) } }, { upsert: true, session })
    })
  } finally {
    await session.endSession()
  }
  return res
}
