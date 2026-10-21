/**
 * Integration harness: in-memory MongoDB replica set (transactions) with the real migrations, local Redis
 * (DB 15, unique key prefix per test file), and `buildApp()` driven through Supertest.
 */
import { randomUUID } from "node:crypto"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connect, runMigrations, type Db } from "@orbit/db"
import { newId, type Role } from "@orbit/domain"
import { createLogger, createRedis, type Redis } from "@orbit/server-kit"
import type { Express } from "express"
import { MongoMemoryReplSet } from "mongodb-memory-server"
import request from "supertest"
import { buildApp } from "../src/app"
import { envFrom, type Env } from "../src/env"

export const ORIGIN = "http://localhost:3000"
export const ROLES: Role[] = ["owner", "admin", "campaign_manager", "analyst", "developer", "read_only"]

export interface Harness {
  app: Express
  db: Db
  redis: Redis
  env: Env
  users: Record<Role, { id: string; email: string }>
  /** Signed-in agents per role (cookie jar + Origin header). */
  as: Record<Role, ReturnType<typeof request.agent>>
  setFetch(f: typeof fetch): void
  close(): Promise<void>
}

const COUNTRIES = [
  { _id: "BD", name: "Bangladesh", region: "South Asia", enabled: true },
  { _id: "IN", name: "India", region: "South Asia", enabled: true },
  { _id: "PK", name: "Pakistan", region: "South Asia", enabled: true },
  { _id: "NP", name: "Nepal", region: "South Asia", enabled: true },
  { _id: "AE", name: "United Arab Emirates", region: "Middle East", enabled: true },
  { _id: "US", name: "United States", region: "North America", enabled: true },
  { _id: "JP", name: "Japan", region: "East Asia", enabled: false },
]

