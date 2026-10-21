/**
 * Mongoose schemas for operational collections (guideline §6.4, §6.13).
 *
 * Rules enforced here:
 * - Indexes are declared ONLY with `schema.index()` and only those in §6.6. No field uses `index`, `unique` or `sparse`.
 * - `_id` is a prefixed ULID string, `versionKey: false` (we use `rev`), collection names are pinned.
 */
import {
  AD_FORMATS, ALERT_SEVERITIES, ALERT_STATUSES, ALERT_TYPES, ASSET_KINDS, AUDIENCE_STATUSES, CAMPAIGN_STATUSES, COUNTRY_MODES, CREATIVE_STATUSES, DEVICES,
  EVENT_SOURCES, FREQ_PERIODS, GOAL_TYPES, HEALTH_CODES, KEY_ENVS, KEY_STATUSES, MEDIA_TYPES, OBJECTIVES, PACING_MODES, PLACEMENT_STATUSES, PLATFORMS,
  PROPERTY_ENVS, PROPERTY_STATUSES, REVIEW_STATES, ROLES, SDK_STATES, USER_STATUSES, WEEKDAYS,
} from "@orbit/domain"
import { Schema } from "mongoose"

const CI = { locale: "en", strength: 2 } as const
const base = { versionKey: false as const, strict: "throw" as const, timestamps: true, minimize: false, id: false }
const sub = { _id: false, id: false, versionKey: false as const, minimize: false }

const CountryRule = new Schema({ mode: { type: String, enum: COUNTRY_MODES, required: true }, countries: { type: [String], default: [] } }, sub)
const FreqCap = new Schema({ count: { type: Number, required: true, min: 1 }, per: { type: String, enum: FREQ_PERIODS, required: true } }, sub)

// ---------- users ----------
export const userSchema = new Schema(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: USER_STATUSES, required: true },
    sso: { type: new Schema({ provider: String, subject: String }, sub), default: null },
    lastActiveAt: { type: Date, default: null },
    invitedBy: { type: String, default: null },
    rev: { type: Number, default: 0 },
  },
  { ...base, collection: "users" },
)
userSchema.index({ email: 1 }, { unique: true, collation: CI, name: "email_1_ci" })

// ---------- sessions ----------
export const sessionSchema = new Schema(
  {
    _id: { type: String, required: true }, // sha256(session token)
    userId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true },
    ip: { type: String, default: null },
    ua: { type: String, default: null },
  },
  { ...base, timestamps: { createdAt: true, updatedAt: false }, collection: "sessions" },
)
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_ttl" })

// ---------- properties ----------
export const propertySchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    identifier: { type: String, required: true, lowercase: true, trim: true },
    team: { type: String, required: true },
    ownerId: { type: String, default: null },
    env: { type: String, enum: PROPERTY_ENVS, required: true },
    status: { type: String, enum: PROPERTY_STATUSES, required: true },
    formats: { type: [{ type: String, enum: AD_FORMATS }], default: [] },
    countryRule: { type: CountryRule, required: true },
    tags: { type: [String], default: [] },
    testMode: { type: Boolean, default: true },
    sdk: {
      type: new Schema({ state: { type: String, enum: SDK_STATES, required: true }, version: { type: String, default: null }, lastHeartbeatAt: { type: Date, default: null } }, sub),
      required: true,
    },
    rev: { type: Number, default: 0 },
  },
  { ...base, collection: "properties" },
)
propertySchema.index({ platform: 1, identifier: 1 }, { unique: true, name: "platform_1_identifier_1" })

// ---------- property_keys ----------
export const propertyKeySchema = new Schema(
  {
    _id: { type: String, required: true },
    propertyId: { type: String, required: true },
    label: { type: String, required: true },
    env: { type: String, enum: KEY_ENVS, required: true },
    prefix: { type: String, required: true },
    last4: { type: String, required: true },
    hash: { type: String, required: true },
    status: { type: String, enum: KEY_STATUSES, required: true },
    graceUntil: { type: Date, default: null },
    createdBy: { type: String, default: null },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: String, default: null },
  },
  { ...base, collection: "property_keys" },
)
propertyKeySchema.index({ propertyId: 1 }, { name: "propertyId_1" })

