import { describe, expect, it } from "vitest"
import {
  CAMPAIGN_STEPS, dayStart, hourlyAllowanceMicros, needsAttention, pacing, PACING_LABEL_TEXT, publishedStatus, teamBudgetLeft, validateCampaign,
  type CampaignInput, type ValidationCtx,
} from "../src"

const TODAY = "2026-10-19"
const ctx = (over: Partial<ValidationCtx> = {}): ValidationCtx => ({
  otherNames: ["Existing Campaign"],
  properties: {
    p1: { id: "p1", name: "App", platform: "android", countryRule: { mode: "all", countries: [] }, status: "active", sdk: { state: "healthy", version: "6.2.1", lastHeartbeatAt: null } },
    w1: { id: "w1", name: "Site", platform: "web", countryRule: { mode: "include", countries: ["BD"] }, status: "active", sdk: { state: "healthy", version: "2.4.0", lastHeartbeatAt: null } },
  },
  placements: {
    pl1: { id: "pl1", propertyId: "p1", format: "banner", size: "320x50", status: "active" },
    pl2: { id: "pl2", propertyId: "p1", format: "interstitial", size: "fullscreen", status: "active" },
    pl3: { id: "pl3", propertyId: "w1", format: "web_display", size: "300x250", status: "active" },
  },
  creatives: {
    cr1: { id: "cr1", name: "Banner", format: "banner", size: "320x50", status: "ready" },
    cr2: { id: "cr2", name: "Draft one", format: "banner", size: "320x50", status: "in_review" },
  },
  countries: [{ code: "BD", name: "Bangladesh", enabled: true }, { code: "IN", name: "India", enabled: true }],
  teamLeftMicros: null,
  today: TODAY,
  ...over,
})
const input = (over: Partial<CampaignInput> = {}): CampaignInput => ({
  name: "World Cup", objective: "awareness", team: "Sports", flight: { start: "2026-10-20", end: "2026-11-30", tz: "Asia/Dhaka" }, priority: 2, creativeIds: ["cr1"],
  targets: [{ propertyId: "p1", countryRule: { mode: "all", countries: [] }, placementIds: ["pl1"], allocationPct: null, destinationOverride: null }],
  constraints: { days: ["mon", "tue"], hours: { from: 0, to: 24 }, devices: ["phone"], minAppVersion: null, freqCap: null, audienceIds: [] },
  budget: { amountMicros: 1_000_000_000, pacing: "even", goal: null },
  ...over,
})
const issues = (r: { errors: { step: number; key: string | null }[] }) => r.errors.map((e) => `${e.step}:${e.key}`)
const warns = (r: { warnings: { step: number; message: string }[] }) => r.warnings.map((w) => w.step)