export async function harness(extraEnv: Record<string, string> = {}): Promise<Harness> {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } })
  const db = await connect({ uri: rs.getUri(), dbName: "orbit_test", service: "test", analyticsReadPreference: "primary" })
  await runMigrations(db, () => {})
  const redis = createRedis("redis://localhost:6379/15")
  const env = envFrom({
    NODE_ENV: "test", LOG_LEVEL: "warn", MONGODB_URI: rs.getUri(), MONGODB_DB: "orbit_test", MONGODB_ANALYTICS_READ_PREF: "primary",
    SESSION_SECRET: "test-session-secret-0123456789abcdef0123", KEY_PEPPER: "test-key-pepper-0123456789abcdef0123456",
    WEB_ORIGIN: ORIGIN, API_URL: "http://localhost:4000", AD_SERVER_URL: "http://ad-server.test", INTERNAL_TOKEN: "test-internal-token-0123",
    AUTH_DEV_LOGIN: "true", STORAGE_DRIVER: "local", CDN_BASE_URL: "http://localhost:4000/media", UPLOAD_DIR: mkdtempSync(join(tmpdir(), "orbit-uploads-")),
    REDIS_PREFIX: `test:${randomUUID()}:`, RATE_LIMIT_LOGIN_PER_MIN: "1000", RATE_LIMIT_ANALYTICS_PER_MIN: "1000", ...extraEnv,
  })
  let fetchImpl: typeof fetch = async () => {
    throw new Error("ad server not reachable (test)")
  }
  const log = createLogger("api-test", "silent")
  const app = await buildApp({ env, db, redis, log, fetch: ((...a: Parameters<typeof fetch>) => fetchImpl(...a)) as typeof fetch, now: () => new Date() })

  await db.models.Country.insertMany(COUNTRIES)
  const users = {} as Harness["users"]
  for (const role of ROLES) {
    const id = newId("user")
    const email = `${role.replace("_", ".")}@orbit.test`
    await db.models.User.create({ _id: id, email, name: role.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "), role, status: "active" })
    users[role] = { id, email }
  }
  const as = {} as Harness["as"]
  for (const role of ROLES) {
    const agent = request.agent(app)
    const res = await agent.post("/v1/auth/dev-login").set("Origin", ORIGIN).send({ email: users[role].email })
    if (res.status !== 200) throw new Error(`dev-login failed for ${role}: ${res.status} ${JSON.stringify(res.body)}`)
    as[role] = agent
  }
  return {
    app, db, redis, env, users, as,
    setFetch: (f) => {
      fetchImpl = f
    },
    async close() {
      const keys = await redis.keys(`${env.REDIS_PREFIX}*`)
      if (keys.length) await redis.del(...keys)
      await redis.quit()
      await db.close()
      await rs.stop()
    },
  }
}

// ---------- fixture payloads ----------
let seq = 0
export const uniq = (s: string) => `${s} ${++seq}-${Math.random().toString(36).slice(2, 6)}`

export const propertyBody = (over: Record<string, unknown> = {}) => ({
  name: uniq("DRM Sport Android"), platform: "android", identifier: `com.drm.app${++seq}${Math.random().toString(36).slice(2, 6)}`, team: "Sports",
  formats: ["banner", "interstitial", "native"], countryRule: { mode: "include", countries: ["BD", "IN", "PK"] }, ...over,
})

export const bannerCreative = (over: Record<string, unknown> = {}) => ({
  name: uniq("World Cup Banner"), format: "banner", size: "320x50",
  assets: [{ kind: "image", url: "https://cdn.example.com/a.png", name: "a.png", mime: "image/png", bytes: 1000, width: 320, height: 50, durationSec: null, sha256: null }],
  copy: { headline: "Every goal in 60 seconds", body: "", cta: "Watch" }, destination: { url: "https://example.com/wc", deepLink: null, utm: { source: "orbit", medium: "banner", campaign: "wc" } },
  altText: "World cup highlights", ...over,
})

export const campaignBody = (o: { propertyId: string; placementId: string; creativeId: string; name?: string; start?: string; end?: string }) => ({
  name: o.name ?? uniq("World Cup Highlights"), objective: "awareness", team: "Sports",
  flight: { start: o.start ?? "2026-01-01", end: o.end ?? "2027-12-31", tz: "Asia/Dhaka" }, priority: 2, creativeIds: [o.creativeId],
  targets: [{ propertyId: o.propertyId, countryRule: { mode: "include", countries: ["BD", "IN"] }, placementIds: [o.placementId], allocationPct: null, destinationOverride: null }],
  constraints: { days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], hours: { from: 0, to: 24 }, devices: ["phone", "tablet"], minAppVersion: null, freqCap: { count: 4, per: "day" }, audienceIds: [] },
  budget: { amountMicros: 6_000_000_000, pacing: "even", goal: { type: "impressions", value: 3_500_000 } },
})

/** Property + banner placement + ready creative, created through the API as the owner. */
export async function inventory(h: Harness) {
  const prop = await h.as.owner.post("/v1/properties").set("Origin", ORIGIN).send(propertyBody())
  if (prop.status !== 201) throw new Error(`property: ${prop.status} ${JSON.stringify(prop.body)}`)
  const propertyId = prop.body.property.id as string
  const pl = await h.as.owner.post("/v1/placements").set("Origin", ORIGIN).send({ propertyId, name: uniq("Home Banner"), format: "banner", size: "320x50" })
  if (pl.status !== 201) throw new Error(`placement: ${pl.status} ${JSON.stringify(pl.body)}`)
  const cr = await h.as.owner.post("/v1/creatives").set("Origin", ORIGIN).send({ ...bannerCreative(), intent: "submit" })
  if (cr.status !== 201) throw new Error(`creative: ${cr.status} ${JSON.stringify(cr.body)}`)
  return { propertyId, placementId: pl.body.id as string, creativeId: cr.body.id as string, property: prop.body.property, testKey: prop.body.testKey }
}
