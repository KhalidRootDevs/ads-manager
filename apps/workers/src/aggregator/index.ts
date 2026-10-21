/**
 * rollup-aggregator (§5.3): consumer group `rollup-aggregator` on events.v1. Each partition batch is aggregated
 * in memory and flushed in ONE transaction with the watermark; Kafka offsets are committed afterwards; then the
 * Redis spend counters (pacing), request samples and heartbeats are updated.
 */
import { EVENTS_TOPIC, REDIS_KEYS } from "@orbit/domain"
import type { Db } from "@orbit/db"
import { metrics, type Logger, type Redis } from "@orbit/server-kit"
import type { Consumer, Kafka, Producer } from "kafkajs"
import { createProducer, parseMessage, toDlq } from "../kafka"
import type { Aggregate } from "./aggregate"
import { applyRollups, insertSamples, writeHeartbeat } from "./repo"

export const GROUP = "rollup-aggregator"
const SPEND_HOUR_TTL_SEC = 7_200
const HEARTBEAT_THROTTLE_SEC = 60

/** Post-commit side effects. Redis is best-effort: the nightly reconcile resets spend from campaign_stats. */
export async function afterCommit(db: Db, redis: Redis, agg: Aggregate, log: Logger) {
  if (agg.spend.size) {
    const p = redis.pipeline()
    for (const [c, s] of agg.spend) {
      p.incrby(REDIS_KEYS.spend(c), s.total)
      for (const [b, n] of s.hours) {
        p.incrby(REDIS_KEYS.spendHour(c, b), n)
        p.expire(REDIS_KEYS.spendHour(c, b), SPEND_HOUR_TTL_SEC)
      }
    }
    await p.exec().catch((err) => log.warn({ err: err.message }, "spend counters not updated (reconcile will repair)"))
  }
  await insertSamples(db, agg.samples).catch((err) => log.warn({ err: err.message }, "request samples not stored"))
  for (const hb of agg.heartbeats.values()) {
    try {
      const fresh = await redis.set(REDIS_KEYS.heartbeat(hb.p), "1", "EX", HEARTBEAT_THROTTLE_SEC, "NX").catch(() => "OK")
      if (fresh !== "OK") continue
      await writeHeartbeat(db, hb.p, hb.sdk, new Date(hb.at))
      metrics.inc("aggregator_heartbeats_written")
    } catch (err) {
      log.warn({ err: (err as Error).message, p: hb.p }, "heartbeat write failed")
    }
  }
}

export async function startAggregator(db: Db, redis: Redis, kafka: Kafka, log: Logger) {
  const consumer: Consumer = kafka.consumer({ groupId: GROUP, maxWaitTimeInMs: 2_000, minBytes: 1, maxBytesPerPartition: 4 * 1024 * 1024, sessionTimeout: 45_000 })
  const producer: Producer = createProducer(kafka)
  await Promise.all([consumer.connect(), producer.connect()])
  await consumer.subscribe({ topic: EVENTS_TOPIC, fromBeginning: true })
  await consumer.run({
    autoCommit: false,
    eachBatchAutoResolve: false,
    partitionsConsumedConcurrently: 4,
    eachBatch: async ({ batch, heartbeat, isRunning, isStale, resolveOffset }) => {
      if (!isRunning() || isStale() || !batch.messages.length) return
      const t0 = Date.now()
      const parsed = batch.messages.map(parseMessage)
      const id = `${batch.topic}:${batch.partition}`
      const r = await applyRollups(db, id, parsed)
      if (r.agg?.dlq.length) {
        const byOffset = new Map(parsed.map((p) => [p.offset, p.raw]))
        await toDlq(producer, r.agg.dlq.map((d) => ({ raw: byOffset.get(d.offset)!, reason: d.reason })), GROUP)
      }
      const last = batch.messages[batch.messages.length - 1].offset
      resolveOffset(last)
      await consumer.commitOffsets([{ topic: batch.topic, partition: batch.partition, offset: (BigInt(last) + 1n).toString() }])
      await heartbeat()
      if (r.agg) {
        await afterCommit(db, redis, r.agg, log)
        const c = r.agg.counts
        metrics.inc("aggregator_events", { result: "applied" }, c.applied)
        metrics.inc("aggregator_events", { result: "test" }, c.test)
        metrics.inc("aggregator_events", { result: "late" }, c.late)
        metrics.inc("aggregator_events", { result: "invalid" }, c.invalid)
      }
      metrics.inc("aggregator_events", { result: "replayed_skipped" }, r.skipped)
      metrics.observe("aggregator_flush_seconds", (Date.now() - t0) / 1000)
      metrics.set("aggregator_lag_seconds", Math.max(0, (Date.now() - Number(batch.messages[batch.messages.length - 1].timestamp)) / 1000), { partition: String(batch.partition) })
    },
  })
  log.info("rollup-aggregator consuming")
  return {
    async stop() {
      await consumer.disconnect().catch(() => {})
      await producer.disconnect().catch(() => {})
    },
  }
}
