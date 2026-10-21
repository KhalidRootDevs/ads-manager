/**
 * Persistent, batched beacon queue (§8 Reliability).
 * - persisted in storage (`orbit.q`) so events survive navigation and reloads
 * - flushes every `intervalMs` (10 s) or as soon as `flushAt` (20) events are queued
 * - POSTs `{ events: [{ type, token, at }] }` (≤ 50 per request) to `${endpoint}/v1/e`
 * - 2xx → done; 4xx except 429 → batch dropped (bad tokens never become valid); otherwise exponential back-off
 * - events older than 24 h are dropped; duplicates (same type + token) are queued once
 * - on page hide, `flushBeacon()` hands everything to `navigator.sendBeacon`
 *
 * Wire format: the body is JSON. `sendBeacon` sends it as `text/plain;charset=UTF-8` (a CORS-safelisted type,
 * so no preflight); the collector accepts JSON in text/plain bodies. `fetch` uses `application/json`.
 */
import { backoffMs, expired } from "./backoff"
import { readJson, writeJson } from "./storage"
import type { BeaconType, KV } from "./types"

export interface QueuedEvent {
  type: BeaconType
  token: string
  at: number
  /** collector base URL (origin of the tracking URL) */
  e: string
}

/** Transport: resolves with the HTTP status (0 = network error). */
export type Send = (url: string, body: string) => Promise<number>
export type Beacon = (url: string, body: string) => boolean

export interface QueueOptions {
  storage: KV
  send: Send
  now?: () => number
  key?: string
  flushAt?: number
  batchSize?: number
  maxQueued?: number
  log?: (...a: unknown[]) => void
}

export class BeaconQueue {
  readonly key: string
  private items: QueuedEvent[]
  private failures = 0
  private nextAttemptAt = 0
  private inFlight = false
  private readonly now: () => number
  private readonly flushAt: number
  private readonly batchSize: number
  private readonly maxQueued: number

  constructor(private o: QueueOptions) {
    this.key = o.key ?? "orbit.q"
    this.now = o.now ?? Date.now
    this.flushAt = o.flushAt ?? 20
    this.batchSize = o.batchSize ?? 50
    this.maxQueued = o.maxQueued ?? 500
    const stored = readJson<QueuedEvent[]>(o.storage, this.key, [])
    this.items = Array.isArray(stored) ? stored.filter((x) => x && x.token && x.type && !expired(x.at, this.now())) : []
  }

  get size() {
    return this.items.length
  }

  get pending(): readonly QueuedEvent[] {
    return this.items
  }

  get retryAt() {
    return this.nextAttemptAt
  }

  push(type: BeaconType, token: string, endpoint: string, at = this.now()): boolean {
    if (this.items.some((x) => x.type === type && x.token === token)) return false
    this.items.push({ type, token, at, e: endpoint })
    if (this.items.length > this.maxQueued) this.items.splice(0, this.items.length - this.maxQueued)
    this.persist()
    if (this.items.length >= this.flushAt) void this.flush()
    return true
  }

  /** Periodic tick (every 10 s): flush unless backing off. */
  tick(): Promise<void> {
    return this.flush()
  }

  async flush(force = false): Promise<void> {
    if (this.inFlight || !this.items.length) return
    const now = this.now()
    if (!force && now < this.nextAttemptAt) return
    this.dropExpired(now)
    this.inFlight = true
    try {
      while (this.items.length) {
        const endpoint = this.items[0].e
        const batch = this.items.filter((x) => x.e === endpoint).slice(0, this.batchSize)
        const status = await this.o.send(`${endpoint}/v1/e`, body(batch)).catch(() => 0)
        if ((status >= 200 && status < 300) || (status >= 400 && status < 500 && status !== 429)) {
          if (status >= 400) this.o.log?.("beacon batch rejected", status)
          this.remove(batch)
          this.failures = 0
          this.nextAttemptAt = 0
          continue
        }
        this.failures++
        this.nextAttemptAt = this.now() + backoffMs(this.failures)
        this.o.log?.("beacon flush failed", status, "retry in", backoffMs(this.failures), "ms")
        break
      }
    } finally {
      this.inFlight = false
      this.persist()
    }
  }

  /** Page is going away: hand everything to sendBeacon; keep what the browser refuses. */
  flushBeacon(beacon: Beacon) {
    this.dropExpired(this.now())
    const groups = new Map<string, QueuedEvent[]>()
    for (const x of this.items) groups.set(x.e, [...(groups.get(x.e) ?? []), x])
    for (const [endpoint, list] of groups) {
      for (let i = 0; i < list.length; i += this.batchSize) {
        const batch = list.slice(i, i + this.batchSize)
        let ok = false
        try {
          ok = beacon(`${endpoint}/v1/e`, body(batch))
        } catch {
          ok = false
        }
        if (ok) this.remove(batch)
      }
    }
    this.persist()
  }

  private dropExpired(now: number) {
    const before = this.items.length
    this.items = this.items.filter((x) => !expired(x.at, now))
    if (this.items.length !== before) this.o.log?.("dropped expired beacons", before - this.items.length)
  }

  private remove(batch: QueuedEvent[]) {
    const s = new Set(batch)
    this.items = this.items.filter((x) => !s.has(x))
  }

  private persist() {
    writeJson(this.o.storage, this.key, this.items)
  }
}

const body = (batch: QueuedEvent[]) => JSON.stringify({ events: batch.map((x) => ({ type: x.type, token: x.token, at: x.at })) })
