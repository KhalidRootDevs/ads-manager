import { Redis, type RedisOptions } from "ioredis"
import pino, { type Logger } from "pino"

export * from "./app"
export * from "./env"
export * from "./errors"
export * from "./metrics"
export * from "./validate"

/** JSON logs with credentials redacted. */
export function createLogger(service: string, level = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({
    name: service,
    level,
    base: { service },
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-orbit-sig']", "*.secret", "*.password", "*.hash", "secret", "MONGODB_URI"],
      censor: "[redacted]",
    },
    ...(process.env.NODE_ENV === "production" ? {} : { transport: undefined }),
  })
}

export function createRedis(url: string, opts: RedisOptions = {}): Redis {
  return new Redis(url, { maxRetriesPerRequest: 2, enableAutoPipelining: true, lazyConnect: false, ...opts })
}

export type { Logger }
export { Redis }
