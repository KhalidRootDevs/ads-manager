/**
 * Campaign health ("Needs attention") and operational alerts. Used by the serving compiler and the jobs
 * worker (which persist `campaigns.health` and `alerts`) and by the demo seed.
 */
import type { AlertSeverity, AlertType } from "../enums"
import { CREATIVE_STATUS_LABEL } from "../labels"
import type { Campaign, Creative, HealthIssue, Placement, Property } from "../schemas"
import { compat, conflictsFor, type CountryLike } from "./targeting"

export interface HealthCtx {
  properties: Record<string, Pick<Property, "id" | "name" | "status" | "countryRule" | "sdk">>
  placements: Record<string, Pick<Placement, "id" | "propertyId" | "format" | "size" | "status">>
  creatives: Record<string, Pick<Creative, "id" | "name" | "format" | "size" | "status">>
  countries: CountryLike[]
}

type CampaignLike = Pick<Campaign, "creativeIds" | "targets" | "budget">

/** Issues that stop some or all of a campaign from serving. Empty = healthy. */
export function campaignHealth(c: CampaignLike, ctx: HealthCtx, spentMicros = 0): HealthIssue[] {
  const out: HealthIssue[] = []
  const issue = (x: Omit<HealthIssue, "propertyId" | "creativeId" | "country"> & Partial<HealthIssue>): HealthIssue => ({ propertyId: null, creativeId: null, country: null, ...x })
  const ready = c.creativeIds.map((id) => ctx.creatives[id]).filter((cr) => cr?.status === "ready")
  for (const id of c.creativeIds) {
    const cr = ctx.creatives[id]
    if (!cr) continue
    if (cr.status === "rejected") out.push(issue({ code: "creative_rejected", creativeId: id, message: `${cr.name} was rejected.` }))
    else if (cr.status !== "ready") out.push(issue({ code: "creative_not_ready", creativeId: id, message: `${cr.name} is ${CREATIVE_STATUS_LABEL[cr.status].toLowerCase()}.` }))
  }
  for (const x of conflictsFor(c.targets, ctx.properties, ctx.countries)) {
    out.push(issue({ code: "country_conflict", propertyId: x.propertyId, country: x.country, message: `${x.countryName} can’t serve on ${x.propertyName} (${x.disabled ? "disabled platform-wide" : "outside the property’s country defaults"}).` }))
  }
  for (const t of c.targets) {
    const p = ctx.properties[t.propertyId]
    if (!p) continue
    if (p.status === "paused") out.push(issue({ code: "property_paused", propertyId: p.id, message: `${p.name} is paused.` }))
    if (p.sdk.state === "heartbeat_missing") out.push(issue({ code: "sdk_heartbeat_missing", propertyId: p.id, message: `${p.name} stopped sending SDK heartbeats.` }))
    const pls = t.placementIds.map((id) => ctx.placements[id]).filter((pl) => pl && pl.status === "active")
    if (ready.length && !pls.some((pl) => ready.some((cr) => compat(cr, pl).ok)))
      out.push(issue({ code: "no_compatible_placement", propertyId: p.id, message: `No ready creative fits the selected placements on ${p.name}.` }))
  }
  if (c.budget.amountMicros > 0 && spentMicros >= c.budget.amountMicros) out.push(issue({ code: "budget_exhausted", message: "The budget is fully spent." }))
  return out
}

export interface AlertCandidate {
  type: AlertType
  severity: AlertSeverity
  entity: { type: "campaign" | "creative" | "property"; id: string }
  dedupeKey: string
  title: string
  message: string
  href: string
}

export interface AlertCtx {
  campaigns: Pick<Campaign, "id" | "name" | "status" | "creativeIds" | "targets">[]
  creatives: Record<string, Pick<Creative, "id" | "name" | "status" | "review">>
  properties: Record<string, Pick<Property, "id" | "name" | "countryRule" | "sdk">>
  countries: CountryLike[]
  /** properties with an error rate above 1% in the last hour (from supply rollups) */
  degraded?: Set<string>
}

/** The alerts that should currently be open (the jobs worker opens new ones and resolves the rest). */
export function deriveAlerts(ctx: AlertCtx): AlertCandidate[] {
  const out: AlertCandidate[] = []
  for (const c of ctx.campaigns) {
    if (c.status !== "active") continue
    for (const id of c.creativeIds) {
      const cr = ctx.creatives[id]
      if (!cr || cr.status === "ready") continue
      if (cr.status === "rejected")
        out.push({
          type: "creative_rejected", severity: "critical", entity: { type: "creative", id: cr.id }, dedupeKey: `creative_rejected:${cr.id}:${c.id}`,
          title: `${cr.name} was rejected`, message: `${cr.review.reason ?? ""} It is used by “${c.name}”, so delivery stopped.`.trim(), href: `/creatives/${cr.id}`,
        })
      else
        out.push({
          type: "not_delivering", severity: "critical", entity: { type: "campaign", id: c.id }, dedupeKey: `not_delivering:${c.id}:${cr.id}`,
          title: `${c.name} is not delivering`, message: `Its creative “${cr.name}” is ${CREATIVE_STATUS_LABEL[cr.status].toLowerCase()}. No eligible creative can serve.`, href: `/campaigns/${c.id}`,
        })
    }
    for (const x of conflictsFor(c.targets, ctx.properties, ctx.countries)) {
      out.push({
        type: "country_conflict", severity: "warning", entity: { type: "campaign", id: c.id }, dedupeKey: `country_conflict:${c.id}:${x.propertyId}:${x.country}`,
        title: `${x.countryName} can’t serve on ${x.propertyName}`,
        message: `“${c.name}” includes ${x.countryName}, but ${x.disabled ? "it is disabled platform-wide" : `${x.propertyName} excludes it in its country defaults`}. Those requests won’t serve.`,
        href: `/campaigns/${c.id}?tab=targeting`,
      })
    }
  }
  for (const p of Object.values(ctx.properties)) {
    if (p.sdk.state === "heartbeat_missing")
      out.push({
        type: "sdk_heartbeat_missing", severity: "critical", entity: { type: "property", id: p.id }, dedupeKey: `sdk_heartbeat_missing:${p.id}`,
        title: `No heartbeat from ${p.name}`, message: "Ad requests from this app have stopped reaching the ad server.", href: `/properties/${p.id}?tab=diagnostics`,
      })
    if (p.sdk.state === "degraded" || ctx.degraded?.has(p.id))
      out.push({
        type: "sdk_degraded", severity: "warning", entity: { type: "property", id: p.id }, dedupeKey: `sdk_degraded:${p.id}`,
        title: `${p.name} error rate is above 1%`, message: `Request timeouts on SDK ${p.sdk.version ?? ""}. Upgrading the SDK usually fixes this.`.replace("  ", " "), href: `/properties/${p.id}?tab=diagnostics`,
      })
  }
  return out
}