// ---------- placements ----------
export const placementSchema = new Schema(
  {
    _id: { type: String, required: true },
    propertyId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    format: { type: String, enum: AD_FORMATS, required: true },
    size: { type: String, required: true },
    minAppVersion: { type: String, default: null },
    freqCap: { type: FreqCap, default: null },
    refreshSec: { type: Number, default: null },
    status: { type: String, enum: PLACEMENT_STATUSES, required: true },
    rev: { type: Number, default: 0 },
  },
  { ...base, collection: "placements" },
)
placementSchema.index({ propertyId: 1, name: 1 }, { unique: true, collation: CI, name: "propertyId_1_name_1_ci" })

// ---------- creatives (no secondary B-tree indexes; Atlas Search on name + copy.headline) ----------
const AssetSchema = new Schema(
  {
    kind: { type: String, enum: ASSET_KINDS, required: true }, url: { type: String, required: true }, name: { type: String, required: true }, mime: { type: String, required: true },
    bytes: { type: Number, required: true }, width: { type: Number, default: null }, height: { type: Number, default: null }, durationSec: { type: Number, default: null },
    sha256: { type: String, default: null },
  },
  sub,
)
export const creativeSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    format: { type: String, enum: AD_FORMATS, required: true },
    size: { type: String, default: "" },
    status: { type: String, enum: CREATIVE_STATUSES, required: true },
    ownerId: { type: String, default: null },
    currentVersion: { type: Number, default: 1 },
    assets: { type: [AssetSchema], default: [] },
    copy: { type: new Schema({ headline: { type: String, default: "" }, body: { type: String, default: "" }, cta: { type: String, default: "" } }, sub), required: true },
    destination: {
      type: new Schema(
        {
          url: { type: String, default: null }, deepLink: { type: String, default: null },
          utm: { type: new Schema({ source: { type: String, default: "" }, medium: { type: String, default: "" }, campaign: { type: String, default: "" } }, sub), required: true },
        },
        sub,
      ),
      required: true,
    },
    altText: { type: String, default: "" },
    options: {
      type: new Schema(
        {
          media: { type: String, enum: MEDIA_TYPES, default: "image" }, closeDelaySec: { type: Number, default: null }, reward: { type: String, default: null },
          completionEvent: { type: String, default: null }, safeArea: { type: Boolean, default: null }, closeButton: { type: Boolean, default: null },
          freqNotice: { type: Boolean, default: null }, brandColor: { type: String, default: "#0F766E" },
        },
        sub,
      ),
      required: true,
    },
    review: {
      type: new Schema({ state: { type: String, enum: REVIEW_STATES, required: true }, by: { type: String, default: null }, at: { type: Date, default: null }, reason: { type: String, default: null } }, sub),
      required: true,
    },
    rev: { type: Number, default: 0 },
  },
  { ...base, collection: "creatives" },
)

