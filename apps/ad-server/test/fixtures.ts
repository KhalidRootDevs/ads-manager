import { randomBytes } from "node:crypto"
import { gzipSync } from "node:zlib"
import { SERVING, type Candidate, type ServingIndex } from "@orbit/domain"
import { hashKeySecret, parseSecrets } from "@orbit/domain/node"
import { createLogger, createRedis, type Redis } from "@orbit/server-kit"
import type { DecisionConfig } from "../src/decision"

export const PEPPER = "test-key-pepper-0123456789"
export const LIVE = "ok_live_LIVEKEY000000000000000000000000000"
export const TEST = "ok_test_TESTKEY000000000000000000000000000"
export const GRACE = "ok_live_GRACEKEY00000000000000000000000000"
export const EXPIRED = "ok_live_EXPIREDGRACE000000000000000000000"
export const ring = parseSecrets("k1:test-tracking-secret-0123456789", "k1")
export const log = createLogger("test", "silent")

export const cfg: DecisionConfig = {
  trackingUrl: "http://t.test", ring, keyPepper: PEPPER, uidPepper: "uid-pepper-0123456789abc", sampleRate: 0, degradedPacingFactor: 0.5, allowLocalOrigins: true, redisTimeoutMs: 50,
}

export const APP = "prp_01K00000000000000000000APP"
export const WEB = "prp_01K00000000000000000000WEB"
export const PL = "plc_01K000000000000000000BANNR"
export const PL_PAUSED = "plc_01K000000000000000000PAUSD"
export const PL_WEB = "plc_01K000000000000000000WEBDS"
export const CMP = "cmp_01K000000000000000000000C1"
export const CMP_LOW = "cmp_01K000000000000000000000C2"

export function candidate(o: Partial<Candidate> = {}): Candidate {
  const now = Date.now()
  return {
    campaignId: CMP, priority: 2, countries: ["BD", "IN"], startMs: now - 86_400_000, endMs: now + 10 * 86_400_000, tz: "Asia/Dhaka", days: [], hours: { from: 0, to: 24 },
    devices: [], minAppVersion: null, freqCap: { count: 3, per: "day" }, pacing: "asap", budgetMicros: 100_000_000, weight: 1, destinationOverride: null,
    creatives: [{ id: "crv_01K000000000000000000000R1", format: "banner", size: "320x50", weight: 1, payload: { assets: { image: "https://cdn.test/a.png" }, copy: { headline: "H", body: "", cta: "Go" }, clickUrl: "https://example.com/land?utm_source=orbit", deepLink: null, altText: "alt", options: {} } }],
    ...o,
  }
}

export function fixtureIndex(cands: Candidate[] = [candidate()], version = `v-${randomBytes(3).toString("hex")}`): ServingIndex {
  const now = Date.now()
  return {
    version, builtAt: new Date().toISOString(), killSwitch: false, ecpm: { banner: 1.8, web_display: 2.2 },
    properties: {
      [APP]: { id: APP, platform: "android", identifier: "com.test.app", active: true, testMode: false, keys: [
        { id: "key_01K00000000000000000000LIV", hash: hashKeySecret(LIVE, PEPPER), env: "live", status: "active", graceUntil: null },
        { id: "key_01K00000000000000000000TST", hash: hashKeySecret(TEST, PEPPER), env: "test", status: "active", graceUntil: null },
        { id: "key_01K00000000000000000000GRC", hash: hashKeySecret(GRACE, PEPPER), env: "live", status: "grace", graceUntil: now + 3600_000 },
        { id: "key_01K00000000000000000000EXP", hash: hashKeySecret(EXPIRED, PEPPER), env: "live", status: "grace", graceUntil: now - 1000 },
      ] },
      [WEB]: { id: WEB, platform: "web", identifier: "example.com", active: true, testMode: false, keys: [] },
    },
    placements: {
      [PL]: { id: PL, name: "Home banner", propertyId: APP, format: "banner", size: "320x50", active: true, minAppVersion: null, refreshSec: 60, candidates: cands },
      [PL_PAUSED]: { id: PL_PAUSED, name: "Paused", propertyId: APP, format: "banner", size: "320x50", active: false, minAppVersion: null, refreshSec: null, candidates: cands },
      [PL_WEB]: { id: PL_WEB, name: "Sidebar", propertyId: WEB, format: "web_display", size: "300x250", active: true, minAppVersion: null, refreshSec: null,
        candidates: [candidate({ creatives: [{ ...candidate().creatives[0], format: "web_display", size: "300x250" }] })] },
    },
  }
}

export function testRedis(): Redis {
  return createRedis("redis://localhost:6379/15", { keyPrefix: `as${randomBytes(4).toString("hex")}:` })
}

export async function publish(redis: Redis, index: ServingIndex) {
  await redis.set(SERVING.index(index.version), gzipSync(JSON.stringify(index)))
  await redis.set(SERVING.current, index.version)
}

export async function clean(redis: Redis) {
  const keys = await redis.keys("*")
  const prefix = redis.options.keyPrefix ?? ""
  const raw = createRedis("redis://localhost:6379/15")
  if (keys.length) await raw.del(...keys.filter((k) => k.startsWith(prefix)))
  raw.disconnect()
}
