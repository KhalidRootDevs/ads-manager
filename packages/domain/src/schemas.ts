/**
 * Zod schemas: the single source of truth for API payloads (guideline §3.4, §7.1).
 * DTOs are the JSON shapes the API returns: ids are `id` (not `_id`), instants are ISO strings,
 * calendar dates are "YYYY-MM-DD", money is integer micros.
 */
import { z } from "zod"
import {
  AD_FORMATS, ALERT_SEVERITIES, ALERT_STATUSES, ALERT_TYPES, ASSET_KINDS, AUDIENCE_STATUSES, CAMPAIGN_STATUSES, COUNTRY_MODES, CREATIVE_STATUSES, DEVICES,
  EVENT_SOURCES, FREQ_PERIODS, GOAL_TYPES, HEALTH_CODES, KEY_ENVS, KEY_STATUSES, MEDIA_TYPES, OBJECTIVES, PACING_MODES, PLACEMENT_STATUSES, PLATFORMS,
  PROPERTY_ENVS, PROPERTY_STATUSES, REVIEW_STATES, ROLES, SDK_STATES, USER_STATUSES, WEEKDAYS,
} from "./enums"
import { ID_PATTERN, type IdKind } from "./ids"

// ---------- primitives ----------
export const zId = (kind: IdKind) => z.string().regex(ID_PATTERN[kind], `Invalid ${kind} id`)
export const zInstant = z.iso.datetime({ offset: true })
export const zDateKey = z.iso.date()
export const zCountry = z.string().regex(/^[A-Z]{2}$/, "Use an ISO 3166-1 alpha-2 code")
export const zMicros = z.number().int().nonnegative()
export const zVersion = z.string().regex(/^\d+(\.\d+){0,2}$/, "Use a version like 6.2.1")
export const zHttpsUrl = z.string().trim().regex(/^https:\/\/[^\s/]+\.[^\s]+$/, "Must be an https:// URL with a domain")
export const zDeepLink = z.string().trim().regex(/^[a-z][a-z0-9+.-]*:\/\/\S+$/i, "Deep links look like scheme://path")
export const zName = z.string().trim().min(3, "At least 3 characters").max(120)

export const zFreqCap = z.object({ count: z.number().int().min(1).max(1000), per: z.enum(FREQ_PERIODS) })
export type FreqCap = z.infer<typeof zFreqCap>

export const zCountryRule = z.object({ mode: z.enum(COUNTRY_MODES), countries: z.array(zCountry).max(250) })
export type CountryRule = z.infer<typeof zCountryRule>

export const zPage = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() })
export const zList = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) })
export const zCursorQuery = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) })

// ---------- users & auth ----------
export const zUser = z.object({
  id: zId("user"), email: z.email(), name: z.string(), role: z.enum(ROLES), status: z.enum(USER_STATUSES),
  lastActiveAt: zInstant.nullable(), invitedBy: zId("user").nullable(), createdAt: zInstant, updatedAt: zInstant, rev: z.number().int(),
})
export type User = z.infer<typeof zUser>

export const zMe = z.object({ user: zUser, permissions: z.array(z.string()) })
export type Me = z.infer<typeof zMe>

export const zInviteInput = z.strictObject({ email: z.email().transform((s) => s.toLowerCase()), role: z.enum(ROLES), name: z.string().trim().max(120).optional() })
export const zRoleChangeInput = z.strictObject({ role: z.enum(ROLES), rev: z.number().int() })
export const zDevLoginInput = z.strictObject({ email: z.email() })

// ---------- countries & settings ----------
export const zCountryDto = z.object({ code: zCountry, name: z.string(), region: z.string(), enabled: z.boolean() })
export type Country = z.infer<typeof zCountryDto>
export const zCountryPatch = z.strictObject({ enabled: z.boolean() })

export const zSettings = z.object({
  reportingTz: z.string(), currency: z.literal("USD"),
  defaults: z.object({ freqCap: zFreqCap.nullable(), refreshSec: z.number().int().min(15).max(600).nullable() }),
  tracking: z.object({ clicks: z.boolean(), viewability: z.boolean(), ipTruncation: z.boolean() }),
  autoPauseOnBudget: z.boolean(), rev: z.number().int(), updatedAt: zInstant,
})
export type Settings = z.infer<typeof zSettings>
export const zSettingsInput = zSettings.omit({ updatedAt: true, currency: true, reportingTz: true }).strict()

