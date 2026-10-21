import { describe, expect, it } from "vitest"
import { campaignHealth, deriveAlerts, type HealthCtx } from "../src"

const sdk = (state: "healthy" | "degraded" | "heartbeat_missing" | "not_integrated") => ({ state, version: "6.2.1", lastHeartbeatAt: null })
const ctx = (): HealthCtx => ({
  properties: {
    p1: { id: "p1", name: "App", status: "active", countryRule: { mode: "include", countries: ["BD"] }, sdk: sdk("healthy") },
    p2: { id: "p2", name: "Other", status: "paused", countryRule: { mode: "all", countries: [] }, sdk: sdk("heartbeat_missing") },
  },
  placements: {
    pl1: { id: "pl1", propertyId: "p1", format: "banner", size: "320x50", status: "active" },
    pl2: { id: "pl2", propertyId: "p2", format: "interstitial", size: "fullscreen", status: "active" },
    pl3: { id: "pl3", propertyId: "p1", format: "banner", size: "320x50", status: "paused" },
  },
  creatives: {
    ok: { id: "ok", name: "Good", format: "banner", size: "320x50", status: "ready" },
    rej: { id: "rej", name: "Bad", format: "banner", size: "320x50", status: "rejected" },
    rev: { id: "rev", name: "Pending", format: "banner", size: "320x50", status: "in_review" },
  },
  countries: [{ code: "BD", name: "Bangladesh", enabled: true }, { code: "IN", name: "India", enabled: true }],
})
const budget = { amountMicros: 1000, pacing: "even" as const, goal: null }

describe("campaignHealth", () => {
  it("is empty for a healthy campaign", () => {
    expect(campaignHealth({ creativeIds: ["ok"], targets: [{ propertyId: "p1", countryRule: { mode: "include", countries: ["BD"] }, placementIds: ["pl1"], allocationPct: null, destinationOverride: null }], budget }, ctx())).toEqual([])
  })
  it("finds every issue kind", () => {
    const issues = campaignHealth(
      {
        creativeIds: ["ok", "rej", "rev", "missing"],
        targets: [
          { propertyId: "p1", countryRule: { mode: "include", countries: ["BD", "IN"] }, placementIds: ["pl3"], allocationPct: null, destinationOverride: null },
          { propertyId: "p2", countryRule: { mode: "all", countries: [] }, placementIds: ["pl2"], allocationPct: null, destinationOverride: null },
          { propertyId: "gone", countryRule: { mode: "all", countries: [] }, placementIds: [], allocationPct: null, destinationOverride: null },
        ],
        budget,
      },
      ctx(),
      1000,
    )
    expect(issues.map((i) => i.code)).toEqual(["creative_rejected", "creative_not_ready", "country_conflict", "no_compatible_placement", "property_paused", "sdk_heartbeat_missing", "no_compatible_placement", "budget_exhausted"])
    expect(issues[1].message).toBe("Pending is in review.")
    expect(issues[2]).toMatchObject({ propertyId: "p1", country: "IN" })
    expect(issues[2].message).toContain("outside the property’s country defaults")
  })
})

describe("deriveAlerts", () => {
  it("opens alerts for active campaigns and unhealthy properties", () => {
    const c = ctx()
    const creatives = {
      ok: { id: "ok", name: "Good", status: "ready" as const, review: { state: "approved" as const, by: null, at: null, reason: null } },
      rej: { id: "rej", name: "Bad", status: "rejected" as const, review: { state: "rejected" as const, by: null, at: null, reason: "Too long." } },
      rev: { id: "rev", name: "Pending", status: "in_review" as const, review: { state: "pending" as const, by: null, at: null, reason: null } },
    }
    const target = { propertyId: "p1", countryRule: { mode: "include" as const, countries: ["IN"] }, placementIds: [], allocationPct: null, destinationOverride: null }
    const out = deriveAlerts({
      campaigns: [
        { id: "c1", name: "Live", status: "active", creativeIds: ["ok", "rej", "rev", "missing"], targets: [target] },
        { id: "c2", name: "Paused", status: "paused", creativeIds: ["rej"], targets: [target] },
      ],
      creatives,
      properties: { ...c.properties, p3: { id: "p3", name: "Slow", countryRule: { mode: "all", countries: [] }, sdk: sdk("degraded") } },
      countries: c.countries,
      degraded: new Set(["p1"]),
    })
    expect(out.map((a) => a.dedupeKey)).toEqual(["creative_rejected:rej:c1", "not_delivering:c1:rev", "country_conflict:c1:p1:IN", "sdk_degraded:p1", "sdk_heartbeat_missing:p2", "sdk_degraded:p3"])
    expect(out[0]).toMatchObject({ severity: "critical", message: "Too long. It is used by “Live”, so delivery stopped.", href: "/creatives/rej" })
    expect(out[2].severity).toBe("warning")
    expect(out[5].message).toBe("Request timeouts on SDK 6.2.1. Upgrading the SDK usually fixes this.")
  })
})