// ---------- creative_versions ----------
export const creativeVersionSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${creativeId}:${v}`
    creativeId: { type: String, required: true },
    v: { type: Number, required: true },
    snapshot: { type: Schema.Types.Mixed, required: true },
    by: { type: String, default: null },
    byName: { type: String, default: null },
    note: { type: String, default: "" },
    at: { type: Date, required: true },
  },
  { ...base, timestamps: false, strict: true, collection: "creative_versions" },
)
creativeVersionSchema.index({ creativeId: 1, v: -1 }, { name: "creativeId_1_v_-1" })

// ---------- campaigns (targets embedded) ----------
const TargetSchema = new Schema(
  {
    propertyId: { type: String, required: true }, countryRule: { type: CountryRule, required: true }, placementIds: { type: [String], default: [] },
    allocationPct: { type: Number, default: null }, destinationOverride: { type: String, default: null },
  },
  sub,
)
const HealthIssueSchema = new Schema(
  { code: { type: String, enum: HEALTH_CODES, required: true }, message: { type: String, required: true }, propertyId: { type: String, default: null }, creativeId: { type: String, default: null }, country: { type: String, default: null } },
  sub,
)
export const campaignSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    objective: { type: String, enum: OBJECTIVES, required: true },
    status: { type: String, enum: CAMPAIGN_STATUSES, required: true },
    health: { type: new Schema({ issues: { type: [HealthIssueSchema], default: [] }, checkedAt: { type: Date, default: null } }, sub), default: () => ({ issues: [], checkedAt: null }) },
    ownerId: { type: String, default: null },
    team: { type: String, required: true },
    flight: { type: new Schema({ start: { type: Date, required: true }, end: { type: Date, required: true }, tz: { type: String, required: true } }, sub), required: true },
    priority: { type: Number, enum: [1, 2, 3], default: 2 },
    creativeIds: { type: [String], default: [] },
    targets: { type: [TargetSchema], default: [] },
    constraints: {
      type: new Schema(
        {
          days: { type: [{ type: String, enum: WEEKDAYS }], default: [] },
          hours: { type: new Schema({ from: { type: Number, required: true }, to: { type: Number, required: true } }, sub), required: true },
          devices: { type: [{ type: String, enum: DEVICES }], default: [] },
          minAppVersion: { type: String, default: null },
          freqCap: { type: FreqCap, default: null },
          audienceIds: { type: [String], default: [] },
        },
        sub,
      ),
      required: true,
    },
    budget: {
      type: new Schema(
        {
          amountMicros: { type: Schema.Types.BigInt, required: true },
          pacing: { type: String, enum: PACING_MODES, required: true },
          goal: { type: new Schema({ type: { type: String, enum: GOAL_TYPES, required: true }, value: { type: Number, required: true } }, sub), default: null },
        },
        sub,
      ),
      required: true,
    },
    /** Present (true) while not archived: scopes the unique-name partial index. Removed with $unset on archive. */
    live: { type: Boolean },
    publishedRev: { type: Number, default: null },
    publishedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    createdBy: { type: String, default: null },
    rev: { type: Number, default: 0 },
  },
  { ...base, collection: "campaigns" },
)
campaignSchema.index({ status: 1, updatedAt: -1 }, { name: "status_1_updatedAt_-1" })
campaignSchema.index({ "targets.propertyId": 1 }, { name: "targets.propertyId_1" })
campaignSchema.index({ creativeIds: 1 }, { name: "creativeIds_1" })
campaignSchema.index({ name: 1 }, { unique: true, collation: CI, partialFilterExpression: { live: true }, name: "name_1_ci_live" })

// ---------- campaign_revisions ----------
export const campaignRevisionSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${campaignId}:${rev}`
    campaignId: { type: String, required: true },
    rev: { type: Number, required: true },
    snapshot: { type: Schema.Types.Mixed, required: true },
    publishedBy: { type: String, default: null },
    publishedByName: { type: String, default: null },
    at: { type: Date, required: true },
    diff: { type: [String], default: [] },
  },
  { ...base, timestamps: false, strict: true, collection: "campaign_revisions" },
)
campaignRevisionSchema.index({ campaignId: 1, rev: -1 }, { name: "campaignId_1_rev_-1" })

// ---------- campaign_stats (derived counters, read by _id only) ----------
const Counters = { imp: { type: Number, default: 0 }, clk: { type: Number, default: 0 }, conv: { type: Number, default: 0 }, costMicros: { type: Schema.Types.BigInt, default: 0n } }
export const campaignStatsSchema = new Schema(
  {
    _id: { type: String, required: true },
    lifetime: { type: new Schema(Counters, sub), default: () => ({}) },
    today: { type: new Schema({ d: { type: Date, default: null }, ...Counters }, sub), default: () => ({}) },
    updatedAt: { type: Date, default: null },
  },
  { versionKey: false, strict: true, timestamps: false, minimize: false, id: false, collection: "campaign_stats" },
)

