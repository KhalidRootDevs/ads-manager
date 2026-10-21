/** Read-through Redis cache for analytics results (60 s, keyed by a hash of the normalised query; §2.1, §6.11). */
import type { Deps } from "../context"
import { sha256, stableStringify } from "./json"

export async function cached<T>(deps: Pick<Deps, "redis" | "env" | "log">, ns: string, query: unknown, ttlSec: number, compute: () => Promise<T>): Promise<T> {
  const key = `${deps.env.REDIS_PREFIX}cache:${ns}:${sha256(stableStringify(query))}`
  try {
    const hit = await deps.redis.get(key)
    if (hit) return JSON.parse(hit) as T
  } catch (err) {
    deps.log.warn({ err }, "cache read failed")
  }
  const value = await compute()
  deps.redis.set(key, JSON.stringify(value), "EX", ttlSec).catch((err: unknown) => deps.log.warn({ err }, "cache write failed"))
  return value
}
