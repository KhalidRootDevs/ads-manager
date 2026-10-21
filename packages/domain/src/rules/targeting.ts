/**
 * Per-property country targeting: the product's key feature.
 * Effective countries = property availability ∩ platform-enabled countries, then the campaign rule on top.
 * A country named in an Include rule but outside availability is a conflict: it is flagged and never serves.
 */
import type { AdFormat } from "../enums"
import { FORMAT_LABEL } from "../labels"
import { SIZED_FORMATS, sizeLabel } from "../formats"
import type { CountryRule } from "../schemas"

export interface CountryLike {
  code: string
  name: string
  enabled: boolean
}

/** Countries a property can serve in: its own rule applied to the platform-enabled list. */
export function availSet(propertyRule: CountryRule, countries: CountryLike[]): Set<string> {
  const enabled = countries.filter((c) => c.enabled).map((c) => c.code)
  if (propertyRule.mode === "include") {
    const en = new Set(enabled)
    return new Set(propertyRule.countries.filter((c) => en.has(c)))
  }
  if (propertyRule.mode === "exclude") {
    const ex = new Set(propertyRule.countries)
    return new Set(enabled.filter((c) => !ex.has(c)))
  }
  return new Set(enabled)
}

/** Countries a campaign target will actually serve in on that property. */
export function finalCountries(targetRule: CountryRule, propertyRule: CountryRule, countries: CountryLike[]): string[] {
  const av = availSet(propertyRule, countries)
  if (targetRule.mode === "include") return targetRule.countries.filter((c) => av.has(c))
  if (targetRule.mode === "exclude") {
    const ex = new Set(targetRule.countries)
    return [...av].filter((c) => !ex.has(c))
  }
  return [...av]
}

export function ruleSummary(rule: CountryRule): string {
  const list = rule.countries.slice(0, 4).join(", ") + (rule.countries.length > 4 ? ` +${rule.countries.length - 4}` : "")
  if (rule.mode === "include") return rule.countries.length ? `Include ${rule.countries.length}: ${list}` : "Include — no countries yet"
  if (rule.mode === "exclude") return rule.countries.length ? `All available except ${list}` : "All available countries"
  return "All available countries"
}

export interface Conflict {
  propertyId: string
  propertyName: string
  country: string
  countryName: string
  /** true when the country is disabled platform-wide, false when the property's own defaults exclude it. */
  disabled: boolean
}

export interface PropertyLike {
  id: string
  name: string
  countryRule: CountryRule
}

export function conflictsFor(targets: { propertyId: string; countryRule: CountryRule }[], properties: Record<string, PropertyLike>, countries: CountryLike[]): Conflict[] {
  const out: Conflict[] = []
  const byCode = new Map(countries.map((c) => [c.code, c]))
  for (const t of targets) {
    const p = properties[t.propertyId]
    if (!p || t.countryRule.mode !== "include") continue
    const av = availSet(p.countryRule, countries)
    for (const cc of t.countryRule.countries) {
      if (!av.has(cc)) out.push({ propertyId: p.id, propertyName: p.name, country: cc, countryName: byCode.get(cc)?.name ?? cc, disabled: !byCode.get(cc)?.enabled })
    }
  }
  return out
}

export type MatrixState = "serving" | "excluded" | "unavailable" | "conflict" | "disabled"

/** State of one property × country cell in the targeting matrix. */
export function matrixState(country: string, targetRule: CountryRule, propertyRule: CountryRule, countries: CountryLike[]): MatrixState {
  const c = countries.find((x) => x.code === country)
  const av = availSet(propertyRule, countries)
  const named = targetRule.countries.includes(country)
  if (c && !c.enabled) return targetRule.mode === "include" && named ? "conflict" : "disabled"
  if (!av.has(country)) return targetRule.mode === "include" && named ? "conflict" : "unavailable"
  if (targetRule.mode === "include") return named ? "serving" : "excluded"
  if (targetRule.mode === "exclude") return named ? "excluded" : "serving"
  return "serving"
}

export interface CompatResult {
  ok: boolean
  reason: string
}

/** Whether a creative can serve in a placement. */
export function compat(cr: { format: AdFormat; size: string }, pl: { format: AdFormat; size: string }): CompatResult {
  if (cr.format !== pl.format) {
    const f = FORMAT_LABEL[pl.format]
    return { ok: false, reason: `${FORMAT_LABEL[cr.format]} creative can’t serve in ${/^[AEIOU]/i.test(f) ? "an" : "a"} ${f} placement` }
  }
  if (SIZED_FORMATS.includes(cr.format) && cr.size !== pl.size) return { ok: false, reason: `Size mismatch: creative ${sizeLabel(cr.size)}, placement ${sizeLabel(pl.size)}` }
  return { ok: true, reason: "Compatible" }
}
