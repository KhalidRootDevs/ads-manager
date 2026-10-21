import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { compareVersions, eligible, freqBucket, freqTtlSec, inSchedule, pick, type Candidate, type ServingIndex } from "../src"
import {
  generateKeySecret, hashKeySecret, hashUid, parseSecrets, signBody, signToken, truncateIp, verifyToken, CLICK_TOKEN_TTL_SEC, IMPRESSION_TOKEN_TTL_SEC, type TrackingPayload,
} from "../src/node"

const NOW = Date.parse("2026-10-19T08:00:00Z") // Mon 14:00 Dhaka
const cand = (over: Partial<Candidate> = {}): Candidate => ({
  campaignId: "c1", priority: 2, countries: ["BD", "IN"], startMs: NOW - 86_400_000, endMs: NOW + 86_400_000, tz: "Asia/Dhaka", days: [], hours: { from: 0, to: 24 },
  devices: [], minAppVersion: null, freqCap: null, pacing: "even", budgetMicros: 1, weight: 1, destinationOverride: null,
  creatives: [{ id: "cr1", format: "banner", size: "320x50", weight: 1, payload: { assets: {}, copy: { headline: "", body: "", cta: "" }, clickUrl: "", deepLink: null, altText: "", options: {} } }],
  ...over,
})
const index = (over: Partial<ServingIndex> = {}, candidates = [cand()]): ServingIndex => ({
  version: "v1", builtAt: "", ecpm: {}, killSwitch: false,
  properties: { p1: { id: "p1", platform: "android", identifier: "com.x", active: true, testMode: false, keys: [] } },
  placements: { pl1: { id: "pl1", propertyId: "p1", format: "banner", size: "320x50", active: true, minAppVersion: "6.0.0", refreshSec: null, candidates } },
  ...over,
})
const req = (over = {}) => ({ placementId: "pl1", propertyId: "p1", country: "BD", device: "phone" as const, appVersion: "6.2.1", test: false, now: NOW, ...over })

describe("compareVersions", () => {
  it("compares numerically", () => {
    expect(compareVersions("6.10.0", "6.9.9")).toBe(1)
    expect(compareVersions("6.2", "6.2.0")).toBe(0)
    expect(compareVersions("5.9.0", "6.0")).toBe(-1)
    expect(compareVersions("x.1", "0.1")).toBe(0)
  })
})

describe("inSchedule", () => {
  it("checks flight, weekday and hours in the campaign zone", () => {
    expect(inSchedule(cand(), NOW)).toBe(true)
    expect(inSchedule(cand({ startMs: NOW + 1 }), NOW)).toBe(false)
    expect(inSchedule(cand({ endMs: NOW }), NOW)).toBe(false)
    expect(inSchedule(cand({ days: ["tue"] }), NOW)).toBe(false)
    expect(inSchedule(cand({ days: ["mon"] }), NOW)).toBe(true)
    expect(inSchedule(cand({ hours: { from: 9, to: 14 } }), NOW)).toBe(false)
    expect(inSchedule(cand({ hours: { from: 14, to: 15 } }), NOW)).toBe(true)
    expect(inSchedule(cand({ tz: "UTC", hours: { from: 8, to: 9 } }), NOW)).toBe(true)
  })
})

describe("eligible", () => {
  it("returns candidates that pass every filter", () => {
    const r = eligible(index(), req())
    expect(r.ok && r.candidates.map((c) => c.campaignId)).toEqual(["c1"])
  })
  it("reports the first blocking reason", () => {
    expect(eligible(index({ killSwitch: true }), req())).toEqual({ ok: false, reason: "kill_switch" })
    expect(eligible(index(), req({ placementId: "nope" }))).toEqual({ ok: false, reason: "unknown_placement" })
    expect(eligible(index(), req({ propertyId: "p2" }))).toEqual({ ok: false, reason: "unknown_placement" })
    const paused = index()
    paused.properties.p1.active = false
    expect(eligible(paused, req())).toEqual({ ok: false, reason: "paused_property" })
    const plPaused = index()
    plPaused.placements.pl1.active = false
    expect(eligible(plPaused, req())).toEqual({ ok: false, reason: "paused_placement" })
    expect(eligible(index(), req({ appVersion: "5.0.0" }))).toEqual({ ok: false, reason: "app_version" })
    expect(eligible(index({}, []), req())).toEqual({ ok: false, reason: "no_candidates" })
    expect(eligible(index(), req({ country: "US" }))).toEqual({ ok: false, reason: "country" })
    expect(eligible(index({}, [cand({ days: ["sun"] })]), req())).toEqual({ ok: false, reason: "schedule" })
    expect(eligible(index({}, [cand({ devices: ["tablet"] })]), req())).toEqual({ ok: false, reason: "device" })
    expect(eligible(index({}, [cand({ minAppVersion: "7.0.0" })]), req())).toEqual({ ok: false, reason: "app_version" })
    expect(eligible(index(), req({ appVersion: null })).ok).toBe(true)
  })
})

