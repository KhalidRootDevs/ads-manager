/**
 * Orbit workers — one image, one role per process:
 *   node dist/index.js <compiler|aggregator|attribution|jobs|lake|all>
 *   node dist/index.js jobs --run <minute|hourly|reconcile|indexstats>   (one-off, then exit)
 * HTTP: GET /healthz, /readyz, /metrics on WORKERS_PORT.
 */
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { connect, dbConfigFromEnv } from "@orbit/db"
import { createApp, createLogger, createRedis, finalizeApp, serve } from "@orbit/server-kit"
import { startAggregator } from "./aggregator"
import { startAttribution } from "./attribution"
import { startCompiler } from "./compiler"
import { loadEnv } from "./env"
import { runJob, startJobs, type JobName } from "./jobs"
import { createKafka } from "./kafka"
import { localSink, s3Sink, startLake } from "./lake"

const ROLES = ["compiler", "aggregator", "attribution", "jobs", "lake", "all"] as const
type Role = (typeof ROLES)[number]

function repoRoot() {
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

async function main() {
  const args = process.argv.slice(2)
  const role = (args[0] ?? "all") as Role
  if (!ROLES.includes(role)) {
    console.error(`Unknown role "${role}". Use one of: ${ROLES.join(", ")}`)
    process.exit(2)
  }
  const env = loadEnv()
  const log = createLogger(`workers-${role}`, env.LOG_LEVEL)
  const db = await connect(dbConfigFromEnv("workers"))
  const redis = createRedis(env.REDIS_URL)

  const runIdx = args.indexOf("--run")
  if (role === "jobs" && runIdx > 0) {
    const job = args[runIdx + 1] as JobName
    try {
      const out = await runJob(job, db, redis, log)
      console.log(JSON.stringify(out, null, 2))
    } finally {
      await db.close()
      redis.disconnect()
    }
    return
  }

  const want = (r: Role) => role === "all" || role === r
  const stops: (() => Promise<unknown>)[] = []
  const ready: Record<string, boolean> = {}
  const kafka = createKafka(env.KAFKA_BROKERS, `orbit-workers-${role}`, log)

  if (want("compiler")) {
    const c = startCompiler(db, redis, log, { intervalMs: env.COMPILE_INTERVAL_MS, debounceMs: env.COMPILE_DEBOUNCE_MS })
    stops.push(c.stop)
    ready.compiler = true
  }
  const startConsumer = async (name: string, fn: () => Promise<{ stop(): Promise<unknown> }>) => {
    ready[name] = false
    for (let attempt = 1; ; attempt++) {
      try {
        const s = await fn()
        stops.push(s.stop)
        ready[name] = true
        return
      } catch (err) {
        log.error({ err: (err as Error).message, attempt }, `${name}: start failed, retrying`)
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1_000 * attempt)))
      }
    }
  }
  if (want("aggregator")) void startConsumer("aggregator", () => startAggregator(db, redis, kafka, log))
  if (want("attribution")) void startConsumer("attribution", () => startAttribution(db, kafka, log))
  if (want("lake")) {
    const sink = env.LAKE_DRIVER === "s3" ? await s3Sink(env.S3_BUCKET_LAKE) : localSink(env.LAKE_DIR ? resolve(env.LAKE_DIR) : join(repoRoot(), ".data", "lake"))
    void startConsumer("lake", () => startLake(kafka, sink, log))
  }
  if (want("jobs")) {
    const j = startJobs(db, redis, log)
    stops.push(j.stop)
    ready.jobs = true
  }

  const app = createApp({ name: "workers", log })
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, role })
  })
  app.get("/readyz", (_req, res) => {
    const ok = Object.values(ready).every(Boolean) && db.primary.readyState === 1
    res.status(ok ? 200 : 503).json({ ok, role, ready })
  })
  finalizeApp(app, log)
  await serve(app, {
    port: env.WORKERS_PORT,
    log,
    onShutdown: async () => {
      for (const s of stops.reverse()) await s().catch(() => {})
      await db.close()
      redis.disconnect()
    },
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
