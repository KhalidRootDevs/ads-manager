/** KafkaJS helpers shared by the stream consumers (aggregator, attribution, raw sink). */
import { DLQ_TOPIC, type StreamEvent } from "@orbit/domain"
import { metrics, type Logger } from "@orbit/server-kit"
import { Kafka, logLevel, Partitioners, type Consumer, type KafkaMessage, type Producer } from "kafkajs"

export function createKafka(brokers: string, clientId: string, log: Logger) {
  return new Kafka({
    clientId,
    brokers: brokers.split(",").map((s) => s.trim()).filter(Boolean),
    logLevel: logLevel.WARN,
    retry: { retries: 8, initialRetryTime: 300 },
    logCreator: () => ({ level, log: entry }) => {
      const { message, ...rest } = entry
      if (level <= logLevel.ERROR) log.error({ kafka: rest }, message)
      else if (level === logLevel.WARN) log.warn({ kafka: rest }, message)
    },
  })
}

export function createProducer(kafka: Kafka): Producer {
  return kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner, allowAutoTopicCreation: false })
}

export interface ParsedMessage {
  offset: string
  event: StreamEvent | null
  raw: KafkaMessage
}

export function parseMessage(m: KafkaMessage): ParsedMessage {
  try {
    return { offset: m.offset, event: JSON.parse(m.value?.toString("utf8") ?? "null") as StreamEvent, raw: m }
  } catch {
    return { offset: m.offset, event: null, raw: m }
  }
}

/** Send events to the dead-letter topic with the reason in a header. */
export async function toDlq(producer: Producer, items: { raw: KafkaMessage; reason: string }[], group: string) {
  if (!items.length) return
  await producer.send({
    topic: DLQ_TOPIC,
    acks: -1,
    messages: items.map((x) => ({ key: x.raw.key, value: x.raw.value, headers: { reason: x.reason, group } })),
  })
  for (const x of items) metrics.inc("stream_dlq_events", { group, reason: x.reason })
}

export const offsetGt = (a: string, b: string | null) => b == null || BigInt(a) > BigInt(b)

export async function stopConsumer(c: Consumer | null) {
  if (c) await c.disconnect().catch(() => {})
}
