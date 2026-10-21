import {
  CAMPAIGN_STATUS_LABEL, needsAttention, PLATFORM_LABEL, WEEKDAY_LABEL, WEEKDAYS, type Campaign, type CampaignStats, type CampaignStatus, type Constraints, type Objective,
  type Property, type Weekday,
} from "@orbit/domain"
import { fmt } from "@/lib/format"

export const OBJECTIVES: { value: Objective; desc: string }[] = [
  { value: "awareness", desc: "Maximize reach and impressions" },
  { value: "traffic", desc: "Drive taps to a screen or page" },
  { value: "engagement", desc: "Rewarded unlocks, video views, signups" },
  { value: "conversion", desc: "Optimize toward a tracked event" },
]

export const TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Dhaka", label: "Asia/Dhaka (UTC+6)" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (UTC+5:30)" },
  { value: "Asia/Riyadh", label: "Asia/Riyadh (UTC+3)" },
  { value: "Europe/London", label: "Europe/London (UTC+1)" },
  { value: "America/New_York", label: "America/New_York (UTC−4)" },
  { value: "UTC", label: "UTC" },
]

/** Delivery-hour presets (campaign time zone). `to` is exclusive: 0–24 is all day. */
export const HOUR_PRESETS: { value: string; label: string; from: number; to: number }[] = [
  { value: "all", label: "All day", from: 0, to: 24 },
  { value: "day", label: "06:00–23:00", from: 6, to: 23 },
  { value: "evening", label: "Evenings 18:00–23:00", from: 18, to: 23 },
]

export type StatusTab = "all" | CampaignStatus | "needs_attention"

export const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "needs_attention", label: CAMPAIGN_STATUS_LABEL.needs_attention },
  { value: "scheduled", label: "Scheduled" },
  { value: "paused", label: "Paused" },
  { value: "draft", label: "Draft" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
]

/** Status shown in badges: "needs_attention" for active campaigns with health issues. */
export function displayStatus(c: Pick<Campaign, "status" | "health">): CampaignStatus | "needs_attention" {
  return needsAttention(c) ? "needs_attention" : c.status
}

const ZERO = { imp: 0, clk: 0, conv: 0, costMicros: 0 }

/** Lifetime delivery totals (zeros before the first impression). */
export function lifetime(stats: CampaignStats | null | undefined) {
  return stats?.lifetime ?? ZERO
}

/** Delivered value for the campaign's goal type (impressions by default). */
export function goalValue(c: Pick<Campaign, "budget">, stats: CampaignStats | null | undefined) {
  const l = lifetime(stats)
  const t = c.budget.goal?.type ?? "impressions"
  return t === "impressions" ? l.imp : t === "clicks" ? l.clk : l.conv
}

export function flight(c: { flight: { start: string; end: string } }) {
  return fmt.range(c.flight.start, c.flight.end)
}

export function plural(n: number, one: string, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`
}

export function daysLabel(days: Weekday[]) {
  if (days.length === 7) return "Every day"
  if (!days.length) return "—"
  const set = new Set(days)
  if (days.length === 5 && WEEKDAYS.slice(0, 5).every((d) => set.has(d))) return "Weekdays"
  if (days.length === 2 && set.has("sat") && set.has("sun")) return "Weekends"
  return WEEKDAYS.filter((d) => set.has(d)).map((d) => WEEKDAY_LABEL[d]).join(", ")
}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`
export function hoursLabel(h: Constraints["hours"]) {
  if (h.from === 0 && h.to === 24) return "All day"
  return `${hh(h.from)}–${hh(h.to)}`
}

export function freqLabel(f: Constraints["freqCap"]) {
  return f ? `${f.count} / ${f.per}` : "None"
}

/** Distinct platform labels of the campaign's properties. */
export function platformsOf(c: Pick<Campaign, "targets">, propById: Record<string, Property>) {
  return [...new Set(c.targets.map((t) => propById[t.propertyId]?.platform).filter(Boolean))].map((p) => PLATFORM_LABEL[p!])
}
