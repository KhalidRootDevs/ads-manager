/**
 * Rollup write builders (guideline §5.3, §6.5, §6.13). The ONLY place that builds rollup writes.
 * Each op is an aggregation-pipeline upsert addressed by a deterministic `_id`, so writes need no secondary
 * index and replays are idempotent per window (combined with the offset watermark in `rollup_offsets`).
 * Executed with the native driver: `DeliveryDaily.collection.bulkWrite(ops, { ordered: false, session })`.
 */
import { compactKey } from "@orbit/domain"
import mongoose from "mongoose"

const { Long } = mongoose.mongo
export const ZERO_24 = Array.from({ length: 24 }, () => 0)

export interface DeliveryKey {
  /** reporting day as "YYYY-MM-DD" */
  day: string
  /** reporting-day start instant (dayStart(day)) */
  d: Date
  c: string
  p: string
  pl: string
  cr: string
  cc: string
  dv: string
  pf: string
  f: string
}

export interface DeliveryDelta {
  imp: number
  view: number
  clk: number
  vs: number
  vc: number
  rw: number
  conv: number
  costMicros: number
  /** per-hour impressions / clicks in the reporting time zone (length 24) */
  hImp: number[]
  hClk: number[]
}

export function emptyDeliveryDelta(): DeliveryDelta {
  return { imp: 0, view: 0, clk: 0, vs: 0, vc: 0, rw: 0, conv: 0, costMicros: 0, hImp: [...ZERO_24], hClk: [...ZERO_24] }
}

export const deliveryId = (k: Omit<DeliveryKey, "d">) => [compactKey(k.day), k.c, k.p, k.pl, k.cr, k.cc, k.dv].join("|")

const keep = (field: string, value: unknown) => ({ $ifNull: [`$${field}`, value] })
const addNum = (path: string, n: number) => ({ $add: [{ $ifNull: [`$${path}`, 0] }, n] })
const addLong = (path: string, n: number) => ({ $add: [{ $ifNull: [`$${path}`, Long.fromNumber(0)] }, Long.fromNumber(n)] })

/** Element-wise add of a 24-slot delta into a stored array, creating it on first write. */
function addArray(path: string, delta: number[]) {
  const existing = { $ifNull: [`$${path}`, { $literal: ZERO_24 }] }
  if (delta.every((x) => x === 0)) return existing
  return {
    $map: {
      input: { $range: [0, 24] },
      as: "i",
      in: { $add: [{ $arrayElemAt: [existing, "$$i"] }, { $arrayElemAt: [{ $literal: delta }, "$$i"] }] },
    },
  }
}

export function deliveryUpsert(k: DeliveryKey, x: DeliveryDelta) {
  return {
    updateOne: {
      filter: { _id: deliveryId(k) },
      upsert: true,
      update: [
        {
          $set: {
            d: keep("d", k.d), c: keep("c", k.c), p: keep("p", k.p), pl: keep("pl", k.pl), cr: keep("cr", k.cr), cc: keep("cc", k.cc), dv: keep("dv", k.dv), pf: keep("pf", k.pf), f: keep("f", k.f),
            "m.imp": addNum("m.imp", x.imp), "m.view": addNum("m.view", x.view), "m.clk": addNum("m.clk", x.clk), "m.vs": addNum("m.vs", x.vs), "m.vc": addNum("m.vc", x.vc),
            "m.rw": addNum("m.rw", x.rw), "m.conv": addNum("m.conv", x.conv), "m.costMicros": addLong("m.costMicros", x.costMicros),
            "h.imp": addArray("h.imp", x.hImp), "h.clk": addArray("h.clk", x.hClk),
          },
        },
      ],
    },
  }
}

export interface SupplyKey {
  day: string
  d: Date
  p: string
  pl: string
  cc: string
  dv: string
  pf: string
}

export interface SupplyDelta {
  req: number
  elig: number
  fill: number
  err: number
  /** no-fill counts by reason */
  nf: Record<string, number>
  latP50: number | null
  latP99: number | null
  hReq: number[]
}

export function emptySupplyDelta(): SupplyDelta {
  return { req: 0, elig: 0, fill: 0, err: 0, nf: {}, latP50: null, latP99: null, hReq: [...ZERO_24] }
}

export const supplyId = (k: Omit<SupplyKey, "d">) => [compactKey(k.day), k.p, k.pl, k.cc, k.dv].join("|")

export function supplyUpsert(k: SupplyKey, x: SupplyDelta) {
  const set: Record<string, unknown> = {
    d: keep("d", k.d), p: keep("p", k.p), pl: keep("pl", k.pl), cc: keep("cc", k.cc), dv: keep("dv", k.dv), pf: keep("pf", k.pf),
    "m.req": addNum("m.req", x.req), "m.elig": addNum("m.elig", x.elig), "m.fill": addNum("m.fill", x.fill), "m.err": addNum("m.err", x.err),
    "h.req": addArray("h.req", x.hReq),
  }
  for (const [reason, n] of Object.entries(x.nf)) if (n) set[`m.nf.${reason.replace(/[^a-z_]/g, "_")}`] = addNum(`m.nf.${reason.replace(/[^a-z_]/g, "_")}`, n)
  // Percentiles can't be summed: keep the worst window (§6.5).
  if (x.latP50 != null) set["m.latP50"] = { $max: [{ $ifNull: ["$m.latP50", 0] }, x.latP50] }
  if (x.latP99 != null) set["m.latP99"] = { $max: [{ $ifNull: ["$m.latP99", 0] }, x.latP99] }
  return { updateOne: { filter: { _id: supplyId(k) }, upsert: true, update: [{ $set: set }] } }
}

export interface StatsDelta {
  imp: number
  clk: number
  conv: number
  costMicros: number
}

/**
 * campaign_stats: lifetime counters always; `today` counters only when the window belongs to the current
 * reporting day (they reset when the day rolls over).
 */
export function statsUpsert(campaignId: string, x: StatsDelta, eventDay: Date, currentDay: Date, now = new Date()) {
  const set: Record<string, unknown> = {
    "lifetime.imp": addNum("lifetime.imp", x.imp), "lifetime.clk": addNum("lifetime.clk", x.clk), "lifetime.conv": addNum("lifetime.conv", x.conv),
    "lifetime.costMicros": addLong("lifetime.costMicros", x.costMicros), updatedAt: now,
  }
  if (eventDay.getTime() === currentDay.getTime()) {
    const same = { $eq: ["$today.d", currentDay] }
    const today = (f: keyof StatsDelta, long = false) => ({
      $cond: [same, long ? addLong(`today.${f}`, x[f]) : addNum(`today.${f}`, x[f]), long ? Long.fromNumber(x[f]) : x[f]],
    })
    set.today = { d: currentDay, imp: today("imp"), clk: today("clk"), conv: today("conv"), costMicros: today("costMicros", true) }
  }
  return { updateOne: { filter: { _id: campaignId }, upsert: true, update: [{ $set: set }] } }
}