describe("validateCampaign", () => {
  it("accepts a complete campaign", () => expect(validateCampaign(input(), ctx())).toEqual({ errors: [], warnings: [] }))
  it("has eight steps", () => expect(CAMPAIGN_STEPS).toHaveLength(8))

  it("step 1: name and flight", () => {
    expect(issues(validateCampaign(input({ name: " ab " }), ctx()))).toEqual(["1:name"])
    expect(issues(validateCampaign(input({ name: "existing campaign" }), ctx()))).toEqual(["1:name"])
    expect(issues(validateCampaign(input({ flight: { start: "2026-10-20", end: "2026-10-01", tz: "UTC" } }), ctx()))).toEqual(["1:end"])
    expect(issues(validateCampaign(input({ flight: { start: "2026-09-01", end: "2026-10-01", tz: "UTC" } }), ctx()))).toEqual(["1:end"])
    expect(issues(validateCampaign(input({ flight: { start: "", end: "", tz: "UTC" } }), ctx()))).toEqual(["1:start", "1:end"])
  })
  it("step 2: creatives", () => {
    expect(issues(validateCampaign(input({ creativeIds: [] }), ctx()))).toEqual(["2:creatives"])
    expect(issues(validateCampaign(input({ creativeIds: ["nope"] }), ctx()))).toEqual(["2:creatives"])
    const r = validateCampaign(input({ creativeIds: ["cr1", "cr2"] }), ctx())
    expect(r.errors).toEqual([])
    expect(r.warnings[0]).toMatchObject({ step: 2, key: "cr2", message: "Draft one is in review; it won’t serve until it is ready." })
  })
  it("step 3: properties", () => {
    expect(issues(validateCampaign(input({ targets: [] }), ctx()))).toEqual(["3:props"])
    expect(issues(validateCampaign(input({ targets: [{ ...input().targets[0], propertyId: "gone" }] }), ctx()))).toEqual(["3:gone"])
    const c = ctx()
    c.properties.p1 = { ...c.properties.p1, status: "paused", sdk: { state: "heartbeat_missing", version: null, lastHeartbeatAt: null } }
    expect(warns(validateCampaign(input(), c))).toEqual([3, 3])
    c.properties.p1 = { ...c.properties.p1, status: "active", sdk: { state: "not_integrated", version: null, lastHeartbeatAt: null } }
    expect(validateCampaign(input(), c).warnings[0].message).toContain("no SDK integration")
  })
  it("step 4: countries", () => {
    const t = input().targets[0]
    expect(issues(validateCampaign(input({ targets: [{ ...t, countryRule: { mode: "include", countries: [] } }] }), ctx()))).toEqual(["4:p1"])
    expect(warns(validateCampaign(input({ targets: [{ ...t, countryRule: { mode: "exclude", countries: [] } }] }), ctx()))).toEqual([4])
    const r = validateCampaign(input({ creativeIds: ["cr1"], targets: [{ propertyId: "w1", countryRule: { mode: "include", countries: ["BD", "IN"] }, placementIds: ["pl3"], allocationPct: null, destinationOverride: null }] }), ctx({ creatives: { cr1: { id: "cr1", name: "D", format: "web_display", size: "300x250", status: "ready" } } }))
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([{ step: 4, key: null, message: "Site: India won’t serve (not in the property’s country defaults)." }])
  })
  it("step 5: placements", () => {
    const t = input().targets[0]
    expect(issues(validateCampaign(input({ targets: [{ ...t, placementIds: [] }] }), ctx()))).toEqual(["5:p1"])
    expect(issues(validateCampaign(input({ targets: [{ ...t, placementIds: ["pl3"] }] }), ctx()))).toEqual(["5:p1"])
    expect(validateCampaign(input({ targets: [{ ...t, placementIds: ["pl2"] }] }), ctx()).errors[0].message).toBe("App: no selected creative fits one of the chosen placements.")
  })
  it("step 6: constraints and destination overrides", () => {
    const k = input().constraints
    expect(issues(validateCampaign(input({ constraints: { ...k, days: [], devices: [], hours: { from: 10, to: 10 } } }), ctx()))).toEqual(["6:days", "6:devices", "6:hours"])
    expect(warns(validateCampaign(input({ constraints: { ...k, audienceIds: ["aud_x"] } }), ctx()))).toEqual([6])
    const t = input().targets[0]
    expect(issues(validateCampaign(input({ targets: [{ ...t, destinationOverride: "app://deep" }] }), ctx()))).toEqual([])
    expect(issues(validateCampaign(input({ targets: [{ ...t, destinationOverride: "ftp://x" }] }), ctx()))).toEqual([])
    expect(issues(validateCampaign(input({ targets: [{ ...t, destinationOverride: "not a url" }] }), ctx()))).toEqual(["6:dest-p1"])
    const web = { propertyId: "w1", countryRule: { mode: "all" as const, countries: [] }, placementIds: ["pl3"], allocationPct: null, destinationOverride: "app://deep" }
    const r = validateCampaign(input({ targets: [web] }), ctx({ creatives: { cr1: { id: "cr1", name: "D", format: "web_display", size: "300x250", status: "ready" } } }))
    expect(r.errors.map((e) => e.key)).toEqual(["dest-w1"])
    expect(r.errors[0].message).toContain("an https:// URL.")
  })
  it("step 7: budget, allocation and team budget", () => {
    expect(issues(validateCampaign(input({ budget: { amountMicros: 0, pacing: "even", goal: null } }), ctx()))).toEqual(["7:budget"])
    const t = input().targets[0]
    expect(issues(validateCampaign(input({ targets: [{ ...t, allocationPct: 60 }, { ...t, allocationPct: null }] }), ctx()))).toEqual(["7:alloc"])
    expect(issues(validateCampaign(input({ targets: [{ ...t, allocationPct: 60.004 }, { ...t, allocationPct: 39.996 }] }), ctx()))).toEqual([])
    const r = validateCampaign(input(), ctx({ teamLeftMicros: 500_000_000 }))
    expect(r.warnings).toEqual([{ step: 7, key: "budget", message: "Budget is above the Sports team’s remaining allocation ($500)." }])
    expect(validateCampaign(input(), ctx({ teamLeftMicros: -5 })).warnings[0].message).toContain("($0)")
  })
})

