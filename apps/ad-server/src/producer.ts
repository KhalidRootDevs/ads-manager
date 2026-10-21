/**
 * Fire-and-forget supply-event producer for the hot path: events are buffered in memory and sent in batches
 * (acks all, small linger). If Kafka is down the buffer grows up to MAX_BUFFER, then new events are dropped and
 * counted. Never blocks or fails a request.
 */
import { EVENTS_TOPIC, partitionKey, type StreamEvent } from "@orbit/domain"
import { metrics, type Logger } from "@orbit/server-kit"
import { Kafka, logLevel, Partitioners, type Producer } from "kafkajs"

export interface EventSink {
  enqueue(e: StreamEvent): void
  close(): Promise<void>
}

export class BatchedProducer implements EventSink {
  private buf: { key: string; value: string }[] = []
  private producer: Producer
  private connected = false
  private sending = false
  private timer: NodeJS.Timeout

  constructor(brokers: string, private log: Logger, private opts = { lingerMs: 20, maxBatch: 1_000, maxBuffer: 50_000 }) {
    const kafka = new Kafka({
      clientId: "orbit-ad-server", brokers: brokers.split(","), logLevel: logLevel.NOTHING,
      connectionTimeout: 1_000, requestTimeout: 5_000, retry: { retries: 2, initialRetryTime: 200 },
    })
    this.producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner, allowAutoTopicCreation: false })
    this.connect()
    this.timer = setInterval(() => void this.flush(), opts.lingerMs)
    this.timer.unref()
  }

  private connect() {
    this.producer.connect().then(
      () => {
        this.connected = true
        metrics.set("kafka_producer_connected", 1)
      },
      (err) => {
        metrics.set("kafka_producer_connected", 0)
        this.log.error({ err: err.message }, "kafka connect failed; buffering supply events")
        setTimeout(() => this.connect(), 2_000).unref()
      },
    )
    this.producer.on("producer.disconnect", () => {
      this.connected = false
      metrics.set("kafka_producer_connected", 0)
    })
  }

  enqueue(e: StreamEvent) {
    if (this.buf.length >= this.opts.maxBuffer) {
      metrics.inc("supply_events_dropped", { reason: "buffer_full" })
      return
    }
    this.buf.push({ key: partitionKey(e), value: JSON.stringify(e) })
    metrics.set("supply_event_buffer", this.buf.length)
  }

  async flush() {
    if (this.sending || !this.connected || !this.buf.length) return
    this.sending = true
    const batch = this.buf.splice(0, this.opts.maxBatch)
    try {
      await this.producer.send({ topic: EVENTS_TOPIC, acks: -1, messages: batch })
      metrics.inc("supply_events_sent", {}, batch.length)
    } catch (err) {
      // put them back (bounded) and retry on the next tick
      const room = Math.max(0, this.opts.maxBuffer - this.buf.length)
      if (batch.length > room) metrics.inc("supply_events_dropped", { reason: "buffer_full" }, batch.length - room)
      this.buf.unshift(...batch.slice(0, room))
      this.log.error({ err: (err as Error).message }, "supply event send failed")
    } finally {
      this.sending = false
    }
  }

  async close() {
    clearInterval(this.timer)
    for (let i = 0; i < 20 && this.buf.length && this.connected; i++) await this.flush()
    await this.producer.disconnect().catch(() => {})
  }
}

/** In-memory sink for tests. */
export class MemorySink implements EventSink {
  events: StreamEvent[] = []
  enqueue(e: StreamEvent) {
    this.events.push(e)
  }
  async close() {}
}