// ---------- properties ----------
export const zSdkInfo = z.object({ state: z.enum(SDK_STATES), version: z.string().nullable(), lastHeartbeatAt: zInstant.nullable() })

export const zProperty = z.object({
  id: zId("property"), name: z.string(), platform: z.enum(PLATFORMS), identifier: z.string(), team: z.string(), ownerId: zId("user").nullable(),
  env: z.enum(PROPERTY_ENVS), status: z.enum(PROPERTY_STATUSES), formats: z.array(z.enum(AD_FORMATS)), countryRule: zCountryRule, tags: z.array(z.string()),
  testMode: z.boolean(), sdk: zSdkInfo, createdAt: zInstant, updatedAt: zInstant, rev: z.number().int(),
})
export type Property = z.infer<typeof zProperty>

const APP_ID_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/
export const zPropertyCreate = z
  .strictObject({
    name: zName, platform: z.enum(PLATFORMS), identifier: z.string().trim().toLowerCase().max(253), team: z.string().min(1).max(60),
    ownerId: zId("user").nullable().optional(), env: z.enum(PROPERTY_ENVS).default("production"), formats: z.array(z.enum(AD_FORMATS)).min(1).max(9),
    countryRule: zCountryRule.default({ mode: "all", countries: [] }), tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]), testMode: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    const ok = v.platform === "web" ? DOMAIN_RE.test(v.identifier) : APP_ID_RE.test(v.identifier)
    if (!ok) ctx.addIssue({ code: "custom", path: ["identifier"], message: v.platform === "web" ? "Enter a domain like example.com" : "Enter a package or bundle id like com.company.app" })
  })
export type PropertyCreate = z.infer<typeof zPropertyCreate>

export const zPropertyPatch = z.strictObject({
  rev: z.number().int(), name: zName.optional(), team: z.string().min(1).max(60).optional(), ownerId: zId("user").nullable().optional(), env: z.enum(PROPERTY_ENVS).optional(),
  formats: z.array(z.enum(AD_FORMATS)).min(1).max(9).optional(), countryRule: zCountryRule.optional(), tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  testMode: z.boolean().optional(),
})
export type PropertyPatch = z.infer<typeof zPropertyPatch>

export const zPropertyKey = z.object({
  id: zId("key"), propertyId: zId("property"), label: z.string(), env: z.enum(KEY_ENVS), prefix: z.string(), last4: z.string(), status: z.enum(KEY_STATUSES),
  graceUntil: zInstant.nullable(), createdAt: zInstant, createdBy: zId("user").nullable(), lastUsedAt: zInstant.nullable(), revokedAt: zInstant.nullable(),
})
export type PropertyKey = z.infer<typeof zPropertyKey>
export const zKeyCreate = z.strictObject({ env: z.enum(KEY_ENVS), label: z.string().trim().min(3).max(60) })
/** The only response that ever carries a clear-text secret. */
export const zKeyWithSecret = z.object({ key: zPropertyKey, secret: z.string() })

export const zRequestSample = z.object({
  at: zInstant, propertyId: zId("property"), placementId: z.string().nullable(), placementName: z.string().nullable(), country: z.string(), result: z.string(),
  latencyMs: z.number(), sdk: z.string().nullable(),
})
export type RequestSample = z.infer<typeof zRequestSample>

// ---------- placements ----------
export const zPlacement = z.object({
  id: zId("placement"), propertyId: zId("property"), name: z.string(), format: z.enum(AD_FORMATS), size: z.string(), minAppVersion: z.string().nullable(),
  freqCap: zFreqCap.nullable(), refreshSec: z.number().int().nullable(), status: z.enum(PLACEMENT_STATUSES), createdAt: zInstant, updatedAt: zInstant, rev: z.number().int(),
})
export type Placement = z.infer<typeof zPlacement>
export const zPlacementCreate = z.strictObject({
  propertyId: zId("property"), name: z.string().trim().min(2).max(80), format: z.enum(AD_FORMATS), size: z.string().min(1).max(20),
  minAppVersion: zVersion.nullable().default(null), freqCap: zFreqCap.nullable().default(null), refreshSec: z.number().int().min(15).max(600).nullable().default(null),
  status: z.enum(PLACEMENT_STATUSES).default("active"),
})
export type PlacementCreate = z.infer<typeof zPlacementCreate>
export const zPlacementPatch = zPlacementCreate.omit({ propertyId: true }).partial().extend({ rev: z.number().int() }).strict()
export type PlacementPatch = z.infer<typeof zPlacementPatch>

