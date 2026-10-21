/**
 * Production enums. Stored lowercase snake_case (guideline §6.2); human labels live in `labels.ts`.
 * Every enum is a const tuple so it can drive Zod (`z.enum(X)`), Mongoose (`enum: X`) and `$jsonSchema`.
 */
export const PLATFORMS = ["android", "ios", "web"] as const
export type Platform = (typeof PLATFORMS)[number]

export const AD_FORMATS = ["banner", "interstitial", "rewarded_video", "native", "app_open", "web_popup", "web_display", "video", "rich_media"] as const
export type AdFormat = (typeof AD_FORMATS)[number]

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "active", "paused", "completed", "archived"] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

export const CREATIVE_STATUSES = ["draft", "in_review", "ready", "rejected", "archived"] as const
export type CreativeStatus = (typeof CREATIVE_STATUSES)[number]

export const PROPERTY_STATUSES = ["active", "paused", "pending"] as const
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number]

export const PLACEMENT_STATUSES = ["active", "paused"] as const
export type PlacementStatus = (typeof PLACEMENT_STATUSES)[number]

export const SDK_STATES = ["healthy", "degraded", "heartbeat_missing", "not_integrated"] as const
export type SdkState = (typeof SDK_STATES)[number]

export const OBJECTIVES = ["awareness", "traffic", "engagement", "conversion"] as const
export type Objective = (typeof OBJECTIVES)[number]

export const COUNTRY_MODES = ["all", "include", "exclude"] as const
export type CountryMode = (typeof COUNTRY_MODES)[number]

export const ROLES = ["owner", "admin", "campaign_manager", "analyst", "developer", "read_only"] as const
export type Role = (typeof ROLES)[number]

export const USER_STATUSES = ["active", "invited", "disabled"] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const DEVICES = ["phone", "tablet", "desktop"] as const
export type Device = (typeof DEVICES)[number]

export const PACING_MODES = ["even", "asap"] as const
export type PacingMode = (typeof PACING_MODES)[number]

export const GOAL_TYPES = ["impressions", "clicks", "conversions"] as const
export type GoalType = (typeof GOAL_TYPES)[number]

export const FREQ_PERIODS = ["hour", "day", "week"] as const
export type FreqPeriod = (typeof FREQ_PERIODS)[number]

export const PROPERTY_ENVS = ["production", "staging"] as const
export type PropertyEnv = (typeof PROPERTY_ENVS)[number]

export const KEY_ENVS = ["live", "test"] as const
export type KeyEnv = (typeof KEY_ENVS)[number]

export const KEY_STATUSES = ["active", "grace", "revoked"] as const
export type KeyStatus = (typeof KEY_STATUSES)[number]

export const EVENT_SOURCES = ["sdk", "server", "web_tag"] as const
export type EventSource = (typeof EVENT_SOURCES)[number]

export const AUDIENCE_STATUSES = ["preview", "draft"] as const
export type AudienceStatus = (typeof AUDIENCE_STATUSES)[number]

export const ALERT_SEVERITIES = ["critical", "warning"] as const
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number]

export const ALERT_STATUSES = ["open", "acked", "resolved"] as const
export type AlertStatus = (typeof ALERT_STATUSES)[number]

export const ALERT_TYPES = ["creative_rejected", "not_delivering", "country_conflict", "sdk_heartbeat_missing", "sdk_degraded", "budget_exhausted", "behind_pace"] as const
export type AlertType = (typeof ALERT_TYPES)[number]

export const REVIEW_STATES = ["none", "pending", "approved", "rejected"] as const
export type ReviewState = (typeof REVIEW_STATES)[number]

export const ASSET_KINDS = ["image", "video", "icon"] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const MEDIA_TYPES = ["image", "video"] as const
export type MediaType = (typeof MEDIA_TYPES)[number]

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** 1 low · 2 normal · 3 high */
export const PRIORITIES = [1, 2, 3] as const
export type Priority = (typeof PRIORITIES)[number]

export const TEAMS = ["Sports", "Utilities", "Lifestyle", "Media", "Entertainment", "Commerce"] as const

export const HEALTH_CODES = ["creative_not_ready", "creative_rejected", "country_conflict", "no_compatible_placement", "property_paused", "sdk_heartbeat_missing", "budget_exhausted"] as const
export type HealthCode = (typeof HEALTH_CODES)[number]

/** Short codes used in high-volume rollup documents (guideline §6.2, field-name length). */
export const DEVICE_CODE: Record<Device, "ph" | "tb" | "dt"> = { phone: "ph", tablet: "tb", desktop: "dt" }
export const DEVICE_FROM_CODE: Record<string, Device> = { ph: "phone", tb: "tablet", dt: "desktop" }
export const PLATFORM_CODE: Record<Platform, "an" | "io" | "wb"> = { android: "an", ios: "io", web: "wb" }
export const PLATFORM_FROM_CODE: Record<string, Platform> = { an: "android", io: "ios", wb: "web" }

/** Campaign statuses that count against team budgets and appear as "live". */
export const LIVE_CAMPAIGN_STATUSES: CampaignStatus[] = ["scheduled", "active", "paused"]
/** Statuses that the serving compiler loads. */
export const SERVABLE_CAMPAIGN_STATUSES: CampaignStatus[] = ["scheduled", "active"]
