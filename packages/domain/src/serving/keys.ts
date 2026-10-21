/** Redis key names shared by the compiler, ad server, collector and aggregator. */
export const SERVING = {
  /** gzip(JSON ServingIndex) per version */
  index: (version: string) => `serving:index:${version}`,
  current: "serving:current",
  /** pub/sub channel; message = version */
  channel: "serving:updated",
  /** compiler leader lock */
  leaderLock: "serving:compiler:leader",
  /** change-stream resume tokens (hash: collection → token JSON) */
  resumeToken: "serving:compiler:resume",
  /** recent index versions, newest first (the compiler keeps 3 and expires older ones) */
  versions: "serving:versions",
} as const

/** UTC hour bucket ("2026101915") used by the hourly spend counters (aggregator writes, ad server reads). */
export function spendHourBucket(now: number): string {
  const d = new Date(now)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}`
}

export const REDIS_KEYS = {
  /** frequency cap counter: uid hash × campaign × period bucket */
  freq: (uidHash: string, campaignId: string, bucket: string) => `fc:${uidHash}:${campaignId}:${bucket}`,
  /** spend so far (micros), maintained by the rollup aggregator from impression events */
  spend: (campaignId: string) => `spend:${campaignId}`,
  /** spend in the current hour bucket (micros), for even pacing */
  spendHour: (campaignId: string, hourBucket: string) => `spendh:${campaignId}:${hourBucket}`,
  /** collector dedupe: one event per type × request */
  dedupe: (type: string, requestId: string) => `dd:${type}:${requestId}`,
  /** API idempotency keys (24 h) */
  idempotency: (userId: string, key: string) => `idem:${userId}:${key}`,
  /** heartbeat throttle (1 write/min/property) */
  heartbeat: (propertyId: string) => `hb:${propertyId}`,
  /** last-used throttle for SDK keys (1 write/hour/key) */
  keyUsed: (keyId: string) => `ku:${keyId}`,
} as const

/** Header carrying the SDK key secret on /v1/serve, /v1/heartbeat and /v1/conversions (apps and servers). */
export const KEY_HEADER = "x-orbit-key"
/** Header carrying the property id (= public App ID). */
export const APP_HEADER = "x-orbit-app"
/** Service-to-service token header for internal endpoints (e.g. the API's test request). */
export const INTERNAL_HEADER = "x-orbit-internal"
