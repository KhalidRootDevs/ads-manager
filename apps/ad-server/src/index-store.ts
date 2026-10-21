/**
 * In-memory serving index (§4.3–4.4): loaded from Redis (gzip JSON), prepared once per version (country Sets,
 * flight end keys), swapped atomically on `serving:updated`. A failed load keeps the last good index.
 */
import { gunzipSync } from "node:zlib"
import { dateKeyInTz, SERVING, type Candidate, type ServingIndex } from "@orbit/domain"
import { metrics, type Logger, type Redis } from "@orbit/server-kit"

export interface PreparedIndex {
  index: ServingIndex
  /** flight end date key in the campaign time zone (hourly allowance) */
  endKey: WeakMap<Candidate, string>
  /** web property domains, for CORS preflights (which carry no x-orbit-app value) */
  webIds: string[]
  loadedAt: number
}

export function prepare(index: ServingIndex): PreparedIndex {
  const endKey = new WeakMap<Candidate, string>()
  for (const pl of Object.values(index.placements)) {
    for (const c of pl.candidates) {
      c.countrySet = new Set(c.countries)
      endKey.set(c, dateKeyInTz(c.endMs - 1, c.tz))
    }
  }
  const webIds = Object.values(index.properties).filter((p) => p.platform === "web").map((p) => p.identifier.toLowerCase())
  return { index, endKey, webIds, loadedAt: Date.now() }
}

export class IndexStore {
  current: PreparedIndex | null = null
  private timers: NodeJS.Timeout[] = []
  private sub: Redis | null = null

  constructor(private redis: Redis, private log: Logger) {}

  /** Load a version (default: serving:current). Keeps the last good index on failure. */
  async load(version?: string): Promise<boolean> {
    try {
      const v = version ?? (await this.redis.get(SERVING.current))
      if (!v) return false
      if (this.current?.index.version === v) return true
      const buf = await this.redis.getBuffer(SERVING.index(v))
      if (!buf) throw new Error(`index ${v} not found`)
      const index = JSON.parse(gunzipSync(buf).toString("utf8")) as ServingIndex
      this.current = prepare(index) // atomic swap: requests in flight keep their reference
      metrics.inc("serving_index_loads", { result: "ok" })
      this.log.warn({ version: v, placements: Object.keys(index.placements).length }, "serving index loaded")
      return true
    } catch (err) {
      metrics.inc("serving_index_loads", { result: "error" })
      this.log.error({ err: (err as Error).message }, "serving index load failed; keeping last good index")
      return false
    }
  }

  /** Subscribe to version announcements (dedicated connection) and poll as a safety net. */
  async start(subscriber: Redis, pollMs = 30_000) {
    this.sub = subscriber
    await this.load()
    subscriber.on("message", (_ch, version) => void this.load(version))
    await subscriber.subscribe(SERVING.channel).catch((err) => this.log.error({ err: err.message }, "subscribe failed"))
    this.timers.push(setInterval(() => void this.load(), pollMs))
    this.timers.push(
      setInterval(() => {
        const c = this.current
        if (!c) return
        metrics.set("serving_index_age_seconds", (Date.now() - Date.parse(c.index.builtAt)) / 1000)
        metrics.set("serving_index_version_info", 1, { version: c.index.version })
      }, 5_000),
    )
    for (const t of this.timers) t.unref()
  }

  stop() {
    this.timers.forEach(clearInterval)
    this.sub?.disconnect()
  }
}
