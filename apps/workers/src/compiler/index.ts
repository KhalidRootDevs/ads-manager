/**
 * config-compiler (§4.3): leader-elected singleton. Compiles the serving index from MongoDB, writes
 * gzip(JSON) to Redis under a new version, flips `serving:current` and publishes the version.
 * Recompiles on change streams (debounced) and every COMPILE_INTERVAL_MS for time-based transitions.
 */
import { randomBytes } from "node:crypto"
import { gzipSync } from "node:zlib"
import { SERVING, type ServingIndex } from "@orbit/domain"
import type { Db } from "@orbit/db"
import { metrics, type Logger, type Redis } from "@orbit/server-kit"
import { compileIndex, sameIssues } from "./compile"
import { loadCompileInput, writeHealth } from "./repo"
import { openStreams, type Streams } from "./streams"

const LOCK_TTL_MS = 15_000
const KEEP_VERSIONS = 3
const OLD_VERSION_TTL_SEC = 600

/** Monotonic, sortable version: base36 time + random suffix. */
export const newVersion = () => `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`

/** Write a compiled index to Redis and announce it (shared by the service and tests). */
export async function publishIndex(redis: Redis, index: ServingIndex): Promise<number> {
  const blob = gzipSync(Buffer.from(JSON.stringify(index)))
  const tx = redis.multi()
  tx.set(SERVING.index(index.version), blob)
  tx.lpush(SERVING.versions, index.version)
  tx.set(SERVING.current, index.version)
  await tx.exec()
  await redis.publish(SERVING.channel, index.version)
  // keep the newest KEEP_VERSIONS; expire the rest (ad servers may still be loading them)
  const old = await redis.lrange(SERVING.versions, KEEP_VERSIONS, -1)
  if (old.length) {
    const p = redis.multi()
    for (const v of old) p.expire(SERVING.index(v), OLD_VERSION_TTL_SEC)
    p.ltrim(SERVING.versions, 0, KEEP_VERSIONS - 1)
    await p.exec()
  }
  return blob.length
}

/** One compile: load → compile → publish → persist changed health. */
export async function compileOnce(db: Db, redis: Redis, log: Logger) {
  const t0 = Date.now()
  const input = await loadCompileInput(db)
  const version = newVersion()
  const now = new Date()
  const { index, health } = compileIndex(input, version, now)
  const bytes = await publishIndex(redis, index)
  let healthWrites = 0
  for (const c of input.campaigns) {
    const issues = health.get(c._id) ?? []
    if (!sameIssues(c.health?.issues, issues)) {
      await writeHealth(db, c._id, issues, now)
      healthWrites++
    }
  }
  const candidates = Object.values(index.placements).reduce((a, p) => a + p.candidates.length, 0)
  metrics.inc("compiler_compiles")
  metrics.set("compiler_index_bytes", bytes)
  metrics.set("compiler_index_candidates", candidates)
  metrics.observe("compiler_compile_seconds", (Date.now() - t0) / 1000)
  log.info({ version, bytes, placements: Object.keys(index.placements).length, candidates, healthWrites, ms: Date.now() - t0 }, "serving index published")
  return { version, index }
}

const RENEW = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`

export interface CompilerOpts {
  intervalMs: number
  debounceMs: number
}

export function startCompiler(db: Db, redis: Redis, log: Logger, opts: CompilerOpts) {
  const me = `${process.pid}-${randomBytes(4).toString("hex")}`
  let leader = false
  let stopped = false
  let streams: Streams | null = null
  let timer: NodeJS.Timeout | null = null
  let debounce: NodeJS.Timeout | null = null
  let running: Promise<void> | null = null
  let again = false

  const run = async () => {
    if (!leader || stopped) return
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      try {
        await compileOnce(db, redis, log)
        if (streams) {
          const toks = streams.tokens()
          const entries = Object.entries(toks)
          if (entries.length) await redis.hset(SERVING.resumeToken, Object.fromEntries(entries.map(([k, v]) => [k, JSON.stringify(v)])))
        }
      } catch (err) {
        metrics.inc("compiler_failures")
        log.error({ err }, "compile failed; ad servers keep the last good index")
      } finally {
        running = null
        if (again) {
          again = false
          void run()
        }
      }
    })()
    return running
  }

  const schedule = () => {
    if (debounce) return
    debounce = setTimeout(() => {
      debounce = null
      void run()
    }, opts.debounceMs)
  }

  const becomeLeader = async () => {
    leader = true
    metrics.set("compiler_leader", 1)
    log.info({ me }, "compiler: became leader")
    streams = await openStreams(db, redis, log, () => schedule(), () => void run())
    await run()
    timer = setInterval(() => void run(), opts.intervalMs)
  }

  const loseLeadership = async () => {
    leader = false
    metrics.set("compiler_leader", 0)
    log.warn({ me }, "compiler: lost leadership")
    if (timer) clearInterval(timer)
    timer = null
    await streams?.close()
    streams = null
  }

  const tick = async () => {
    if (stopped) return
    try {
      if (leader) {
        const ok = await redis.eval(RENEW, 1, SERVING.leaderLock, me, String(LOCK_TTL_MS))
        if (!ok) await loseLeadership()
      } else {
        const got = await redis.set(SERVING.leaderLock, me, "PX", LOCK_TTL_MS, "NX")
        if (got === "OK") await becomeLeader()
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, "compiler: leader lock check failed")
    }
  }

  void tick()
  const lockTimer = setInterval(() => void tick(), LOCK_TTL_MS / 3)

  return {
    isLeader: () => leader,
    compileNow: run,
    async stop() {
      stopped = true
      clearInterval(lockTimer)
      if (debounce) clearTimeout(debounce)
      if (timer) clearInterval(timer)
      await running
      await streams?.close()
      if (leader) await redis.eval(RELEASE, 1, SERVING.leaderLock, me).catch(() => {})
    },
  }
}
