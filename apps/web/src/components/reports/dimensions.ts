import type { Dimension } from "@orbit/domain"

/** Breakdown dimensions shown in Overview and Reports. Row labels, sub-labels and links come from the API. */
export type Dim = Dimension

export const DIM_LABEL: Record<Dimension, string> = {
  day: "Day", campaign: "Campaign", property: "App / site", placement: "Placement", creative: "Creative", country: "Country", region: "Region",
  format: "Format", platform: "Platform", device: "Device",
}