// ---------- creatives ----------
export const zAsset = z.object({
  kind: z.enum(ASSET_KINDS), url: z.string(), name: z.string(), mime: z.string(), bytes: z.number().int().nonnegative(),
  width: z.number().int().nullable(), height: z.number().int().nullable(), durationSec: z.number().nullable(), sha256: z.string().nullable(),
})
export type Asset = z.infer<typeof zAsset>

export const zCreativeCopy = z.object({ headline: z.string().max(120).default(""), body: z.string().max(300).default(""), cta: z.string().max(30).default("") })
export const zDestination = z.object({
  url: zHttpsUrl.nullable().default(null), deepLink: zDeepLink.nullable().default(null),
  utm: z.object({ source: z.string().max(60).default(""), medium: z.string().max(60).default(""), campaign: z.string().max(60).default("") }).default({ source: "orbit", medium: "", campaign: "" }),
})
export const zCreativeOptions = z.object({
  media: z.enum(MEDIA_TYPES).default("image"), closeDelaySec: z.number().int().min(0).max(30).nullable().default(null), reward: z.string().max(60).nullable().default(null),
  completionEvent: z.string().max(60).nullable().default(null), safeArea: z.boolean().nullable().default(null), closeButton: z.boolean().nullable().default(null),
  freqNotice: z.boolean().nullable().default(null), brandColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#0F766E"),
})
export const zReview = z.object({ state: z.enum(REVIEW_STATES), by: zId("user").nullable(), at: zInstant.nullable(), reason: z.string().nullable() })

export const zCreative = z.object({
  id: zId("creative"), name: z.string(), format: z.enum(AD_FORMATS), size: z.string(), status: z.enum(CREATIVE_STATUSES), ownerId: zId("user").nullable(),
  currentVersion: z.number().int(), assets: z.array(zAsset), copy: zCreativeCopy, destination: zDestination, altText: z.string(), options: zCreativeOptions,
  review: zReview, createdAt: zInstant, updatedAt: zInstant, rev: z.number().int(),
})
export type Creative = z.infer<typeof zCreative>

export const zCreativeInput = z.strictObject({
  name: zName, format: z.enum(AD_FORMATS), size: z.string().max(20).default(""), assets: z.array(zAsset).max(5).default([]),
  copy: zCreativeCopy.default({ headline: "", body: "", cta: "" }), destination: zDestination.default({ url: null, deepLink: null, utm: { source: "orbit", medium: "", campaign: "" } }),
  altText: z.string().max(200).default(""), options: zCreativeOptions.default({} as never),
  /** draft keeps it editable; submit sends it for review (auto-approved when the actor may approve creatives). */
  intent: z.enum(["draft", "submit"]).default("draft"),
})
export type CreativeInput = z.infer<typeof zCreativeInput>
export const zCreativePatch = zCreativeInput.partial().extend({ rev: z.number().int(), note: z.string().max(200).optional() }).strict()
export type CreativePatch = z.infer<typeof zCreativePatch>
export const zRejectInput = z.strictObject({ reason: z.string().trim().min(5).max(300), rev: z.number().int() })

export const zCreativeVersion = z.object({ id: z.string(), creativeId: zId("creative"), v: z.number().int(), by: zId("user").nullable(), byName: z.string().nullable(), note: z.string(), at: zInstant })
export type CreativeVersion = z.infer<typeof zCreativeVersion>

export const zUploadRequest = z.strictObject({ fileName: z.string().min(1).max(200), mime: z.string().regex(/^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm))$/), bytes: z.number().int().min(1).max(50_000_000) })
export const zUploadTicket = z.object({ uploadId: z.string(), method: z.literal("PUT"), url: z.string(), headers: z.record(z.string(), z.string()), publicUrl: z.string(), expiresAt: zInstant })

// ---------- campaigns ----------
export const zTarget = z.object({
  propertyId: zId("property"), countryRule: zCountryRule, placementIds: z.array(zId("placement")).max(100),
  allocationPct: z.number().min(0).max(100).nullable().default(null), destinationOverride: z.string().trim().max(500).nullable().default(null),
})
export type Target = z.infer<typeof zTarget>

