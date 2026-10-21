/** ad-server boot: env → Redis (+ subscriber) → serving index → Kafka producer → HTTP. */
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { parseSecrets } from "@orbit/domain/node"
import { createLogger, createRedis, serve } from "@orbit/server-kit"
import { buildApp } from "./app"
import { loadEnv } from "./env"
import { createGeo } from "./geo"
import { IndexStore } from "./index-store"
import { BatchedProducer } from "./producer"

function tagPath(override: string) {
  if (override) return resolve(override)
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return join(dir, "packages", "sdk-web", "dist", "orbit.js")
    dir = dirname(dir)
  }
  return resolve("packages/sdk-web/dist/orbit.js")
}

async function main() {
  const env = loadEnv()
  const log = createLogger("ad-server", env.LOG_LEVEL)
  // Hot path: fail fast instead of queueing commands while Redis is down (§10 degraded mode)
  const redis = createRedis(env.REDIS_URL, { maxRetriesPerRequest: 0, enableOfflineQueue: false, commandTimeout: 50 })
  redis.on("error", () => {})
  const sub = createRedis(env.REDIS_URL, { maxRetriesPerRequest: null })
  sub.on("error", () => {})
  const store = new IndexStore(createRedis(env.REDIS_URL), log)
  await store.start(sub)
  const sink = new BatchedProducer(env.KAFKA_BROKERS, log)
  const geo = await createGeo(env.GEOIP_DB_PATH, env.DEV_DEFAULT_COUNTRY)
  const app = buildApp({
    log, geo, production: env.NODE_ENV === "production", defaultCountry: env.DEV_DEFAULT_COUNTRY, internalToken: env.INTERNAL_TOKEN, sdkMinVersion: env.SDK_MIN_VERSION, tagPath: tagPath(env.SDK_WEB_DIST),
    deps: {
      store, redis, sink,
      cfg: {
        trackingUrl: env.TRACKING_URL.replace(/\/$/, ""), ring: parseSecrets(env.TRACKING_SECRETS, env.TRACKING_ACTIVE_KID), keyPepper: env.KEY_PEPPER, uidPepper: env.UID_PEPPER,
        sampleRate: env.REQUEST_SAMPLE_RATE, degradedPacingFactor: env.DEGRADED_PACING_FACTOR, allowLocalOrigins: env.NODE_ENV !== "production", redisTimeoutMs: 25,
      },
    },
  })
  await serve(app, {
    port: env.AD_SERVER_PORT, log,
    onShutdown: async () => {
      await sink.close()
      store.stop()
      redis.disconnect()
    },
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
