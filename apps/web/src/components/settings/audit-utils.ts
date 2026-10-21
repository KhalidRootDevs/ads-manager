import type { AuditEntry } from "@orbit/domain"

/** Past-tense verb for the activity feed ("published", "rotated"…); the object is the target name. */
const VERB: Record<string, string> = {
  published: "published", paused: "paused", resumed: "resumed", created: "created", updated: "edited", archived: "archived", restored: "restored",
  duplicated: "duplicated", approved: "approved", rejected: "rejected", submitted: "submitted for review", rotated: "rotated", revoked: "revoked",
  invited: "invited", joined: "joined as", removed: "removed", changed: "changed", enabled: "enabled", disabled: "disabled", activated: "activated",
  deactivated: "deactivated", deleted: "deleted", acked: "acknowledged", integrated: "integrated", tested: "sent a test request to",
}
const NOUN: Record<string, string> = {
  campaign: "campaign", creative: "creative", property: "app / site", placement: "placement", key: "SDK key", member: "member", role: "the role of",
  budget: "budget", settings: "settings", country: "country", event: "event", audience: "audience", alert: "alert",
}

const BADGE_NOUN: Record<string, string> = {
  campaign: "Campaign", creative: "Creative", property: "App / site", placement: "Placement", key: "SDK key", member: "Member", role: "Role",
  budget: "Budget", settings: "Settings", country: "Country", event: "Event", audience: "Audience", alert: "Alert",
}
const BADGE_VERB: Record<string, string> = { updated: "edited", submitted: "submitted", acked: "acknowledged", joined: "joined", tested: "tested" }

/** "campaign.published" → "Campaign published" (badge text in the audit log). */
export function actionLabel(action: string): string {
  const [noun, verb = ""] = action.split(".")
  return `${BADGE_NOUN[noun] ?? noun} ${BADGE_VERB[verb] ?? verb.replace(/_/g, " ")}`.trim()
}

/** Sentence fragment for the activity feed: "<actor> published campaign <target>". */
export function activityText(action: string): string {
  const [noun, verb] = action.split(".")
  if (action === "role.changed") return "changed the role of"
  if (action === "settings.changed") return "changed"
  if (action === "member.joined") return "joined the workspace"
  if (action === "budget.changed") return "changed the budget of"
  return `${VERB[verb] ?? verb?.replace(/_/g, " ")} ${NOUN[noun] ?? noun}`
}

/** Detail link for an audit target, when the entity has a page. */
export function auditHref(t: AuditEntry["target"]): string | null {
  switch (t.type) {
    case "campaign": return `/campaigns/${t.id}`
    case "creative": return `/creatives/${t.id}`
    case "property": return `/properties/${t.id}`
    case "placement": return `/placements/${t.id}`
    case "key": return null
    case "audience": return "/audiences"
    case "budget": return "/billing"
    case "event": return "/settings?tab=events"
    case "country": return "/settings?tab=countries"
    case "settings": return "/settings"
    case "member":
    case "user": return "/settings?tab=team"
    default: return null
  }
}

export function actionTone(action: string): "danger" | "warning" | "success" | "info" | "neutral" {
  const verb = action.split(".")[1] ?? ""
  if (/^(revoked|removed|rejected|disabled|deactivated|deleted)$/.test(verb)) return "danger"
  if (/^(rotated|paused)$/.test(verb) || action === "role.changed") return "warning"
  if (/^(published|activated|enabled|created|invited|approved|resumed|joined|integrated)$/.test(verb)) return "success"
  if (/^(updated|changed|submitted|acked)$/.test(verb)) return "info"
  return "neutral"
}

/** Actions offered by the audit log filter (the API filters by exact action). */
export const AUDIT_ACTIONS = [
  "campaign.created", "campaign.updated", "campaign.published", "campaign.paused", "campaign.resumed", "campaign.archived", "campaign.restored", "campaign.duplicated",
  "creative.created", "creative.updated", "creative.submitted", "creative.approved", "creative.rejected", "creative.archived", "creative.restored",
  "property.created", "property.updated", "property.paused", "property.activated", "placement.created", "placement.updated", "placement.paused",
  "key.created", "key.rotated", "key.revoked", "member.invited", "member.removed", "role.changed", "budget.changed", "settings.changed",
  "country.enabled", "country.disabled", "event.created", "event.activated", "event.deactivated", "audience.created", "audience.deleted", "alert.acked",
]