export const zConstraints = z.object({
  days: z.array(z.enum(WEEKDAYS)).max(7), hours: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24) }),
  devices: z.array(z.enum(DEVICES)).max(3), minAppVersion: zVersion.nullable(), freqCap: zFreqCap.nullable(), audienceIds: z.array(zId("audience")).max(20),
})
export type Constraints = z.infer<typeof zConstraints>

export const zBudget = z.object({
  amountMicros: zMicros, pacing: z.enum(PACING_MODES), goal: z.object({ type: z.enum(GOAL_TYPES), value: z.number().int().positive() }).nullable(),
})
export type Budget = z.infer<typeof zBudget>

export const zFlight = z.object({ start: zDateKey, end: zDateKey, tz: z.string().min(1).max(60) })
export type Flight = z.infer<typeof zFlight>

export const zHealthIssue = z.object({
  code: z.enum(HEALTH_CODES), message: z.string(), propertyId: z.string().nullable().default(null), creativeId: z.string().nullable().default(null), country: z.string().nullable().default(null),
})
export type HealthIssue = z.infer<typeof zHealthIssue>

export const zCampaign = z.object({
  id: zId("campaign"), name: z.string(), objective: z.enum(OBJECTIVES), status: z.enum(CAMPAIGN_STATUSES),
  health: z.object({ issues: z.array(zHealthIssue), checkedAt: zInstant.nullable() }), ownerId: zId("user").nullable(), team: z.string(), flight: zFlight,
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]), creativeIds: z.array(zId("creative")), targets: z.array(zTarget), constraints: zConstraints, budget: zBudget,
  publishedRev: z.number().int().nullable(), publishedAt: zInstant.nullable(), archivedAt: zInstant.nullable(), createdBy: zId("user").nullable(),
  createdAt: zInstant, updatedAt: zInstant, rev: z.number().int(),
})
export type Campaign = z.infer<typeof zCampaign>

/** Draft payload: shape-valid but possibly incomplete. Publishing runs `validateCampaign` (rules/campaign.ts). */
export const zCampaignInput = z.strictObject({
  name: z.string().trim().max(120), objective: z.enum(OBJECTIVES), team: z.string().min(1).max(60), flight: zFlight,
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2), creativeIds: z.array(zId("creative")).max(20), targets: z.array(zTarget).max(50),
  constraints: zConstraints, budget: zBudget,
})
export type CampaignInput = z.infer<typeof zCampaignInput>
export const zCampaignPatch = zCampaignInput.partial().extend({ rev: z.number().int() }).strict()
export type CampaignPatch = z.infer<typeof zCampaignPatch>
export const zRevOnly = z.strictObject({ rev: z.number().int() })

export const zCampaignStats = z.object({
  campaignId: zId("campaign"),
  lifetime: z.object({ imp: z.number(), clk: z.number(), conv: z.number(), costMicros: z.number() }),
  today: z.object({ d: zDateKey, imp: z.number(), clk: z.number(), conv: z.number(), costMicros: z.number() }),
  updatedAt: zInstant.nullable(),
})
export type CampaignStats = z.infer<typeof zCampaignStats>

export const zCampaignListItem = zCampaign.extend({ stats: zCampaignStats.nullable() })
export type CampaignListItem = z.infer<typeof zCampaignListItem>

export const zCampaignListQuery = zCursorQuery.extend({
  status: z.union([z.enum(CAMPAIGN_STATUSES), z.array(z.enum(CAMPAIGN_STATUSES))]).optional(),
  propertyId: zId("property").optional(), creativeId: zId("creative").optional(), q: z.string().max(100).optional(),
})

export const zValidationIssue = z.object({ step: z.number().int(), key: z.string().nullable(), message: z.string() })
export type ValidationIssue = z.infer<typeof zValidationIssue>
export const zValidationResult = z.object({ errors: z.array(zValidationIssue), warnings: z.array(zValidationIssue) })
export type ValidationResult = z.infer<typeof zValidationResult>

export const zCampaignRevision = z.object({ id: z.string(), campaignId: zId("campaign"), rev: z.number().int(), publishedBy: z.string().nullable(), publishedByName: z.string().nullable(), at: zInstant, diff: z.array(z.string()) })
export type CampaignRevision = z.infer<typeof zCampaignRevision>

