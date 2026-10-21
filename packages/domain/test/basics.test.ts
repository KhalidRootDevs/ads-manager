import { describe, expect, it } from "vitest"
import {
  addDays, can, canAssignRole, compactKey, costMicros, dateKeyInTz, dateKeys, dayStart, daysBetween, delta, deriveMetrics, derivedRatios, EMPTY_TOTALS, fromMicros, hourInTz,
  ID_PATTERN, ID_PREFIX, idTime, isDateKey, isId, newId, partitionKey, partsInTz, PERMISSION_TABLE, permissionsOf, quarterOf, quarterRange, reportingDay, ROLES, todayKey,
  toMicros, tzOffsetMinutes, weekdayInTz, weekdayOfKey, type IdKind, type Permission,
} from "../src"

describe("time", () => {
  it("dayStart is local midnight in Asia/Dhaka (UTC+6)", () => {
    expect(dayStart("2026-10-19").toISOString()).toBe("2026-10-18T18:00:00.000Z")
    expect(dayStart("2026-10-19", "UTC").toISOString()).toBe("2026-10-19T00:00:00.000Z")
    expect(tzOffsetMinutes("Asia/Dhaka", Date.now())).toBe(360)
  })
  it("dayStart handles DST zones", () => {
    expect(dayStart("2026-01-15", "America/New_York").toISOString()).toBe("2026-01-15T05:00:00.000Z")
    expect(dayStart("2026-07-01", "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z")
    expect(dayStart("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z")
  })
  it("dateKeyInTz and reportingDay use the reporting zone", () => {
    expect(dateKeyInTz(Date.parse("2026-10-18T17:59:59Z"))).toBe("2026-10-18")
    expect(dateKeyInTz(Date.parse("2026-10-18T18:00:00Z"))).toBe("2026-10-19")
    expect(dateKeyInTz(Date.parse("2026-10-18T18:00:00Z"), "UTC")).toBe("2026-10-18")
    expect(reportingDay(Date.parse("2026-10-19T17:00:00Z")).toISOString()).toBe("2026-10-18T18:00:00.000Z")
    expect(todayKey("Asia/Dhaka", Date.parse("2026-10-19T20:00:00Z"))).toBe("2026-10-20")
    expect(hourInTz(Date.parse("2026-10-19T15:30:00Z"))).toBe(21)
    expect(weekdayInTz(Date.parse("2026-10-18T19:00:00Z"))).toBe("mon")
    expect(partsInTz(Date.parse("2026-10-19T00:00:00Z"), "UTC")).toMatchObject({ year: 2026, month: 10, day: 19, hour: 0, weekday: "mon" })
  })
  it("calendar arithmetic", () => {
    expect(addDays("2026-10-19", -59)).toBe("2026-08-21")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(daysBetween("2026-08-21", "2026-10-19")).toBe(59)
    expect(weekdayOfKey("2026-10-19")).toBe("mon")
    expect(weekdayOfKey("2026-10-18")).toBe("sun")
    expect(compactKey("2026-10-19")).toBe("20261019")
    expect(dateKeys("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"])
    expect(dateKeys("2026-10-02", "2026-10-01")).toEqual([])
  })
  it("quarters", () => {
    expect(quarterOf("2026-10-19")).toBe("2026-Q4")
    expect(quarterOf("2026-03-31")).toBe("2026-Q1")
    expect(quarterRange("2026-Q4")).toEqual({ from: "2026-10-01", to: "2026-12-31" })
    expect(quarterRange("2026-Q1")).toEqual({ from: "2026-01-01", to: "2026-03-31" })
    expect(quarterRange("2028-Q1").to).toBe("2028-03-31")
  })
  it("isDateKey", () => {
    expect(isDateKey("2026-10-19")).toBe(true)
    expect(isDateKey("2026-1-19")).toBe(false)
    expect(isDateKey("2026-13-40")).toBe(false)
    expect(isDateKey(20261019)).toBe(false)
  })
})

describe("money", () => {
  it("converts USD and micros", () => {
    expect(toMicros(12.34)).toBe(12_340_000)
    expect(toMicros(0.1 + 0.2)).toBe(300_000)
    expect(fromMicros(12_340_000)).toBe(12.34)
    expect(fromMicros(5_000_000n)).toBe(5)
    expect(fromMicros(null)).toBe(0)
    expect(costMicros(1000, 1.8)).toBe(1_800_000)
    expect(costMicros(1, 12)).toBe(12_000)
  })
})

describe("ids", () => {
  it("are prefixed ULIDs with an embedded time", () => {
    for (const kind of Object.keys(ID_PREFIX) as IdKind[]) {
      const id = newId(kind)
      expect(id).toMatch(ID_PATTERN[kind])
      expect(isId(kind, id)).toBe(true)
    }
    expect(idTime(newId("campaign", 1_760_000_000_000))).toBe(1_760_000_000_000)
    // an earlier instant after a later one keeps its own time
    newId("campaign", 1_900_000_000_000)
    expect(idTime(newId("campaign", 1_760_000_000_123))).toBe(1_760_000_000_123)
    expect(isId("campaign", newId("user"))).toBe(false)
    expect(isId("campaign", 42)).toBe(false)
  })
  it("sort by creation time and stay monotonic within a millisecond", () => {
    const at = 2_100_000_000_000 // later than any id generated so far
    const ids = Array.from({ length: 50 }, () => newId("auditLog", at))
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(50)
  })
})

describe("rbac", () => {
  it("matches the permission matrix", () => {
    expect(can("owner", "team.manage")).toBe(true)
    expect(can("admin", "creatives.approve")).toBe(true)
    expect(can("campaign_manager", "creatives.approve")).toBe(false)
    expect(can("campaign_manager", "campaigns.publish")).toBe(true)
    expect(can("developer", "keys.manage")).toBe(true)
    expect(can("developer", "campaigns.write")).toBe(false)
    expect(can("analyst", "reports.export")).toBe(true)
    expect(can("read_only", "reports.export")).toBe(false)
    expect(can(null, "reports.export")).toBe(false)
    expect(permissionsOf("read_only")).toEqual([])
    expect(permissionsOf("owner")).toHaveLength(PERMISSION_TABLE.length)
    for (const row of PERMISSION_TABLE) for (const role of ROLES) expect(can(role, row.permission as Permission)).toBe(row.roles.includes(role))
  })
  it("only owners grant the owner role", () => {
    expect(canAssignRole("owner", "owner")).toBe(true)
    expect(canAssignRole("admin", "owner")).toBe(false)
    expect(canAssignRole("admin", "analyst")).toBe(true)
    expect(canAssignRole("campaign_manager", "analyst")).toBe(false)
  })
})

describe("analytics maths", () => {
  it("derives ratios from raw sums", () => {
    const m = deriveMetrics({ req: 2000, elig: 1800, err: 4, imp: 1000, view: 700, clk: 20, vs: 100, vc: 80, conv: 2, costMicros: 3_500_000 })
    expect(m).toMatchObject({ cost: 3.5, ctr: 0.02, fill: 0.5, ecpm: 3.5, vcr: 0.8, viewRate: 0.7 })
    expect(deriveMetrics({ ...EMPTY_TOTALS, req: null })).toMatchObject({ fill: null, ctr: 0, ecpm: 0, vcr: 0, viewRate: 0 })
    expect(deriveMetrics(EMPTY_TOTALS).fill).toBe(0)
    expect(derivedRatios({ clk: 10, conv: 2, cost: 5 })).toEqual({ cvr: 0.2, cpa: 2.5, cpc: 0.5 })
    expect(derivedRatios({ clk: 0, conv: 0, cost: 5 })).toEqual({ cvr: 0, cpa: 0, cpc: 0 })
    expect(delta(110, 100)).toBeCloseTo(0.1)
    expect(delta(110, 0)).toBeNull()
    expect(delta(null, 5)).toBeNull()
  })
  it("partitions delivery by campaign and supply by property", () => {
    expect(partitionKey({ k: "supply", id: "1", at: 0, r: "r", p: "prp", pl: "pl", cc: "BD", dv: "ph", pf: "an", result: "filled", reason: null, latencyMs: 1, sdk: null })).toBe("prp")
    expect(partitionKey({ k: "imp", id: "1", at: 0, r: "r", cpi: 1, c: "cmp", cr: "cr", p: "prp", pl: "pl", cc: "BD", dv: "ph", pf: "an", f: "banner" })).toBe("cmp")
  })
})
