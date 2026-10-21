/**
 * `$jsonSchema` validators: the database's last line of defence for any writer, including scripts (§6.8, §6.13).
 * Zod validates business payloads at the edge; Mongoose casts and validates shape; these enforce types and bounds.
 */
import { AD_FORMATS, CAMPAIGN_STATUSES, CREATIVE_STATUSES, KEY_STATUSES, PLACEMENT_STATUSES, PLATFORMS, PROPERTY_STATUSES, ROLES, USER_STATUSES } from "@orbit/domain"

const str = { bsonType: "string" }
const strOrNull = { bsonType: ["string", "null"] }
const date = { bsonType: "date" }
const dateOrNull = { bsonType: ["date", "null"] }
const int = { bsonType: ["int", "long", "double"] }
const long = { bsonType: ["long", "int"] }
const bool = { bsonType: "bool" }
const id = (prefix: string) => ({ bsonType: "string", pattern: `^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$` })
const countryRule = {
  bsonType: "object", required: ["mode", "countries"],
  properties: { mode: { enum: ["all", "include", "exclude"] }, countries: { bsonType: "array", maxItems: 250, items: { bsonType: "string", pattern: "^[A-Z]{2}$" } } },
}

export type Validator = { $jsonSchema: Record<string, unknown> }
const v = (required: string[], properties: Record<string, unknown>): Validator => ({ $jsonSchema: { bsonType: "object", required, properties } })

