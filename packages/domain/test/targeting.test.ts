import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { availSet, compat, conflictsFor, finalCountries, matrixState, ruleSummary, type CountryLike } from "../src"
import type { CountryRule } from "../src"

const COUNTRIES: CountryLike[] = [
  { code: "BD", name: "Bangladesh", enabled: true },
  { code: "IN", name: "India", enabled: true },
  { code: "PK", name: "Pakistan", enabled: true },
  { code: "GB", name: "United Kingdom", enabled: true },
  { code: "KR", name: "South Korea", enabled: false },
]
const all: CountryRule = { mode: "all", countries: [] }
const inc = (...c: string[]): CountryRule => ({ mode: "include", countries: c })
const exc = (...c: string[]): CountryRule => ({ mode: "exclude", countries: c })
const sorted = (s: Iterable<string>) => [...s].sort()

describe("availSet", () => {
  it("all = every enabled country", () => expect(sorted(availSet(all, COUNTRIES))).toEqual(["BD", "GB", "IN", "PK"]))
  it("include keeps only enabled listed countries", () => expect(sorted(availSet(inc("BD", "KR", "US"), COUNTRIES))).toEqual(["BD"]))
  it("exclude removes listed countries", () => expect(sorted(availSet(exc("IN", "KR"), COUNTRIES))).toEqual(["BD", "GB", "PK"]))
})

describe("finalCountries", () => {
  it("include ∩ availability, in target order", () => expect(finalCountries(inc("PK", "KR", "BD"), all, COUNTRIES)).toEqual(["PK", "BD"]))
  it("include outside the property's include list is dropped", () => expect(finalCountries(inc("IN", "BD"), inc("BD"), COUNTRIES)).toEqual(["BD"]))
  it("exclude subtracts from availability", () => expect(sorted(finalCountries(exc("BD"), exc("GB"), COUNTRIES))).toEqual(["IN", "PK"]))
  it("all = availability", () => expect(sorted(finalCountries(all, inc("BD", "GB"), COUNTRIES))).toEqual(["BD", "GB"]))
})

describe("conflictsFor", () => {
  const props = { p1: { id: "p1", name: "App", countryRule: inc("BD", "IN") }, p2: { id: "p2", name: "Site", countryRule: all } }
  it("flags include countries outside availability, with the reason", () => {
    const out = conflictsFor([{ propertyId: "p1", countryRule: inc("BD", "GB", "KR") }], props, COUNTRIES)
    expect(out.map((c) => [c.country, c.disabled, c.countryName])).toEqual([["GB", false, "United Kingdom"], ["KR", true, "South Korea"]])
    expect(out[0].propertyName).toBe("App")
  })
  it("ignores exclude/all targets and unknown properties", () => {
    expect(conflictsFor([{ propertyId: "p1", countryRule: exc("GB") }, { propertyId: "p2", countryRule: all }, { propertyId: "x", countryRule: inc("GB") }], props, COUNTRIES)).toEqual([])
  })
  it("falls back to the code for unknown countries", () => {
    expect(conflictsFor([{ propertyId: "p2", countryRule: inc("ZZ") }], props, COUNTRIES)[0]).toMatchObject({ countryName: "ZZ", disabled: true })
  })
})

describe("matrixState", () => {
  it.each([
    ["KR", inc("KR"), all, "conflict"],
    ["KR", all, all, "disabled"],
    ["GB", inc("GB"), inc("BD"), "conflict"],
    ["GB", all, inc("BD"), "unavailable"],
    ["BD", inc("BD"), all, "serving"],
    ["IN", inc("BD"), all, "excluded"],
    ["BD", exc("BD"), all, "excluded"],
    ["IN", exc("BD"), all, "serving"],
    ["IN", all, all, "serving"],
  ] as const)("%s target=%j property=%j → %s", (cc, t, p, state) => expect(matrixState(cc, t, p, COUNTRIES)).toBe(state))
})

