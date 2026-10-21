/**
 * The ad decision (§4.2) around the pure domain functions: auth → context → eligible() → frequency caps and
 * pacing (one pipelined Redis MGET) → pick() → signed tracking URLs. Redis problems never fail a request:
 * caps are skipped and even pacing becomes probabilistic (§10 degraded mode).
 */
import {
  DEVICE_CODE, eligible, findKey, freqBucket, freqTtlSec, hourlyAllowanceMicros, isVideoFormat, newId, originAllowed, pick, PLATFORM_CODE,
  REDIS_KEYS, spendHourBucket, supplyResultLabel, type Candidate, type Device, type NoFillReason, type ServeRequest, type ServeResponse,
  type ServingKey, type ServingProperty, type StreamEvent,
} from "@orbit/domain"
import { hashKeySecret, hashUid, signToken, type TrackingPayload, type TrackingSecrets } from "@orbit/domain/node"
import { metrics, type Redis } from "@orbit/server-kit"
import type { IndexStore, PreparedIndex } from "./index-store"
import type { EventSink } from "./producer"

export interface DecisionConfig {
  trackingUrl: string
  ring: TrackingSecrets
  keyPepper: string
  uidPepper: string
  sampleRate: number
  degradedPacingFactor: number
  allowLocalOrigins: boolean
  /** max time to wait for Redis on the hot path */
  redisTimeoutMs: number
}

export interface Deps {
  store: IndexStore
  redis: Redis
  sink: EventSink
  cfg: DecisionConfig
  rnd?: () => number
}

export type AuthResult = { ok: true; prop: ServingProperty; key: ServingKey | null; testKey: boolean } | { ok: false; status: 401 | 403; code: string }

// ---------- authentication ----------
const hashCache = new Map<string, string>()
const keyUsedAt = new Map<string, number>()
const KEY_USED_EVERY_MS = 3_600_000

function hashOf(secret: string, pepper: string) {
  let h = hashCache.get(secret)
  if (!h) {
    h = hashKeySecret(secret, pepper)
    if (hashCache.size > 10_000) hashCache.clear()
    hashCache.set(secret, h)
  }
  return h
}

/** Record SDK key usage at most hourly per process (jobs copy it into property_keys.lastUsedAt). */
export function touchKey(redis: Redis, key: ServingKey | null, now: number) {
  if (!key?.id) return
  const last = keyUsedAt.get(key.id) ?? 0
  if (now - last < KEY_USED_EVERY_MS) return
  keyUsedAt.set(key.id, now)
  redis.set(REDIS_KEYS.keyUsed(key.id), String(now), "EX", 7_200).catch(() => keyUsedAt.delete(key.id!))
}

export function authenticate(p: PreparedIndex, appId: string | undefined, secret: string | undefined, origin: string | undefined, cfg: Pick<DecisionConfig, "keyPepper" | "allowLocalOrigins">, now: number): AuthResult {
  const prop = appId ? p.index.properties[appId] : undefined
  if (!prop) return { ok: false, status: 401, code: "unknown_app" }
  if (secret) {
    const key = findKey(prop, hashOf(secret, cfg.keyPepper), now)
    if (!key) return { ok: false, status: 401, code: "invalid_key" }
    return { ok: true, prop, key, testKey: key.env === "test" }
  }
  if (prop.platform === "web") {
    if (originAllowed(prop.identifier, origin, cfg.allowLocalOrigins)) return { ok: true, prop, key: null, testKey: false }
    return { ok: false, status: 403, code: "origin_not_allowed" }
  }
  return { ok: false, status: 401, code: "missing_key" }
}

/** Preflight check: does the origin belong to any web property (or localhost in development)? */
export function anyWebOrigin(p: PreparedIndex | null, origin: string | undefined, allowLocal: boolean) {
  if (!origin) return false
  if (allowLocal && originAllowed("localhost", origin, true)) return true
  return !!p?.webIds.some((id) => originAllowed(id, origin, false))
}

// ---------- decision ----------
export interface DecideInput {
  prop: ServingProperty
  req: ServeRequest
  country: string
  test: boolean
  now: number
}

export type DecideResult = { filled: true; response: ServeResponse; candidate: Candidate; uidHash: string | null } | { filled: false; reason: NoFillReason; placementName: string | null }

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("redis timeout")), ms)
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)))
  })
}

function hasConsent(r: ServeRequest) {
  if (!r.uid) return false
  const c = r.consent
  if (c?.personalised === false) return false
  if (c?.att && ["denied", "restricted"].includes(c.att.toLowerCase())) return false
  if (c?.gdpr === true && !c.tcf) return false
  return true
}

