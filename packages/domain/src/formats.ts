import type { AdFormat, Platform } from "./enums"

export interface FormatMeta {
  /** Benchmark CTR (used by the demo generator and forecasts). */
  ctr: number
  /** Internal CPM in USD charged against campaign budgets (guideline §16.3: owned by finance). */
  ecpm: number
  /** Creative sizes, `WxH` or a keyword. */
  sizes: string[]
  desc: string
  platforms: Platform[]
  video?: boolean
  future?: boolean
}

export const FORMAT_META: Record<AdFormat, FormatMeta> = {
  banner: { ctr: 0.006, ecpm: 1.8, sizes: ["320x50", "320x100", "728x90"], desc: "Strip ad anchored in app screens", platforms: ["android", "ios"] },
  interstitial: { ctr: 0.024, ecpm: 7.5, sizes: ["1080x1920", "1920x1080"], desc: "Full-screen ad at natural breaks", platforms: ["android", "ios"] },
  rewarded_video: { ctr: 0.038, ecpm: 12, sizes: ["1080x1920"], desc: "Opt-in video that grants a reward", platforms: ["android", "ios"], video: true },
  native: { ctr: 0.012, ecpm: 3.2, sizes: ["1200x628"], desc: "Matches the look of a feed or list", platforms: ["android", "ios", "web"] },
  app_open: { ctr: 0.015, ecpm: 6, sizes: ["1080x1920"], desc: "Shown while an app launches", platforms: ["android", "ios"] },
  web_popup: { ctr: 0.03, ecpm: 4.5, sizes: ["480x360", "600x400"], desc: "Modal on page load or exit intent", platforms: ["web"] },
  web_display: { ctr: 0.0035, ecpm: 2.2, sizes: ["300x250", "728x90", "300x600", "970x250"], desc: "Standard IAB display slots", platforms: ["web"] },
  video: { ctr: 0.011, ecpm: 9, sizes: ["1920x1080", "1080x1920"], desc: "In-article or in-feed video", platforms: ["android", "ios", "web"], video: true },
  rich_media: { ctr: 0.01, ecpm: 4, sizes: ["320x480", "300x250"], desc: "Interactive HTML5 bundle", platforms: [], future: true },
}

export const APP_ONLY_FORMATS: AdFormat[] = ["banner", "interstitial", "rewarded_video", "app_open"]
export const WEB_ONLY_FORMATS: AdFormat[] = ["web_popup", "web_display"]

/** Formats a property of this platform can enable. */
export function formatsForPlatform(p: Platform): AdFormat[] {
  return (Object.keys(FORMAT_META) as AdFormat[]).filter((f) => FORMAT_META[f].platforms.includes(p))
}

/** Placement slot sizes for a format. Full-screen and fluid formats don't have a pixel size. */
export function placementSizes(f: AdFormat): string[] {
  if (f === "interstitial" || f === "rewarded_video" || f === "app_open") return ["fullscreen"]
  if (f === "native") return ["fluid"]
  if (f === "video") return ["640x360", "1280x720"]
  return FORMAT_META[f]?.sizes ?? []
}

/** Formats where a creative must match the placement's pixel size exactly. */
export const SIZED_FORMATS: AdFormat[] = ["banner", "web_display", "web_popup"]

export function sizeLabel(size: string) {
  if (size === "fullscreen") return "Full screen"
  if (size === "fluid") return "Fluid"
  return size.replace("x", "×")
}

export function isVideoFormat(f: AdFormat) {
  return !!FORMAT_META[f]?.video
}
