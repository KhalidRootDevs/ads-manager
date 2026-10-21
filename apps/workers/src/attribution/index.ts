/** attribution consumer group: clicks + conversions with the transactional watermark pattern. */
import { EVENTS_TOPIC } from "@orbit/domain"
import type { Db } from "@orbit/db"
import { metrics, type Logger } from "@orbit/server-kit"
import type { Kafka } from "kafkajs"
import { parseMessage } from "../kafka"
import { applyAttribution } from "./repo"

export const GROUP = "attribution"

export async function startAttribution(db: Db, kafka: Kafka, log: Logger) {
  const consumer = kafka.consumer({ groupId: GROUP, maxWaitTimeInMs: 2_000, sessionTimeout: 45_000 })
  await consumer.connect()
  await consumer.subscribe({ topic: EVENTS_TOPIC, fromBeginning: true })
  await consumer.run({
    autoCommit: false,
    eachBatchAutoResolve: false,
    partitionsConsumedConcurrently: 2,
    eachBatch: async ({ batch, heartbeat, isRunning, isStale, resolveOffset }) => {
      if (!isRunning() || isStale() || !batch.messages.length) return
      // only clicks and conversions matter here; cheap pre-filter on the raw JSON
      const parsed = batch.messages.map(parseMessage).filter((p) => p.event?.k === "clk" || p.event?.k === "conv")
      const last = batch.messages[batch.messages.length - 1].offset
      if (parsed.length) {
        const r = await applyAttribution(db, `attribution:${batch.partition}`, parsed.map((p) => ({ offset: p.offset, event: p.event })))
        metrics.inc("attribution_clicks_stored", {}, r.clicks)
        metrics.inc("attribution_conversions", { result: "counted" }, r.conversions)
        metrics.inc("attribution_conversions", { result: "duplicate" }, r.duplicates)
        metrics.inc("attribution_conversions", { result: "unknown_click" }, r.unknownClick)
        metrics.inc("attribution_conversions", { result: "expired" }, r.expired)
      }
      resolveOffset(last)
      await consumer.commitOffsets([{ topic: batch.topic, partition: batch.partition, offset: (BigInt(last) + 1n).toString() }])
      await heartbeat()
    },
  })
  log.info("attribution consuming")
  return { stop: () => consumer.disconnect().catch(() => {}) }
}