export async function decide(d: Deps, x: DecideInput): Promise<DecideResult> {
  const p = d.store.current!
  const device = x.req.device.type as Device
  const el = eligible(p.index, { placementId: x.req.placementId, propertyId: x.prop.id, country: x.country, device, appVersion: x.req.device.appVersion ?? null, test: x.test, now: x.now })
  const pl = p.index.placements[x.req.placementId]
  if (!el.ok) return { filled: false, reason: el.reason, placementName: pl?.name ?? null }

  const uidHash = hasConsent(x.req) ? hashUid(x.req.uid!, d.cfg.uidPepper) : null
  const hb = spendHourBucket(x.now)
  // one MGET: [freq per capped candidate] + [spend, spendHour] per candidate
  const keys: string[] = []
  const freqIdx = new Map<Candidate, number>()
  for (const c of el.candidates) {
    if (uidHash && c.freqCap) {
      freqIdx.set(c, keys.length)
      keys.push(REDIS_KEYS.freq(uidHash, c.campaignId, freqBucket(c.freqCap.per, x.now, c.tz)))
    }
  }
  const spendBase = keys.length
  for (const c of el.candidates) keys.push(REDIS_KEYS.spend(c.campaignId), REDIS_KEYS.spendHour(c.campaignId, hb))

  let vals: (string | null)[] | null = null
  if (d.redis.status === "ready") {
    try {
      vals = await withTimeout(d.redis.mget(...keys), d.cfg.redisTimeoutMs)
    } catch {
      vals = null
    }
  }
  if (!vals) metrics.inc("serve_degraded", { reason: "redis" })

  const rnd = d.rnd ?? Math.random
  let reason: NoFillReason = "no_candidates"
  const ok: Candidate[] = []
  el.candidates.forEach((c, i) => {
    if (vals) {
      const fi = freqIdx.get(c)
      if (fi != null && Number(vals[fi] ?? 0) >= c.freqCap!.count) return void (reason = "capped")
      const spent = Number(vals[spendBase + i * 2] ?? 0)
      const hour = Number(vals[spendBase + i * 2 + 1] ?? 0)
      if (c.budgetMicros > 0 && spent >= c.budgetMicros) return void (reason = "paced")
      if (c.pacing === "even" && c.budgetMicros > 0) {
        const remainingAtHourStart = Math.max(0, c.budgetMicros - (spent - hour))
        const allowance = hourlyAllowanceMicros(remainingAtHourStart, p.endKey.get(c)!, c.tz, x.now)
        if (hour >= allowance) return void (reason = "paced")
      }
    } else if (c.pacing === "even" && rnd() > d.cfg.degradedPacingFactor) {
      return void (reason = "paced") // conservative pacing without spend data
    }
    ok.push(c)
  })
  const chosen = pick(ok, rnd)
  if (!chosen) return { filled: false, reason, placementName: el.placement.name ?? null }

  const { campaign, creative } = chosen
  const requestId = newId("request")
  const ts = Math.floor(x.now / 1000)
  const base: TrackingPayload = {
    r: requestId, c: campaign.campaignId, cr: creative.id, p: x.prop.id, pl: el.placement.id, cc: x.country, dv: DEVICE_CODE[device],
    pf: PLATFORM_CODE[x.prop.platform], f: el.placement.format, ts, cpi: Math.round((p.index.ecpm[el.placement.format] ?? 0) * 1000),
    ...(uidHash ? { u: uidHash } : {}), ...(x.test ? { t: 1 as const } : {}),
  }
  const tok = signToken(base, d.cfg.ring)
  const dest = creative.payload.clickUrl || creative.payload.deepLink || ""
  const clickTok = signToken({ ...base, d: dest }, d.cfg.ring)
  const t = d.cfg.trackingUrl
  const video = isVideoFormat(creative.format) || creative.payload.options?.media === "video"
  const response: ServeResponse = {
    requestId,
    ad: {
      creativeId: creative.id, campaignId: campaign.campaignId, format: creative.format, size: creative.size,
      assets: creative.payload.assets, copy: creative.payload.copy, altText: creative.payload.altText, options: creative.payload.options,
      click: { url: `${t}/c/${clickTok}`, deepLink: creative.payload.deepLink },
      tracking: {
        impression: `${t}/t/imp/${tok}`, viewable: `${t}/t/view/${tok}`,
        video: video ? { start: `${t}/t/vs/${tok}`, complete: `${t}/t/vc/${tok}` } : null,
        reward: creative.format === "rewarded_video" ? `${t}/t/rw/${tok}` : null,
      },
      ttlSec: 300, refreshSec: el.placement.refreshSec, test: x.test,
    },
  }
  // fire-and-forget frequency counter
  if (uidHash && campaign.freqCap && vals) {
    const k = REDIS_KEYS.freq(uidHash, campaign.campaignId, freqBucket(campaign.freqCap.per, x.now, campaign.tz))
    d.redis.multi().incr(k).expire(k, freqTtlSec(campaign.freqCap.per)).exec().catch(() => {})
  }
  return { filled: true, response, candidate: campaign, uidHash }
}

/** Supply event for every request (sampled into request_samples by REQUEST_SAMPLE_RATE; test requests always). */
export function supplyEvent(d: Deps, x: { requestId: string; prop: ServingProperty; placementId: string; country: string; device: Device; result: "filled" | "no_fill" | "error"; reason: string | null; latencyMs: number; sdk: string | null; test: boolean; now: number }): StreamEvent {
  const sampled = x.test || (d.rnd ?? Math.random)() < d.cfg.sampleRate
  return {
    k: "supply", id: x.requestId, at: x.now, r: x.requestId, p: x.prop.id, pl: x.placementId, cc: x.country, dv: DEVICE_CODE[x.device], pf: PLATFORM_CODE[x.prop.platform],
    result: x.result, reason: x.reason, latencyMs: Math.round(x.latencyMs * 100) / 100, sdk: x.sdk,
    ...(x.test ? { t: 1 as const } : {}), ...(sampled ? { sample: 1 as const } : {}),
  }
}

export { supplyResultLabel }
