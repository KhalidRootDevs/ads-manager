/** Admin API process: env → Mongo (primary + analytics) → Redis → Express → graceful shutdown. */
import { connect } from "@orbit/db"
import { createLogger, createRedis, serve } from "@orbit/server-kit"
import { buildApp } from "./app"
import { loadEnv } from "./env"

const env = loadEnv()
const log = createLogger("api", env.LOG_LEVEL)
const db = await connect({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB, service: "api", analyticsReadPreference: env.MONGODB_ANALYTICS_READ_PREF })
const redis = createRedis(env.REDIS_URL)
redis.on("error", (err) => log.warn({ err: err.message }, "redis error"))

const app = await buildApp({ env, db, redis, log, fetch: globalThis.fetch, now: () => new Date() })
await serve(app, {
  port: env.API_PORT,
  log,
  onShutdown: async () => {
    await Promise.allSettled([db.close(), redis.quit()])
  },
})
log.info({ db: env.MONGODB_DB, storage: env.STORAGE_DRIVER, devLogin: env.AUTH_DEV_LOGIN && env.NODE_ENV !== "production" }, "api ready")
