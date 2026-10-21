import type {
  AdFormat, AlertSeverity, AudienceStatus, CampaignStatus, CountryMode, CreativeStatus, Device, EventSource, FreqPeriod, GoalType, KeyEnv, KeyStatus, Objective,
  PacingMode, Platform, PlacementStatus, Priority, PropertyEnv, PropertyStatus, Role, SdkState, UserStatus, Weekday,
} from "./enums"

/** Display labels for every enum. The UI never shows raw enum values. */
export const PLATFORM_LABEL: Record<Platform, string> = { android: "Android", ios: "iOS", web: "Web" }
export const FORMAT_LABEL: Record<AdFormat, string> = {
  banner: "Banner", interstitial: "Interstitial", rewarded_video: "Rewarded Video", native: "Native", app_open: "App Open",
  web_popup: "Web Popup", web_display: "Web Display", video: "Video", rich_media: "HTML / Rich Media",
}
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus | "needs_attention", string> = {
  draft: "Draft", scheduled: "Scheduled", active: "Active", paused: "Paused", completed: "Completed", archived: "Archived", needs_attention: "Needs Attention",
}
export const CREATIVE_STATUS_LABEL: Record<CreativeStatus, string> = { draft: "Draft", in_review: "In Review", ready: "Ready", rejected: "Rejected", archived: "Archived" }
export const PROPERTY_STATUS_LABEL: Record<PropertyStatus, string> = { active: "Active", paused: "Paused", pending: "Pending" }
export const PLACEMENT_STATUS_LABEL: Record<PlacementStatus, string> = { active: "Active", paused: "Paused" }
export const SDK_STATE_LABEL: Record<SdkState, string> = { healthy: "Healthy", degraded: "Degraded", heartbeat_missing: "Heartbeat missing", not_integrated: "Not integrated" }
export const OBJECTIVE_LABEL: Record<Objective, string> = { awareness: "Awareness", traffic: "Traffic", engagement: "Engagement", conversion: "Conversion" }
export const COUNTRY_MODE_LABEL: Record<CountryMode, string> = { all: "All available", include: "Include only", exclude: "Exclude" }
export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner", admin: "Admin", campaign_manager: "Campaign Manager", analyst: "Analyst", developer: "Developer", read_only: "Read-only",
}
export const USER_STATUS_LABEL: Record<UserStatus, string> = { active: "Active", invited: "Invited", disabled: "Disabled" }
export const DEVICE_LABEL: Record<Device, string> = { phone: "Phone", tablet: "Tablet", desktop: "Desktop" }
export const PACING_LABEL: Record<PacingMode, string> = { even: "Even", asap: "ASAP" }
export const GOAL_TYPE_LABEL: Record<GoalType, string> = { impressions: "Impressions", clicks: "Clicks", conversions: "Conversions" }
export const FREQ_PERIOD_LABEL: Record<FreqPeriod, string> = { hour: "hour", day: "day", week: "week" }
export const PROPERTY_ENV_LABEL: Record<PropertyEnv, string> = { production: "Production", staging: "Staging" }
export const KEY_ENV_LABEL: Record<KeyEnv, string> = { live: "Live", test: "Test" }
export const KEY_STATUS_LABEL: Record<KeyStatus, string> = { active: "Active", grace: "Grace period", revoked: "Revoked" }
export const EVENT_SOURCE_LABEL: Record<EventSource, string> = { sdk: "SDK", server: "Server", web_tag: "Web tag" }
export const AUDIENCE_STATUS_LABEL: Record<AudienceStatus, string> = { preview: "Preview", draft: "Draft" }
export const ALERT_SEVERITY_LABEL: Record<AlertSeverity, string> = { critical: "Critical", warning: "Warning" }
export const PRIORITY_LABEL: Record<Priority, string> = { 1: "Low", 2: "Normal", 3: "High" }
export const WEEKDAY_LABEL: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" }