export const VALIDATORS: Record<string, Validator> = {
  users: v(["_id", "email", "name", "role", "status", "createdAt", "updatedAt", "rev"], {
    _id: id("usr"), email: { bsonType: "string", pattern: "^[^@\\s]+@[^@\\s]+$" }, name: str, role: { enum: [...ROLES] }, status: { enum: [...USER_STATUSES] },
    lastActiveAt: dateOrNull, invitedBy: strOrNull, rev: int,
  }),
  sessions: v(["_id", "userId", "expiresAt", "absoluteExpiresAt"], { _id: str, userId: id("usr"), expiresAt: date, absoluteExpiresAt: date }),
  properties: v(["_id", "name", "platform", "identifier", "team", "env", "status", "formats", "countryRule", "sdk", "rev"], {
    _id: id("prp"), name: str, platform: { enum: [...PLATFORMS] }, identifier: { bsonType: "string", pattern: "^[a-z0-9._-]+$" }, team: str,
    env: { enum: ["production", "staging"] }, status: { enum: [...PROPERTY_STATUSES] }, formats: { bsonType: "array", maxItems: 9, items: { enum: [...AD_FORMATS] } },
    countryRule, tags: { bsonType: "array", maxItems: 10 }, testMode: bool, rev: int,
  }),
  property_keys: v(["_id", "propertyId", "env", "hash", "status", "last4"], {
    _id: id("key"), propertyId: id("prp"), env: { enum: ["live", "test"] }, hash: { bsonType: "string", pattern: "^[0-9a-f]{64}$" }, status: { enum: [...KEY_STATUSES] },
    last4: str, graceUntil: dateOrNull,
  }),
  placements: v(["_id", "propertyId", "name", "format", "size", "status", "rev"], {
    _id: id("plc"), propertyId: id("prp"), name: { bsonType: "string", minLength: 2, maxLength: 80 }, format: { enum: [...AD_FORMATS] }, size: str,
    status: { enum: [...PLACEMENT_STATUSES] }, refreshSec: { bsonType: ["int", "double", "null"] }, rev: int,
  }),
  creatives: v(["_id", "name", "format", "status", "assets", "copy", "destination", "review", "rev"], {
    _id: id("crv"), name: { bsonType: "string", minLength: 3, maxLength: 120 }, format: { enum: [...AD_FORMATS] }, status: { enum: [...CREATIVE_STATUSES] },
    assets: { bsonType: "array", maxItems: 5 }, currentVersion: int, rev: int,
  }),
  creative_versions: v(["_id", "creativeId", "v", "snapshot", "at"], { _id: str, creativeId: id("crv"), v: int, at: date }),
  campaigns: v(["_id", "name", "objective", "status", "flight", "creativeIds", "targets", "constraints", "budget", "rev", "createdAt", "updatedAt"], {
    _id: id("cmp"), name: { bsonType: "string", maxLength: 120 }, status: { enum: [...CAMPAIGN_STATUSES] }, priority: { enum: [1, 2, 3] },
    flight: { bsonType: "object", required: ["start", "end", "tz"], properties: { start: date, end: date, tz: str } },
    creativeIds: { bsonType: "array", maxItems: 20, items: { bsonType: "string", pattern: "^crv_" } },
    targets: {
      bsonType: "array", maxItems: 50,
      items: { bsonType: "object", required: ["propertyId", "countryRule", "placementIds"], properties: { propertyId: id("prp"), countryRule, placementIds: { bsonType: "array", maxItems: 100 } } },
    },
    budget: { bsonType: "object", required: ["amountMicros", "pacing"], properties: { amountMicros: { bsonType: "long", minimum: 0 }, pacing: { enum: ["even", "asap"] } } },
    live: { enum: [true] }, rev: int,
  }),
  campaign_revisions: v(["_id", "campaignId", "rev", "snapshot", "at"], { _id: str, campaignId: id("cmp"), rev: int, at: date }),
  campaign_stats: v(["_id"], { _id: id("cmp") }),
  countries: v(["_id", "name", "region", "enabled"], { _id: { bsonType: "string", pattern: "^[A-Z]{2}$" }, name: str, region: str, enabled: bool }),
  event_definitions: v(["_id", "name", "source", "active"], { _id: { bsonType: "string", pattern: "^[a-z][a-z0-9_]{1,49}$" }, name: str, source: { enum: ["sdk", "server", "web_tag"] }, active: bool }),
  settings: v(["_id", "reportingTz", "currency", "defaults", "tracking", "rev"], { _id: { enum: ["global"] }, currency: { enum: ["USD"] }, rev: int }),
  budgets: v(["_id", "team", "quarter", "amountMicros", "rev"], { _id: str, team: str, quarter: { bsonType: "string", pattern: "^\\d{4}-Q[1-4]$" }, amountMicros: { bsonType: "long", minimum: 0 }, rev: int }),
  audiences: v(["_id", "name", "rule", "status", "rev"], { _id: id("aud"), name: str, status: { enum: ["preview", "draft"] }, rev: int }),
  audit_log: v(["_id", "at", "actor", "action", "target"], { _id: id("log"), at: date, action: { bsonType: "string", pattern: "^[a-z_]+\\.[a-z_]+$" } }),
  alerts: v(["_id", "type", "severity", "entity", "status", "dedupeKey", "firstSeenAt", "lastSeenAt"], {
    _id: id("alr"), severity: { enum: ["critical", "warning"] }, status: { enum: ["open", "acked", "resolved"] }, dedupeKey: str, resolvedAt: dateOrNull,
  }),
  delivery_daily: v(["_id", "d", "c", "p", "pl", "cr", "cc", "dv", "pf", "f", "m"], {
    _id: str, d: date, c: str, p: str, pl: str, cr: str, cc: { bsonType: "string", pattern: "^[A-Z]{2}$" }, dv: { enum: ["ph", "tb", "dt"] }, pf: { enum: ["an", "io", "wb"] },
    m: { bsonType: "object", properties: { imp: int, clk: int, conv: int, costMicros: long } },
    h: { bsonType: "object", properties: { imp: { bsonType: "array", minItems: 24, maxItems: 24 }, clk: { bsonType: "array", minItems: 24, maxItems: 24 } } },
  }),
  supply_daily: v(["_id", "d", "p", "pl", "cc", "dv", "pf", "m"], {
    _id: str, d: date, p: str, pl: str, cc: str, dv: { enum: ["ph", "tb", "dt"] }, pf: { enum: ["an", "io", "wb"] },
    h: { bsonType: "object", properties: { req: { bsonType: "array", minItems: 24, maxItems: 24 } } },
  }),
  clicks: v(["_id", "at"], { _id: id("clk"), at: date }),
  conversions: v(["_id", "event", "source", "at"], { _id: { bsonType: "string", pattern: "^clk_[0-9A-HJKMNP-TV-Z]{26}:[a-z][a-z0-9_]{1,49}$" }, at: date }),
  rollup_offsets: v(["_id", "offset", "updatedAt"], { _id: str, offset: str, updatedAt: date }),
}

/** Rollups start in "warn" mode for their first month in production, then move to "error" (§6.1). */
export const VALIDATION_ACTION: Record<string, "error" | "warn"> = { delivery_daily: "error", supply_daily: "error" }