export const zMatrixCell = z.object({ propertyId: z.string(), country: z.string(), state: z.enum(["serving", "excluded", "unavailable", "conflict", "disabled"]) })
export const zTargetingMatrix = z.object({ countries: z.array(z.string()), cells: z.array(zMatrixCell) })

// ---------- events, audiences, budgets ----------
export const zEventDefinition = z.object({ key: z.string(), name: z.string(), source: z.enum(EVENT_SOURCES), active: z.boolean(), lastSeenAt: zInstant.nullable(), createdAt: zInstant })
export type EventDefinition = z.infer<typeof zEventDefinition>
export const zEventCreate = z.strictObject({ key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,49}$/, "Use lowercase snake_case, e.g. trial_start"), name: z.string().trim().min(3).max(80), source: z.enum(EVENT_SOURCES) })
export const zEventPatch = z.strictObject({ active: z.boolean().optional(), name: z.string().trim().min(3).max(80).optional() })

export const zAudienceRule = z.object({
  event: z.string(), withinDays: z.number().int().min(1).max(365), exclude: z.object({ event: z.string(), withinDays: z.number().int().min(1).max(365) }).nullable().default(null),
})
export const zAudience = z.object({
  id: zId("audience"), name: z.string(), rule: zAudienceRule, status: z.enum(AUDIENCE_STATUSES), estimate: z.object({ size: z.number().int(), at: zInstant }).nullable(),
  createdBy: z.string().nullable(), createdAt: zInstant, updatedAt: zInstant, rev: z.number().int(),
})
export type Audience = z.infer<typeof zAudience>
export const zAudienceCreate = z.strictObject({ name: zName, rule: zAudienceRule })

export const zBudgetDto = z.object({ team: z.string(), quarter: z.string().regex(/^\d{4}-Q[1-4]$/), amountMicros: zMicros, updatedBy: z.string().nullable(), updatedAt: zInstant, rev: z.number().int() })
export type TeamBudget = z.infer<typeof zBudgetDto>
export const zBudgetPut = z.strictObject({ amountMicros: zMicros, rev: z.number().int().nullable() })

// ---------- audit & alerts ----------
export const zAuditEntry = z.object({
  id: z.string(), at: zInstant, actor: z.object({ id: z.string().nullable(), name: z.string() }), action: z.string(),
  target: z.object({ type: z.string(), id: z.string(), name: z.string() }), detail: z.string(),
})
export type AuditEntry = z.infer<typeof zAuditEntry>
export const zAuditQuery = zCursorQuery.extend({ targetId: z.string().max(60).optional(), action: z.string().max(60).optional(), actorId: z.string().max(60).optional(), from: zDateKey.optional(), to: zDateKey.optional() })

export const zAlert = z.object({
  id: zId("alert"), type: z.enum(ALERT_TYPES), severity: z.enum(ALERT_SEVERITIES), entity: z.object({ type: z.string(), id: z.string() }), status: z.enum(ALERT_STATUSES),
  title: z.string(), message: z.string(), href: z.string(), firstSeenAt: zInstant, lastSeenAt: zInstant, resolvedAt: zInstant.nullable(),
})
export type Alert = z.infer<typeof zAlert>

// ---------- lookups (names for breadcrumbs, search, labels) ----------
export const zLookups = z.object({
  properties: z.array(z.object({ id: z.string(), name: z.string(), platform: z.enum(PLATFORMS), identifier: z.string() })),
  placements: z.array(z.object({ id: z.string(), name: z.string(), propertyId: z.string(), format: z.enum(AD_FORMATS) })),
  creatives: z.array(z.object({ id: z.string(), name: z.string(), format: z.enum(AD_FORMATS), status: z.enum(CREATIVE_STATUSES) })),
  campaigns: z.array(z.object({ id: z.string(), name: z.string(), status: z.enum(CAMPAIGN_STATUSES) })),
  users: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })),
})
export type Lookups = z.infer<typeof zLookups>

// ---------- errors ----------
export const zProblem = z.object({
  type: z.string(), title: z.string(), status: z.number().int(), code: z.string(), detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(), requestId: z.string().optional(), current: z.unknown().optional(),
})
export type Problem = z.infer<typeof zProblem>
