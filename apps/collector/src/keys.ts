/**
 * Property key hashes and web domains for /v1/conversions and /v1/heartbeat, taken from the serving index the
 * compiler publishes to Redis (the collector has no MongoDB). Swapped on `serving:updated`; last good kept.
 */
import { gunzipSync } from "node:zlib"
import { SERVING, type ServingIndex, type ServingProperty } from "@orbit/domain"
import { metrics, type Logger, type Redis } from "@orbit/server-kit"

export class PropertyDirectory {
  properties: Record<string, ServingProperty> | null = null
  version: string | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(private redis: Redis, private log: Logger) {}

  async load(version?: string) {
    try {
      const v = version ?? (await this.redis.get(SERVING.current))
      if (!v || v === this.version) return !!this.properties
      const buf = await this.redis.getBuffer(SERVING.index(v))
      if (!buf) throw new Error(`index ${v} not found`)
      const idx = JSON.parse(gunzipSync(buf).toString("utf8")) as ServingIndex
      this.properties = idx.properties
      this.version = v
      return true
    } catch (err) {
      metrics.inc("collector_index_load_failures")
      this.log.error({ err: (err as Error).message }, "property directory load failed; keeping last good")
      return false
    }
  }

  async start(sub: Redis) {
    await this.load()
    sub.on("message", (_c, v) => void this.load(v))
    await sub.subscribe(SERVING.channel).catch(() => {})
    this.timer = setInterval(() => void this.load(), 30_000)
    this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }
}
