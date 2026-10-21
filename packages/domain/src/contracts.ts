/**
 * Admin API contract (guideline §7.2). One entry per endpoint: the Express routers validate against it,
 * `@orbit/api-client` derives typed calls from it, and the OpenAPI document is generated from it.
 */
import { z } from "zod"
import { zDeliveryQuery, zDeliveryResult, zHeatmapQuery, zHeatmapResult, zNoFillQuery, zNoFillResult } from "./analytics"
import type { Permission } from "./rbac"
import * as s from "./schemas"

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE"

export interface Endpoint {
  method: Method
  path: string
  summary: string
  /** Required permission beyond being signed in. Omitted = any authenticated user. `public` = no session. */
  permission?: Permission | "public"
  query?: z.ZodType
  body?: z.ZodType
  response: z.ZodType
  /** success status (default 200) */
  status?: number
  /** send Idempotency-Key */
  idempotent?: boolean
}

const ok = z.object({ ok: z.literal(true) })
const e = <const T extends Endpoint>(x: T) => x

export const endpoints = {
  // ---------- auth ----------
  me: e({ method: "GET", path: "/v1/me", summary: "Current user and permissions", response: s.zMe }),
  devLogin: e({ method: "POST", path: "/v1/auth/dev-login", summary: "Development sign-in by email (disabled in production)", permission: "public", body: s.zDevLoginInput, response: s.zMe }),
  logout: e({ method: "POST", path: "/v1/auth/logout", summary: "Sign out", response: ok }),
  lookups: e({ method: "GET", path: "/v1/lookups", summary: "Names of all entities for labels, breadcrumbs and search", response: s.zLookups }),

  // ---------- team ----------
  listTeam: e({ method: "GET", path: "/v1/team", summary: "Team members", response: s.zList(s.zUser) }),
  inviteMember: e({ method: "POST", path: "/v1/team", summary: "Invite a member", permission: "team.manage", body: s.zInviteInput, response: s.zUser, status: 201 }),
  changeRole: e({ method: "PATCH", path: "/v1/team/:id", summary: "Change a member's role", permission: "team.manage", body: s.zRoleChangeInput, response: s.zUser }),
  removeMember: e({ method: "DELETE", path: "/v1/team/:id", summary: "Remove a member or cancel an invite", permission: "team.manage", response: ok }),

  // ---------- settings & reference data ----------
  getSettings: e({ method: "GET", path: "/v1/settings", summary: "Global settings", response: s.zSettings }),
  putSettings: e({ method: "PUT", path: "/v1/settings", summary: "Update global settings", permission: "settings.write", body: s.zSettingsInput, response: s.zSettings }),
  listCountries: e({ method: "GET", path: "/v1/countries", summary: "Countries and their platform-wide availability", response: s.zList(s.zCountryDto) }),
  patchCountry: e({ method: "PATCH", path: "/v1/countries/:code", summary: "Enable or disable a country platform-wide", permission: "settings.write", body: s.zCountryPatch, response: s.zCountryDto }),
  listEvents: e({ method: "GET", path: "/v1/events", summary: "Conversion event definitions", response: s.zList(s.zEventDefinition) }),
  createEvent: e({ method: "POST", path: "/v1/events", summary: "Add a conversion event", permission: "events.write", body: s.zEventCreate, response: s.zEventDefinition, status: 201 }),
  patchEvent: e({ method: "PATCH", path: "/v1/events/:key", summary: "Activate, deactivate or rename an event", permission: "events.write", body: s.zEventPatch, response: s.zEventDefinition }),
  listAudiences: e({ method: "GET", path: "/v1/audiences", summary: "Audience segments", response: s.zList(s.zAudience) }),
  createAudience: e({ method: "POST", path: "/v1/audiences", summary: "Create an audience", permission: "audiences.write", body: s.zAudienceCreate, response: s.zAudience, status: 201 }),
  deleteAudience: e({ method: "DELETE", path: "/v1/audiences/:id", summary: "Delete an audience and remove it from campaigns", permission: "audiences.write", response: ok }),
  listBudgets: e({ method: "GET", path: "/v1/budgets", summary: "Team budgets for a quarter", query: z.object({ quarter: z.string().regex(/^\d{4}-Q[1-4]$/).optional() }), response: s.zList(s.zBudgetDto) }),
  putBudget: e({ method: "PUT", path: "/v1/budgets/:team/:quarter", summary: "Set a team's quarterly budget", permission: "budgets.write", body: s.zBudgetPut, response: s.zBudgetDto }),

  // ---------- properties ----------
  listProperties: e({ method: "GET", path: "/v1/properties", summary: "All apps and websites", response: s.zList(s.zProperty) }),
  createProperty: e({ method: "POST", path: "/v1/properties", summary: "Register an app or website (creates a test key, returned once)", permission: "properties.write", body: s.zPropertyCreate, response: z.object({ property: s.zProperty, testKey: s.zKeyWithSecret }), status: 201, idempotent: true }),
  getProperty: e({ method: "GET", path: "/v1/properties/:id", summary: "One property", response: s.zProperty }),
  patchProperty: e({ method: "PATCH", path: "/v1/properties/:id", summary: "Update a property", permission: "properties.write", body: s.zPropertyPatch, response: s.zProperty }),
  pauseProperty: e({ method: "POST", path: "/v1/properties/:id/pause", summary: "Pause all serving on a property", permission: "properties.write", body: s.zRevOnly, response: s.zProperty }),
  activateProperty: e({ method: "POST", path: "/v1/properties/:id/activate", summary: "Activate a property", permission: "properties.write", body: s.zRevOnly, response: s.zProperty }),
  listKeys: e({ method: "GET", path: "/v1/properties/:id/keys", summary: "SDK keys (hashes never leave the server)", response: s.zList(s.zPropertyKey) }),
  createKey: e({ method: "POST", path: "/v1/properties/:id/keys", summary: "Create a key; the secret is returned once", permission: "keys.manage", body: s.zKeyCreate, response: s.zKeyWithSecret, status: 201, idempotent: true }),
  rotateKey: e({ method: "POST", path: "/v1/properties/:id/keys/:keyId/rotate", summary: "Rotate a key; the old one keeps working for 24 h", permission: "keys.manage", response: s.zKeyWithSecret, idempotent: true }),
  revokeKey: e({ method: "POST", path: "/v1/properties/:id/keys/:keyId/revoke", summary: "Revoke a key immediately", permission: "keys.manage", response: s.zPropertyKey }),
  testRequest: e({ method: "POST", path: "/v1/properties/:id/test-request", summary: "Send a test ad request through the ad server", permission: "properties.write", response: s.zRequestSample }),
  diagnostics: e({ method: "GET", path: "/v1/properties/:id/diagnostics", summary: "Latest request samples (24 h)", response: s.zList(s.zRequestSample) }),

  // ---------- placements ----------
  listPlacements: e({ method: "GET", path: "/v1/placements", summary: "All placements", query: z.object({ propertyId: s.zId("property").optional() }), response: s.zList(s.zPlacement) }),
  createPlacement: e({ method: "POST", path: "/v1/placements", summary: "Create a placement", permission: "properties.write", body: s.zPlacementCreate, response: s.zPlacement, status: 201 }),
  getPlacement: e({ method: "GET", path: "/v1/placements/:id", summary: "One placement", response: s.zPlacement }),
  patchPlacement: e({ method: "PATCH", path: "/v1/placements/:id", summary: "Update a placement", permission: "properties.write", body: s.zPlacementPatch, response: s.zPlacement }),

  // ---------- creatives ----------
  listCreatives: e({ method: "GET", path: "/v1/creatives", summary: "Creative library", query: z.object({ q: z.string().max(100).optional(), includeArchived: z.coerce.boolean().optional() }), response: s.zList(s.zCreative) }),
  createCreative: e({ method: "POST", path: "/v1/creatives", summary: "Create a creative", permission: "creatives.write", body: s.zCreativeInput, response: s.zCreative, status: 201, idempotent: true }),
  getCreative: e({ method: "GET", path: "/v1/creatives/:id", summary: "One creative", response: s.zCreative }),
  patchCreative: e({ method: "PATCH", path: "/v1/creatives/:id", summary: "Edit a creative (creates a version)", permission: "creatives.write", body: s.zCreativePatch, response: s.zCreative }),
  submitCreative: e({ method: "POST", path: "/v1/creatives/:id/submit", summary: "Submit for review", permission: "creatives.write", body: s.zRevOnly, response: s.zCreative }),
  approveCreative: e({ method: "POST", path: "/v1/creatives/:id/approve", summary: "Approve: the creative becomes ready", permission: "creatives.approve", body: s.zRevOnly, response: s.zCreative }),
  rejectCreative: e({ method: "POST", path: "/v1/creatives/:id/reject", summary: "Reject with a reason", permission: "creatives.approve", body: s.zRejectInput, response: s.zCreative }),
  archiveCreative: e({ method: "POST", path: "/v1/creatives/:id/archive", summary: "Archive", permission: "creatives.write", body: s.zRevOnly, response: s.zCreative }),
  restoreCreative: e({ method: "POST", path: "/v1/creatives/:id/restore", summary: "Restore to draft", permission: "creatives.write", body: s.zRevOnly, response: s.zCreative }),
  duplicateCreative: e({ method: "POST", path: "/v1/creatives/:id/duplicate", summary: "Duplicate as a draft", permission: "creatives.write", response: s.zCreative, status: 201, idempotent: true }),
  creativeVersions: e({ method: "GET", path: "/v1/creatives/:id/versions", summary: "Version history", response: s.zList(s.zCreativeVersion) }),
  createUpload: e({ method: "POST", path: "/v1/uploads", summary: "Get a pre-signed upload URL for a creative asset", permission: "creatives.write", body: s.zUploadRequest, response: s.zUploadTicket, status: 201 }),

  // ---------- campaigns ----------
  listCampaigns: e({ method: "GET", path: "/v1/campaigns", summary: "Campaigns, newest first, cursor-paginated", query: s.zCampaignListQuery, response: s.zPage(s.zCampaignListItem) }),
  campaignCounts: e({ method: "GET", path: "/v1/campaigns/counts", summary: "Campaign counts per status (list tabs)", response: z.object({ counts: z.record(z.string(), z.number()), needsAttention: z.number() }) }),
  createCampaign: e({ method: "POST", path: "/v1/campaigns", summary: "Create a draft campaign", permission: "campaigns.write", body: s.zCampaignInput, response: s.zCampaign, status: 201, idempotent: true }),
  getCampaign: e({ method: "GET", path: "/v1/campaigns/:id", summary: "One campaign with stats", response: s.zCampaignListItem }),
  patchCampaign: e({ method: "PATCH", path: "/v1/campaigns/:id", summary: "Edit a campaign (drafts, or a live campaign before republishing)", permission: "campaigns.write", body: s.zCampaignPatch, response: s.zCampaign }),
  validateCampaign: e({ method: "POST", path: "/v1/campaigns/:id/validate", summary: "Blocking errors and warnings (same as the wizard's Review step)", response: s.zValidationResult }),
  validateDraft: e({ method: "POST", path: "/v1/campaigns/validate", summary: "Validate an unsaved campaign payload", body: s.zCampaignInput.extend({ id: s.zId("campaign").optional() }), response: s.zValidationResult }),
  publishCampaign: e({ method: "POST", path: "/v1/campaigns/:id/publish", summary: "Publish (transaction: campaign + revision + audit)", permission: "campaigns.publish", body: s.zRevOnly, response: s.zCampaign, idempotent: true }),
  pauseCampaign: e({ method: "POST", path: "/v1/campaigns/:id/pause", summary: "Pause", permission: "campaigns.publish", body: s.zRevOnly, response: s.zCampaign }),
  resumeCampaign: e({ method: "POST", path: "/v1/campaigns/:id/resume", summary: "Resume", permission: "campaigns.publish", body: s.zRevOnly, response: s.zCampaign }),
  archiveCampaign: e({ method: "POST", path: "/v1/campaigns/:id/archive", summary: "Archive (frees the name)", permission: "campaigns.publish", body: s.zRevOnly, response: s.zCampaign }),
  restoreCampaign: e({ method: "POST", path: "/v1/campaigns/:id/restore", summary: "Restore an archived campaign as a draft", permission: "campaigns.publish", body: s.zRevOnly, response: s.zCampaign }),
  duplicateCampaign: e({ method: "POST", path: "/v1/campaigns/:id/duplicate", summary: "Duplicate as a draft", permission: "campaigns.write", response: s.zCampaign, status: 201, idempotent: true }),
  campaignRevisions: e({ method: "GET", path: "/v1/campaigns/:id/revisions", summary: "Publish history", response: s.zList(s.zCampaignRevision) }),
  targetingMatrix: e({ method: "GET", path: "/v1/campaigns/:id/targeting-matrix", summary: "Property × country serving matrix", response: s.zTargetingMatrix }),

  // ---------- analytics ----------
  analyticsDelivery: e({ method: "POST", path: "/v1/analytics/delivery", summary: "Totals, comparison and grouped rows", body: zDeliveryQuery, response: zDeliveryResult }),
  analyticsHeatmap: e({ method: "POST", path: "/v1/analytics/heatmap", summary: "Weekday × hour matrix", body: zHeatmapQuery, response: zHeatmapResult }),
  analyticsNoFill: e({ method: "POST", path: "/v1/analytics/no-fill", summary: "No-fill reasons and latency", body: zNoFillQuery, response: zNoFillResult }),
  analyticsExport: e({ method: "POST", path: "/v1/analytics/export.csv", summary: "CSV export (streamed)", permission: "reports.export", body: zDeliveryQuery, response: z.string() }),

  // ---------- ops ----------
  listAlerts: e({ method: "GET", path: "/v1/alerts", summary: "Open alerts", response: s.zList(s.zAlert) }),
  ackAlert: e({ method: "POST", path: "/v1/alerts/:id/ack", summary: "Acknowledge an alert", permission: "alerts.ack", response: s.zAlert }),
  listAudit: e({ method: "GET", path: "/v1/audit", summary: "Audit log and activity feed, newest first", query: s.zAuditQuery, response: s.zPage(s.zAuditEntry) }),
} satisfies Record<string, Endpoint>

export type Endpoints = typeof endpoints
export type EndpointName = keyof Endpoints
export type Res<N extends EndpointName> = z.infer<Endpoints[N]["response"]>
export type Body<N extends EndpointName> = Endpoints[N] extends { body: infer B extends z.ZodType } ? z.input<B> : never
export type Query<N extends EndpointName> = Endpoints[N] extends { query: infer Q extends z.ZodType } ? z.input<Q> : never

/** Fill `:params` in a path. */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_, k: string) => {
    const v = params[k]
    if (v == null) throw new Error(`Missing path param ${k} for ${path}`)
    return encodeURIComponent(v)
  })
}
