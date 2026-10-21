/**
 * raw-sink (§5.4): consumer group `raw-sink` → gzipped NDJSON partitioned dt=YYYY-MM-DD/hour=HH/type=<k> (UTC),
 * one object per (batch, partition, dt, hour, type) named part-<partition>-<firstOffset>.ndjson.gz, so a replayed
 * batch overwrites the same object (idempotent). Production follow-up: Parquet (or a managed Kafka Connect /
 * Firehose sink) — NDJSON keeps v1 dependency-free.
 */
import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { gzipSync } from "node:zlib"
import { EVENTS_TOPIC } from "@orbit/domain"
import { metrics, type Logger } from "@orbit/server-kit"
import type { Kafka, KafkaMessage } from "kafkajs"

export const GROUP = "raw-sink"

export interface LakeSink {
  put(path: string, body: Buffer): Promise<void>
}

export function localSink(root: string): LakeSink {
  return {
    async put(path, body) {
      const full = join(root, path)
      await mkdir(dirname(full), { recursive: true })
      const tmp = `${full}.tmp-${process.pid}`
      await writeFile(tmp, body)
      await rename(tmp, full)
    },
  }
}

/** S3 driver: needs `@aws-sdk/client-s3` installed (not a v1 dependency); loaded lazily. */
export async function s3Sink(bucket: string): Promise<LakeSink> {
  const modName = "@aws-sdk/client-s3"
  const mod = (await import(modName).catch(() => {
    throw new Error("LAKE_DRIVER=s3 needs @aws-sdk/client-s3 (pnpm --filter @orbit/workers add @aws-sdk/client-s3)")
  })) as { S3Client: new (o: object) => { send(c: unknown): Promise<unknown> }; PutObjectCommand: new (o: object) => unknown }
  const client = new mod.S3Client({})
  return {
    async put(path, body) {
      await client.send(new mod.PutObjectCommand({ Bucket: bucket, Key: path, Body: body, ContentType: "application/x-ndjson", ContentEncoding: "gzip" }))
    },
  }
}

/** Group a partition batch into lake objects. */
export function lakeObjects(partition: number, messages: KafkaMessage[]): { path: string; body: Buffer; count: number }[] {
  const groups = new Map<string, { first: string; lines: string[] }>()
  for (const m of messages) {
    const raw = m.value?.toString("utf8") ?? ""
    let k = "unknown"
    let at = Number(m.timestamp)
    try {
      const e = JSON.parse(raw) as { k?: string; at?: number }
      if (typeof e.k === "string" && /^[a-z]{1,10}$/.test(e.k)) k = e.k
      if (typeof e.at === "number") at = e.at
    } catch {
      k = "invalid"
    }
    const iso = new Date(Number.isFinite(at) ? at : Date.now()).toISOString()
    const dir = `dt=${iso.slice(0, 10)}/hour=${iso.slice(11, 13)}/type=${k}`
    const g = groups.get(dir) ?? { first: m.offset, lines: [] }
    g.lines.push(raw)
    groups.set(dir, g)
  }
  return [...groups].map(([dir, g]) => ({ path: `${dir}/part-${String(partition).padStart(2, "0")}-${g.first.padStart(12, "0")}.ndjson.gz`, body: gzipSync(g.lines.join("\n") + "\n"), count: g.lines.length }))
}

export async function startLake(kafka: Kafka, sink: LakeSink, log: Logger) {
  const consumer = kafka.consumer({ groupId: GROUP, maxWaitTimeInMs: 5_000, minBytes: 64 * 1024, maxBytesPerPartition: 8 * 1024 * 1024 })
  await consumer.connect()
  await consumer.subscribe({ topic: EVENTS_TOPIC, fromBeginning: true })
  await consumer.run({
    autoCommit: false,
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, heartbeat, isRunning, isStale, resolveOffset }) => {
      if (!isRunning() || isStale() || !batch.messages.length) return
      for (const o of lakeObjects(batch.partition, batch.messages)) {
        await sink.put(o.path, o.body)
        metrics.inc("lake_events_written", {}, o.count)
      }
      const last = batch.messages[batch.messages.length - 1].offset
      resolveOffset(last)
      await consumer.commitOffsets([{ topic: batch.topic, partition: batch.partition, offset: (BigInt(last) + 1n).toString() }])
      await heartbeat()
    },
  })
  log.info("raw-sink consuming")
  return { stop: () => consumer.disconnect().catch(() => {}) }
}
