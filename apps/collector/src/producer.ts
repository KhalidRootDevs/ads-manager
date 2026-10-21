/**
 * Acked producer for the collector (§5.2 no-loss guarantee): callers await the broker ack (acks = all).
 * Concurrent requests are micro-batched (linger ≤ 5 ms) into one produce call. When Kafka is unavailable the
 * promise rejects quickly so the endpoint can answer 503 and the SDK retries.
 */
import { EVENTS_TOPIC, partitionKey, type StreamEvent } from "@orbit/domain"
import { metrics, type Logger } from "@orbit/server-kit"
import { Kafka, logLevel, Partitioners, type Producer } from "kafkajs"

export interface AckedProducer {
  send(events: StreamEvent[]): Promise<void>
  ready(): boolean
  close(): Promise<void>
}

interface Pending {
  msgs: { key: string; value: string }[]
  resolve: () => void
  reject: (e: Error) => void
}

export class KafkaAckedProducer implements AckedProducer {
  private producer: Producer
  private connected = false
  private queue: Pending[] = []
  private timer: NodeJS.Timeout | null = null
  private inflight = 0

  constructor(brokers: string, private log: Logger, private opts = { lingerMs: 5, maxBatch: 2_000, maxInflight: 4, timeoutMs: 3_000 }) {
    const kafka = new Kafka({ clientId: "orbit-collector", brokers: brokers.split(","), logLevel: logLevel.NOTHING, connectionTimeout: 1_000, requestTimeout: 3_000, retry: { retries: 2, initialRetryTime: 100 } })
    this.producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner, allowAutoTopicCreation: false, idempotent: false })
    this.producer.on("producer.disconnect", () => {
      this.connected = false
      metrics.set("kafka_producer_connected", 0)
      setTimeout(() => this.connect(), 1_000).unref()
    })
    this.connect()
  }

  private connect() {
    this.producer.connect().then(
      () => {
        this.connected = true
        metrics.set("kafka_producer_connected", 1)
      },
      (err) => {
        this.log.error({ err: err.message }, "kafka connect failed")
        setTimeout(() => this.connect(), 2_000).unref()
      },
    )
  }

  ready() {
    return this.connected
  }

  send(events: StreamEvent[]): Promise<void> {
    if (!this.connected) return Promise.reject(new Error("kafka unavailable"))
    return new Promise((resolve, reject) => {
      this.queue.push({ msgs: events.map((e) => ({ key: partitionKey(e), value: JSON.stringify(e) })), resolve, reject })
      if (!this.timer) this.timer = setTimeout(() => this.flush(), this.opts.lingerMs)
    })
  }

  private flush() {
    this.timer = null
    if (!this.queue.length) return
    if (this.inflight >= this.opts.maxInflight) {
      this.timer = setTimeout(() => this.flush(), this.opts.lingerMs)
      return
    }
    const batch: Pending[] = []
    let n = 0
    while (this.queue.length && n < this.opts.maxBatch) {
      const p = this.queue.shift()!
      batch.push(p)
      n += p.msgs.length
    }
    this.inflight++
    const t0 = Date.now()
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("kafka produce timeout")), this.opts.timeoutMs).unref())
    Promise.race([this.producer.send({ topic: EVENTS_TOPIC, acks: -1, messages: batch.flatMap((p) => p.msgs) }), timeout]).then(
      () => {
        metrics.observe("collector_produce_seconds", (Date.now() - t0) / 1000)
        metrics.inc("collector_events_produced", {}, n)
        batch.forEach((p) => p.resolve())
      },
      (err: Error) => {
        metrics.inc("collector_produce_failures")
        this.log.error({ err: err.message }, "produce failed")
        batch.forEach((p) => p.reject(err))
      },
    ).finally(() => {
      this.inflight--
      if (this.queue.length && !this.timer) this.timer = setTimeout(() => this.flush(), 0)
    })
  }

  async close() {
    await this.producer.disconnect().catch(() => {})
  }
}
