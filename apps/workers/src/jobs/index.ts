/**
 * jobs: Redis-locked intervals (no BullMQ queue needed: every job is an idempotent sweep, so "run at most once
 * per period across replicas" is all we need). Each run takes `jobs:lock:<name>` with SET NX PX for its period.
 *   every minute : status transitions, budget auto-pause, heartbeat-missing, grace-key expiry, alert sync
 *   hourly       : key lastUsedAt from Redis
 *   nightly 03:00 Asia/Dhaka : reconcile + retention (+ $indexStats report on the 1st of the month)
 */
import type { Db } from "@orbit/db"
import { hourInTz, partsInTz, todayKey } from "@orbit/domain"
import { metrics, type Logger, type Redis } from "@orbit/server-kit"
import { expireGraceKeys, indexUsage, reconcile, retention, runAutoPause, runHeartbeatMissing, runTransitions, syncAlerts, syncKeyLastUsed } from "./repo"

export type JobName = "minute" | "hourly" | "reconcile" | "indexstats"

export async function runJob(name: JobName, db: Db, redis: Redis, log: Logger) {
  const t0 = Date.now()
  try {
    let out: unknown
    if (name === "minute") {
      const transitions = await runTransitions(db)
      const autoPaused = await runAutoPause(db)
      const heartbeatMissing = await runHeartbeatMissing(db)
      const graceRevoked = await expireGraceKeys(db)
      const alerts = await syncAlerts(db)
      out = { transitions, autoPaused, heartbeatMissing, graceRevoked, alerts }
    } else if (name === "hourly") {
      out = { keysUpdated: await syncKeyLastUsed(db, redis) }
    } else if (name === "reconcile") {
      const r = await reconcile(db, redis)
      metrics.inc("reconcile_mismatches", {}, r.repaired.length)
      out = { reconcile: r, retention: await retention(db) }
    } else {
      const { rows, unavailable } = await indexUsage(db)
      out = { indexes: rows.length, flagged: rows.filter((r) => r.flagged), unavailable: unavailable.length ? { count: unavailable.length, first: unavailable[0] } : null }
    }
    metrics.inc("jobs_runs", { job: name, result: "ok" })
    metrics.observe("jobs_run_seconds", (Date.now() - t0) / 1000, { job: name })
    log.info({ job: name, ms: Date.now() - t0, out }, "job done")
    return out
  } catch (err) {
    metrics.inc("jobs_runs", { job: name, result: "error" })
    log.error({ err, job: name }, "job failed")
    throw err
  }
}

async function lock(redis: Redis, key: string, ms: number) {
  return (await redis.set(`jobs:lock:${key}`, String(process.pid), "PX", ms, "NX")) === "OK"
}

export function startJobs(db: Db, redis: Redis, log: Logger) {
  const timers: NodeJS.Timeout[] = []
  const guarded = (name: JobName, key: string, ms: number) => async () => {
    try {
      if (await lock(redis, key, ms)) await runJob(name, db, redis, log)
    } catch {
      /* logged in runJob */
    }
  }
  const minute = guarded("minute", "minute", 55_000)
  void minute()
  timers.push(setInterval(minute, 60_000))
  const hourly = () => guarded("hourly", `hourly:${new Date().toISOString().slice(0, 13)}`, 2 * 3600_000)()
  timers.push(setInterval(hourly, 5 * 60_000))
  void hourly()
  const nightly = async () => {
    if (hourInTz(Date.now()) !== 3) return
    const day = todayKey()
    await guarded("reconcile", `reconcile:${day}`, 26 * 3600_000)()
    if (partsInTz(Date.now(), "Asia/Dhaka").day === 1) await guarded("indexstats", `indexstats:${day}`, 26 * 3600_000)()
  }
  timers.push(setInterval(() => void nightly(), 5 * 60_000))
  log.info("jobs scheduler started")
  return { stop: async () => timers.forEach(clearInterval) }
}