describe("publishedStatus", () => {
  it("scheduled when the flight starts after today in its zone", () => {
    const now = Date.parse("2026-10-19T20:00:00Z") // Oct 20 in Dhaka, Oct 19 in UTC
    expect(publishedStatus({ start: "2026-10-20", tz: "Asia/Dhaka" }, now)).toBe("active")
    expect(publishedStatus({ start: "2026-10-20", tz: "UTC" }, now)).toBe("scheduled")
  })
})

describe("teamBudgetLeft", () => {
  it("subtracts live campaigns of the team, excluding one", () => {
    const cs = [
      { id: "a", team: "Sports", status: "active" as const, budget: { amountMicros: 100 } },
      { id: "b", team: "Sports", status: "paused" as const, budget: { amountMicros: 50 } },
      { id: "c", team: "Sports", status: "draft" as const, budget: { amountMicros: 999 } },
      { id: "d", team: "Media", status: "active" as const, budget: { amountMicros: 999 } },
      { id: "e", team: "Sports", status: "scheduled" as const, budget: { amountMicros: 10 } },
    ]
    expect(teamBudgetLeft(1000, cs, "Sports")).toEqual({ total: 1000, allocated: 160, left: 840 })
    expect(teamBudgetLeft(1000, cs, "Sports", "a")).toEqual({ total: 1000, allocated: 60, left: 940 })
  })
})

describe("pacing", () => {
  const c = (status: "active" | "paused" | "draft" | "scheduled" | "completed" | "archived" = "active") => ({ status, flight: { start: "2026-10-01", end: "2026-10-30", tz: "UTC" }, budget: { amountMicros: 1000 } })
  const now = Date.parse("2026-10-15T12:00:00Z")
  it("compares spend with elapsed flight", () => {
    const p = pacing(c(), 500, now)
    expect(p.elapsed).toBe(0.5)
    expect(p.label).toBe("on_pace")
    expect(p.daysLeft).toBe(16)
    expect(pacing(c(), 100, now).label).toBe("behind")
    expect(pacing(c(), 900, now).label).toBe("ahead")
    expect(pacing({ ...c(), budget: { amountMicros: 0 } }, 100, now).budgetPct).toBe(0)
  })
  it("labels by status", () => {
    expect(pacing(c("draft"), 0, now).label).toBe("not_started")
    expect(pacing(c("scheduled"), 0, now).label).toBe("not_started")
    expect(pacing(c("completed"), 0, now).label).toBe("ended")
    expect(pacing(c("archived"), 0, now).label).toBe("ended")
    expect(pacing(c("paused"), 0, now).label).toBe("paused")
    expect(PACING_LABEL_TEXT.on_pace).toBe("On pace")
  })
  it("clamps elapsed and days left", () => {
    expect(pacing(c(), 0, Date.parse("2026-12-15T00:00:00Z"))).toMatchObject({ elapsed: 1, daysLeft: 0 })
    expect(pacing(c(), 0, Date.parse("2026-09-01T00:00:00Z")).elapsed).toBe(0)
  })
})

describe("needsAttention / hourlyAllowanceMicros", () => {
  it("active with issues needs attention", () => {
    expect(needsAttention({ status: "active", health: { issues: [{}] } })).toBe(true)
    expect(needsAttention({ status: "paused", health: { issues: [{}] } })).toBe(false)
    expect(needsAttention({ status: "active", health: { issues: [] } })).toBe(false)
  })
  it("spreads remaining budget over remaining hours", () => {
    const now = dayStart(TODAY).getTime() + 12 * 3_600_000
    expect(hourlyAllowanceMicros(24_000_000, TODAY, "Asia/Dhaka", now)).toBe(2_000_000)
    expect(hourlyAllowanceMicros(24_000_000, "2026-10-01", "Asia/Dhaka", now)).toBe(24_000_000)
    expect(hourlyAllowanceMicros(-5, TODAY, "Asia/Dhaka", now)).toBe(0)
  })
})
