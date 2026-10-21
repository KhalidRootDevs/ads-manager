/**
 * Rate limits (§7.1): admin 600 req/min/user, analytics 60 req/min/user, dev sign-in 20/min/IP.
 * Counters live in Redis so every API pod shares them. If Redis is down the request passes (fail open).
 */
import { tooMany } from "@orbit/server-kit"
import type { RequestHandler } from "express"
import { ipKeyGenerator, rateLimit } from "express-rate-limit"
import { RedisStore, type RedisReply } from "rate-limit-redis"
import type { Deps } from "../context"

export function limiter(deps: Pick<Deps, "redis" | "env">, name: string, perMinute: number, by: "user" | "ip"): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    passOnStoreError: true,
    store: new RedisStore({
      prefix: `${deps.env.REDIS_PREFIX}rl:${name}:`,
      sendCommand: (...args: string[]) => deps.redis.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
    }),
    keyGenerator: (req) => (by === "user" && req.actor ? `u:${req.actor.id}` : `ip:${ipKeyGenerator(req.ip ?? "0.0.0.0")}`),
    handler: (_req, _res, next) => next(tooMany("Too many requests. Wait a minute and try again.")),
  })
}
