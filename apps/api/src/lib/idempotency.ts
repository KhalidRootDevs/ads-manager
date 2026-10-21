/**
 * Idempotency-Key support (§7.1) for endpoints marked `idempotent: true` in the contract.
 * The first response (status + body, any status below 500) is stored in Redis for 24 h under
 * `idem:<userId>:<key>`; repeating the key replays it. Reusing a key with a different request → 422.
 * While the first request is running, a repeat gets 409.
 */
import { REDIS_KEYS } from "@orbit/domain"
import { badRequest, conflict, HttpError } from "@orbit/server-kit"
import type { RequestHandler } from "express"
import type { Deps } from "../context"
import { sha256, stableStringify } from "./json"

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/
const TTL_SEC = 24 * 3600
const PENDING_SEC = 60

interface Stored {
  state: "pending" | "done"
  hash: string
  status?: number
  type?: string
  body?: string
}

export function idempotency(deps: Pick<Deps, "redis" | "env" | "log">): RequestHandler {
  return async (req, res, next) => {
    const key = req.header("idempotency-key")
    if (!key || !req.actor) return next()
    if (!KEY_RE.test(key)) return next(badRequest("Idempotency-Key must be 8–128 letters, digits, dashes or underscores."))
    const rkey = deps.env.REDIS_PREFIX + REDIS_KEYS.idempotency(req.actor.id, key)
    const hash = sha256(stableStringify({ m: req.method, p: req.path, b: req.body ?? null }))
    let prior: string | null
    try {
      prior = await deps.redis.get(rkey)
    } catch (err) {
      deps.log.warn({ err }, "idempotency store unavailable; continuing without it")
      return next()
    }
    if (prior) {
      const rec = JSON.parse(prior) as Stored
      if (rec.hash !== hash) return next(new HttpError(422, "idempotency_mismatch", "This Idempotency-Key was already used for a different request."))
      if (rec.state === "pending") return next(conflict("A request with this Idempotency-Key is still being processed.", undefined, "idempotency_in_progress"))
      res.setHeader("Idempotent-Replayed", "true")
      res.status(rec.status ?? 200).type(rec.type ?? "application/json").send(rec.body ?? "")
      return
    }
    const claimed = await deps.redis.set(rkey, JSON.stringify({ state: "pending", hash } satisfies Stored), "EX", PENDING_SEC, "NX")
    if (!claimed) return next(conflict("A request with this Idempotency-Key is still being processed.", undefined, "idempotency_in_progress"))

    // Store the response before it is sent, so an immediate retry always sees it.
    const send = res.json.bind(res)
    res.json = ((body: unknown) => {
      const status = res.statusCode
      const write =
        status >= 500
          ? deps.redis.del(rkey)
          : deps.redis.set(rkey, JSON.stringify({ state: "done", hash, status, type: String(res.getHeader("content-type") ?? "application/json"), body: JSON.stringify(body) } satisfies Stored), "EX", TTL_SEC)
      write.catch((err: unknown) => deps.log.warn({ err }, "idempotency write failed")).finally(() => send(body))
      return res
    }) as typeof res.json
    next()
  }
}