describe("pick", () => {
  it("takes the highest priority tier, then weights", () => {
    const hi = cand({ campaignId: "hi", priority: 3 })
    const lo = cand({ campaignId: "lo", priority: 1, weight: 100 })
    expect(pick([lo, hi], () => 0.99)!.campaign.campaignId).toBe("hi")
    const a = cand({ campaignId: "a", weight: 1 })
    const b = cand({ campaignId: "b", weight: 3 })
    expect(pick([a, b], () => 0.2)!.campaign.campaignId).toBe("a")
    expect(pick([a, b], () => 0.3)!.campaign.campaignId).toBe("b")
    expect(pick([cand({ weight: 0 }), cand({ campaignId: "z", weight: 0 })], () => 0.9)!.campaign.campaignId).toBe("z")
  })
  it("returns null without candidates or creatives", () => {
    expect(pick([])).toBeNull()
    expect(pick([cand({ creatives: [] })])).toBeNull()
  })
})

describe("frequency buckets", () => {
  it("buckets per period in the campaign zone", () => {
    expect(freqBucket("hour", NOW, "Asia/Dhaka")).toBe("2026101914")
    expect(freqBucket("day", NOW, "Asia/Dhaka")).toBe("20261019")
    expect(freqBucket("day", Date.parse("2026-10-19T20:00:00Z"), "Asia/Dhaka")).toBe("20261020")
    const mon = freqBucket("week", Date.parse("2026-10-19T00:30:00Z"), "UTC")
    expect(freqBucket("week", Date.parse("2026-10-25T23:00:00Z"), "UTC")).toBe(mon) // Sunday, same week
    expect(freqBucket("week", Date.parse("2026-10-18T23:00:00Z"), "UTC")).not.toBe(mon) // previous Sunday
    expect(freqTtlSec("hour")).toBeGreaterThan(3600)
    expect(freqTtlSec("day")).toBeGreaterThan(86_400)
    expect(freqTtlSec("week")).toBeGreaterThan(7 * 86_400)
  })
})

describe("tracking tokens", () => {
  const ring = parseSecrets("k1:alpha, k2:beta", "k2")
  const payload: TrackingPayload = { r: "req_1", c: "c", cr: "cr", p: "p", pl: "pl", cc: "BD", dv: "ph", pf: "an", f: "banner", ts: 1_000_000, cpi: 1800 }
  it("parses keyrings", () => {
    expect(ring).toEqual({ active: "k2", secrets: { k1: "alpha", k2: "beta" } })
    expect(() => parseSecrets("k1:a", "k9")).toThrow(/k9/)
  })
  it("signs and verifies", () => {
    const t = signToken(payload, ring)
    expect(t.startsWith("k2.")).toBe(true)
    expect(verifyToken(t, ring, IMPRESSION_TOKEN_TTL_SEC, 1_000_100)).toEqual({ ok: true, payload })
    // old kid still verifies after rotation
    const old = signToken(payload, { ...ring, active: "k1" })
    expect(verifyToken(old, ring, CLICK_TOKEN_TTL_SEC, 1_000_100).ok).toBe(true)
  })
  it("rejects tampering, unknown kids, malformed and expired tokens", () => {
    const t = signToken(payload, ring)
    const [kid, body, sig] = t.split(".")
    const forged = Buffer.from(JSON.stringify({ ...payload, cpi: 1 })).toString("base64url")
    expect(verifyToken(`${kid}.${forged}.${sig}`, ring, 100, 1_000_001)).toEqual({ ok: false, error: "bad_signature" })
    expect(verifyToken(`${kid}.${body}.${sig.slice(0, -2)}`, ring, 100, 1_000_001)).toEqual({ ok: false, error: "bad_signature" })
    expect(verifyToken(`k9.${body}.${sig}`, ring, 100, 1_000_001)).toEqual({ ok: false, error: "unknown_kid" })
    expect(verifyToken("a.b", ring, 100)).toEqual({ ok: false, error: "malformed" })
    expect(verifyToken(t, ring, IMPRESSION_TOKEN_TTL_SEC, 1_000_000 + IMPRESSION_TOKEN_TTL_SEC + 1)).toEqual({ ok: false, error: "expired" })
    const notJson = Buffer.from("nope").toString("base64url")
    const signed = signToken(payload, ring).split(".")
    // a validly signed non-JSON body is malformed
    const mac = createHmac("sha256", "beta").update(`k2.${notJson}`).digest("base64url")
    expect(signed).toHaveLength(3)
    expect(verifyToken(`k2.${notJson}.${mac}`, ring, 100)).toEqual({ ok: false, error: "malformed" })
  })
})

describe("keys and privacy helpers", () => {
  it("generates high-entropy key secrets", () => {
    const a = generateKeySecret("live")
    const b = generateKeySecret("test")
    expect(a.secret).toMatch(/^ok_live_[0-9A-Za-z]{32}$/)
    expect(b.prefix).toBe("ok_test_")
    expect(a.last4).toBe(a.secret.slice(-4))
    expect(generateKeySecret("live").secret).not.toBe(a.secret)
  })
  it("hashes with the pepper", () => {
    expect(hashKeySecret("s", "p")).toMatch(/^[0-9a-f]{64}$/)
    expect(hashKeySecret("s", "p")).toBe(hashKeySecret("s", "p"))
    expect(hashKeySecret("s", "p")).not.toBe(hashKeySecret("s", "q"))
    expect(hashUid("uid", "p")).toHaveLength(22)
    expect(signBody("{}", "sec", 100)).toMatch(/^t=100,v1=[0-9a-f]{64}$/)
  })
  it("truncates IPs", () => {
    expect(truncateIp("203.0.113.77")).toBe("203.0.113.0/24")
    expect(truncateIp("::ffff:10.1.2.3")).toBe("10.1.2.0/24")
    expect(truncateIp("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48")
  })
})
