/**
 * In-memory window aggregation for the rollup aggregator (§5.3). Pure: stream events in, rollup deltas out.
 * Dimensions and day/hour bucketing come from @orbit/domain (reporting day = Asia/Dhaka).
 */
import { dateKeyInTz, hourInTz, reportingDay, spendHourBucket, supplyResultLabel, type StreamEvent } from "@orbit/domain"
import { emptyDeliveryDelta, emptySupplyDelta, type DeliveryDelta, type DeliveryKey, type StatsDelta, type SupplyDelta, type SupplyKey, deliveryId, supplyId } from "@orbit/db"

/** Events older than this go to the dead-letter topic instead of the rollups. */
export const LATE_LIMIT_MS = 24 * 3600_000

export interface InMsg {
  offset: string
  event: StreamEvent | null
}

export interface SampleDoc {
  at: Date
  k: { p: string; pl: string }
  cc: string
  result: string
  latencyMs: number
  sdk: string | null
}

export interface Aggregate {
  delivery: Map<string, { key: DeliveryKey; delta: DeliveryDelta }>
  supply: Map<string, { key: SupplyKey; delta: SupplyDelta; lat: number[] }>
  /** per campaign × reporting day */
  stats: Map<string, { campaignId: string; day: Date; delta: StatsDelta }>
  /** spend (micros) per campaign, total and per UTC hour bucket */
  spend: Map<string, { total: number; hours: Map<string, number> }>
  samples: SampleDoc[]
  /** latest heartbeat per property */
  heartbeats: Map<string, { p: string; sdk: string; at: number; testMode: boolean }>
  /** offsets of events that must go to the DLQ, with the reason */
  dlq: { offset: string; reason: string }[]
  counts: { applied: number; test: number; late: number; invalid: number; ignored: number }
}

const DELIVERY_KINDS = new Set(["imp", "view", "clk", "vs", "vc", "rw"])

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}

export function aggregate(msgs: InMsg[], now = Date.now()): Aggregate {
  const out: Aggregate = {
    delivery: new Map(), supply: new Map(), stats: new Map(), spend: new Map(), samples: [], heartbeats: new Map(), dlq: [],
    counts: { applied: 0, test: 0, late: 0, invalid: 0, ignored: 0 },
  }
  for (const { offset, event: e } of msgs) {
    if (!e || typeof e !== "object" || typeof (e as { k?: unknown }).k !== "string" || typeof e.at !== "number") {
      out.counts.invalid++
      out.dlq.push({ offset, reason: "invalid" })
      continue
    }
    if (e.k === "hb") {
      const prev = out.heartbeats.get(e.p)
      if (!prev || prev.at < e.at) out.heartbeats.set(e.p, { p: e.p, sdk: e.sdk, at: e.at, testMode: e.testMode })
      out.counts.applied++
      continue
    }
    if (e.k === "conv") {
      out.counts.ignored++ // attribution owns conversions
      continue
    }
    if (now - e.at > LATE_LIMIT_MS) {
      out.counts.late++
      out.dlq.push({ offset, reason: "late" })
      continue
    }
    const test = "t" in e && e.t === 1

    if (e.k === "supply") {
      if (e.sample || test) {
        out.samples.push({ at: new Date(e.at), k: { p: e.p, pl: e.pl }, cc: e.cc, result: supplyResultLabel(e.result, e.reason, test), latencyMs: e.latencyMs, sdk: e.sdk ?? null })
      }
      if (test) {
        out.counts.test++
        continue
      }
      const day = dateKeyInTz(e.at)
      const key: SupplyKey = { day, d: reportingDay(e.at), p: e.p, pl: e.pl, cc: e.cc, dv: e.dv, pf: e.pf }
      const id = supplyId(key)
      let s = out.supply.get(id)
      if (!s) out.supply.set(id, (s = { key, delta: emptySupplyDelta(), lat: [] }))
      const x = s.delta
      x.req++
      x.hReq[hourInTz(e.at)]++
      if (e.result === "filled") {
        x.elig++
        x.fill++
      } else if (e.result === "no_fill") {
        if (e.reason !== "no_candidates") x.elig++
        const r = e.reason ?? "unknown"
        x.nf[r] = (x.nf[r] ?? 0) + 1
      } else x.err++
      if (Number.isFinite(e.latencyMs)) s.lat.push(e.latencyMs)
      out.counts.applied++
      continue
    }

    if (!DELIVERY_KINDS.has(e.k)) {
      out.counts.invalid++
      out.dlq.push({ offset, reason: "unknown_kind" })
      continue
    }
    if (test) {
      out.counts.test++
      continue
    }
    const ev = e as Extract<StreamEvent, { k: "imp" | "view" | "vs" | "vc" | "rw" | "clk" }>
    const day = dateKeyInTz(ev.at)
    const d = reportingDay(ev.at)
    const key: DeliveryKey = { day, d, c: ev.c, p: ev.p, pl: ev.pl, cr: ev.cr, cc: ev.cc, dv: ev.dv, pf: ev.pf, f: ev.f }
    const id = deliveryId(key)
    let row = out.delivery.get(id)
    if (!row) out.delivery.set(id, (row = { key, delta: emptyDeliveryDelta() }))
    const statsKey = `${ev.c}|${day}`
    let st = out.stats.get(statsKey)
    if (!st) out.stats.set(statsKey, (st = { campaignId: ev.c, day: d, delta: { imp: 0, clk: 0, conv: 0, costMicros: 0 } }))
    const h = hourInTz(ev.at)
    switch (ev.k) {
      case "imp": {
        const cost = Math.max(0, Math.round(Number((ev as { cpi?: number }).cpi ?? 0)))
        row.delta.imp++
        row.delta.hImp[h]++
        row.delta.costMicros += cost
        st.delta.imp++
        st.delta.costMicros += cost
        if (cost) {
          let sp = out.spend.get(ev.c)
          if (!sp) out.spend.set(ev.c, (sp = { total: 0, hours: new Map() }))
          sp.total += cost
          const b = spendHourBucket(ev.at)
          sp.hours.set(b, (sp.hours.get(b) ?? 0) + cost)
        }
        break
      }
      case "view":
        row.delta.view++
        break
      case "clk":
        row.delta.clk++
        row.delta.hClk[h]++
        st.delta.clk++
        break
      case "vs":
        row.delta.vs++
        break
      case "vc":
        row.delta.vc++
        break
      case "rw":
        row.delta.rw++
        break
    }
    out.counts.applied++
  }
  for (const s of out.supply.values()) {
    if (!s.lat.length) continue
    const sorted = s.lat.sort((a, b) => a - b)
    s.delta.latP50 = percentile(sorted, 50)
    s.delta.latP99 = percentile(sorted, 99)
  }
  return out
}
