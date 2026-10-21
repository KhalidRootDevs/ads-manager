import type { Audience } from "@orbit/domain"

/** "trial_start in the last 30 days, excluding purchase in the last 30 days" */
export function ruleText(r: Pick<Audience["rule"], "event" | "withinDays"> & { exclude?: Audience["rule"]["exclude"] }): string {
  const base = `${r.event} in the last ${r.withinDays || "N"} days`
  return r.exclude ? `${base}, excluding ${r.exclude.event} in the last ${r.exclude.withinDays || "N"} days` : base
}