describe("ruleSummary", () => {
  it("describes each mode", () => {
    expect(ruleSummary(inc())).toBe("Include — no countries yet")
    expect(ruleSummary(inc("BD", "IN", "PK", "GB", "US"))).toBe("Include 5: BD, IN, PK, GB +1")
    expect(ruleSummary(exc("BD"))).toBe("All available except BD")
    expect(ruleSummary(exc())).toBe("All available countries")
    expect(ruleSummary(all)).toBe("All available countries")
  })
})

describe("compat", () => {
  it("rejects format mismatch with a/an", () => {
    expect(compat({ format: "banner", size: "320x50" }, { format: "interstitial", size: "fullscreen" })).toEqual({ ok: false, reason: "Banner creative can’t serve in an Interstitial placement" })
    expect(compat({ format: "native", size: "1200x628" }, { format: "banner", size: "320x50" }).reason).toContain("in a Banner placement")
  })
  it("requires exact size for sized formats only", () => {
    expect(compat({ format: "banner", size: "728x90" }, { format: "banner", size: "320x50" })).toEqual({ ok: false, reason: "Size mismatch: creative 728×90, placement 320×50" })
    expect(compat({ format: "web_display", size: "300x250" }, { format: "web_display", size: "300x250" }).ok).toBe(true)
    expect(compat({ format: "native", size: "1200x628" }, { format: "native", size: "fluid" }).ok).toBe(true)
    expect(compat({ format: "interstitial", size: "1080x1920" }, { format: "interstitial", size: "fullscreen" }).ok).toBe(true)
  })
})

// ---------- properties ----------
const CODES = ["BD", "IN", "PK", "NP", "GB", "US", "AE", "KR", "EG", "JP"]
const arbCountries = fc.subarray(CODES).map((disabled) => CODES.map((code) => ({ code, name: code, enabled: !disabled.includes(code) })))
const arbRule = fc.record({ mode: fc.constantFrom("all", "include", "exclude") as fc.Arbitrary<CountryRule["mode"]>, countries: fc.uniqueArray(fc.constantFrom(...CODES, "ZZ"), { maxLength: 8 }) })

describe("targeting properties", () => {
  it("final ⊆ availability ⊆ enabled", () => {
    fc.assert(fc.property(arbRule, arbRule, arbCountries, (t, p, cs) => {
      const av = availSet(p, cs)
      const enabled = new Set(cs.filter((c) => c.enabled).map((c) => c.code))
      for (const c of av) expect(enabled.has(c)).toBe(true)
      for (const c of finalCountries(t, p, cs)) expect(av.has(c)).toBe(true)
    }))
  })
  it("include-mode final ⊆ target list; exclude-mode final ∩ target list = ∅", () => {
    fc.assert(fc.property(arbRule, arbRule, arbCountries, (t, p, cs) => {
      const fin = finalCountries(t, p, cs)
      if (t.mode === "include") for (const c of fin) expect(t.countries).toContain(c)
      if (t.mode === "exclude") for (const c of fin) expect(t.countries).not.toContain(c)
      expect(new Set(fin).size).toBe(fin.length)
    }))
  })
  it("conflicts = include countries outside availability; final ∪ conflicts = include list", () => {
    fc.assert(fc.property(arbRule, arbRule, arbCountries, (t, p, cs) => {
      const props = { x: { id: "x", name: "X", countryRule: p } }
      const conflicts = conflictsFor([{ propertyId: "x", countryRule: t }], props, cs).map((c) => c.country)
      const av = availSet(p, cs)
      if (t.mode !== "include") {
        expect(conflicts).toEqual([])
        return
      }
      expect(conflicts).toEqual(t.countries.filter((c) => !av.has(c)))
      expect(sorted([...finalCountries(t, p, cs), ...conflicts])).toEqual(sorted(t.countries))
    }))
  })
  it("matrix says serving exactly for final countries", () => {
    fc.assert(fc.property(arbRule, arbRule, arbCountries, (t, p, cs) => {
      const fin = new Set(finalCountries(t, p, cs))
      for (const c of CODES) expect(matrixState(c, t, p, cs) === "serving").toBe(fin.has(c))
    }))
  })
})