// ---------- reference collections (natural _id, no secondary indexes) ----------
export const countrySchema = new Schema(
  { _id: { type: String, required: true }, name: { type: String, required: true }, region: { type: String, required: true }, enabled: { type: Boolean, required: true }, isoNumeric: { type: String, default: null } },
  { ...base, collection: "countries" },
)

export const eventDefinitionSchema = new Schema(
  {
    _id: { type: String, required: true }, name: { type: String, required: true }, source: { type: String, enum: EVENT_SOURCES, required: true },
    active: { type: Boolean, default: true }, lastSeenAt: { type: Date, default: null },
  },
  { ...base, collection: "event_definitions" },
)

export const settingsSchema = new Schema(
  {
    _id: { type: String, required: true }, // "global"
    reportingTz: { type: String, required: true },
    currency: { type: String, enum: ["USD"], required: true },
    defaults: { type: new Schema({ freqCap: { type: FreqCap, default: null }, refreshSec: { type: Number, default: null } }, sub), required: true },
    tracking: { type: new Schema({ clicks: Boolean, viewability: Boolean, ipTruncation: Boolean }, sub), required: true },
    autoPauseOnBudget: { type: Boolean, default: true },
    killSwitch: { type: Boolean, default: false },
    rev: { type: Number, default: 0 },
  },
  { ...base, collection: "settings" },
)

export const budgetSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${team}:${quarter}`
    team: { type: String, required: true }, quarter: { type: String, required: true }, amountMicros: { type: Schema.Types.BigInt, required: true },
    updatedBy: { type: String, default: null }, rev: { type: Number, default: 0 },
  },
  { ...base, collection: "budgets" },
)

export const audienceSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    rule: {
      type: new Schema(
        { event: { type: String, required: true }, withinDays: { type: Number, required: true }, exclude: { type: new Schema({ event: String, withinDays: Number }, sub), default: null } },
        sub,
      ),
      required: true,
    },
    status: { type: String, enum: AUDIENCE_STATUSES, required: true },
    estimate: { type: new Schema({ size: Number, at: Date }, sub), default: null },
    createdBy: { type: String, default: null },
    rev: { type: Number, default: 0 },
  },
  { ...base, collection: "audiences" },
)

// ---------- audit_log (append-only) ----------
export const auditLogSchema = new Schema(
  {
    _id: { type: String, required: true }, // ULID: time-ordered, newest first = sort by _id desc
    at: { type: Date, required: true },
    actor: { type: new Schema({ id: { type: String, default: null }, name: { type: String, required: true } }, sub), required: true },
    action: { type: String, required: true },
    target: { type: new Schema({ type: { type: String, required: true }, id: { type: String, required: true }, name: { type: String, required: true } }, sub), required: true },
    detail: { type: String, default: "" },
    diff: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: null },
    requestId: { type: String, default: null },
  },
  { ...base, timestamps: false, collection: "audit_log" },
)
auditLogSchema.index({ "target.id": 1, _id: -1 }, { name: "target.id_1__id_-1" })

// ---------- alerts ----------
export const alertSchema = new Schema(
  {
    _id: { type: String, required: true },
    type: { type: String, enum: ALERT_TYPES, required: true },
    severity: { type: String, enum: ALERT_SEVERITIES, required: true },
    entity: { type: new Schema({ type: { type: String, required: true }, id: { type: String, required: true } }, sub), required: true },
    status: { type: String, enum: ALERT_STATUSES, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    href: { type: String, required: true },
    dedupeKey: { type: String, required: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: null },
    ackedBy: { type: String, default: null },
  },
  { ...base, timestamps: false, collection: "alerts" },
)
alertSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { status: "open" }, name: "dedupeKey_1_open" })
alertSchema.index({ resolvedAt: 1 }, { expireAfterSeconds: 7_776_000, name: "resolvedAt_ttl_90d" })
