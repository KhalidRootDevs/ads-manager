/** Format-specific creative validation, shared by the creative wizard, the detail page and the API. */
import type { AdFormat } from "../enums"
import { APP_ONLY_FORMATS, FORMAT_META, SIZED_FORMATS } from "../formats"
import type { Creative, CreativeInput } from "../schemas"

export interface Check {
  key: string
  label: string
  ok: boolean
  detail: string
}

export const isHttpsUrl = (s: string | null | undefined) => !!s && /^https:\/\/[^\s/]+\.[^\s]+/.test(s.trim())
export const isDeepLink = (s: string | null | undefined) => !!s && /^[a-z][a-z0-9+.-]*:\/\/\S+/i.test(s.trim())

export const CLOSE_DELAY_MAX_SEC = 5
export const NATIVE_TITLE_MAX = 40
export const NATIVE_BODY_MAX = 90
export const COMPLETION_EVENTS = ["video_complete", "reward_granted", "level_unlocked"]

type CreativeLike = Pick<Creative, "name" | "format" | "size" | "assets" | "copy" | "destination" | "altText" | "options"> | Pick<CreativeInput, "name" | "format" | "size" | "assets" | "copy" | "destination" | "altText" | "options">

const asset = (c: CreativeLike, kind: "image" | "video" | "icon") => c.assets.find((a) => a.kind === kind)
const mainAsset = (c: CreativeLike) => asset(c, "video") ?? asset(c, "image")

/** Checklist shown in the wizard's Validate step and on the creative page. All checks must pass to submit. */
export function creativeChecks(c: CreativeLike): Check[] {
  const out: Check[] = []
  const add = (key: string, label: string, ok: unknown, detail = "") => out.push({ key, label, ok: !!ok, detail })
  const f = c.format
  const o = c.options
  add("name", "Name", c.name.trim().length >= 3, "At least 3 characters")
  if (f === "rich_media") {
    add("rich_media", "Rich media support", false, "The SDK can’t render HTML creatives yet. Save as Draft to keep the work.")
    return out
  }
  if (SIZED_FORMATS.includes(f) && f !== "web_popup") {
    add("size", "Dimensions", !!c.size, c.size ? `${c.size} matches an IAB / SDK slot` : "Choose a size")
    add("asset", "Image asset", asset(c, "image"), asset(c, "image")?.name ?? "PNG, JPG or GIF, max 150 KB")
    add("alt", "Alt text", c.altText.trim(), "Describe the image for screen readers")
  }
  if (f === "interstitial") {
    add("asset", "Full-screen media", mainAsset(c), `${o.media === "video" ? "Video" : "Image"} at 1080×1920 or 1920×1080`)
    add("close", "Close behavior", (o.closeDelaySec ?? 0) <= CLOSE_DELAY_MAX_SEC, `Close button appears after ${o.closeDelaySec ?? 0}s (max ${CLOSE_DELAY_MAX_SEC}s)`)
    add("headline", "Headline", c.copy.headline.trim(), "Required")
  }
  if (f === "rewarded_video") {
    add("asset", "Video asset", asset(c, "video"), "MP4, 15–30 seconds")
    add("reward", "Reward label", (o.reward ?? "").trim(), "Shown before and after the video")
    add("event", "Completion event", o.completionEvent, `Fires ${o.completionEvent ?? "an event"} to grant the reward`)
  }
  if (f === "native") {
    add("icon", "Icon", asset(c, "icon"), "128×128 PNG, no transparent padding")
    add("asset", "Main image", asset(c, "image"), "1200×628")
    add("title", `Title ≤ ${NATIVE_TITLE_MAX} characters`, c.copy.headline.trim() && c.copy.headline.length <= NATIVE_TITLE_MAX, `${c.copy.headline.length} / ${NATIVE_TITLE_MAX}`)
    add("body", `Body ≤ ${NATIVE_BODY_MAX} characters`, c.copy.body.trim() && c.copy.body.length <= NATIVE_BODY_MAX, `${c.copy.body.length} / ${NATIVE_BODY_MAX}`)
    add("cta", "CTA", c.copy.cta.trim(), "e.g. Install, Learn more")
  }
  if (f === "app_open") {
    add("asset", "Portrait asset", mainAsset(c), "1080×1920")
    add("safe_area", "Screen-safe content", o.safeArea, "Logo and text sit inside the safe area")
  }
  if (f === "web_popup") {
    add("headline", "Modal headline", c.copy.headline.trim(), "Required")
    add("close_button", "Close button visible", o.closeButton, "Required on every web modal")
    add("freq_notice", "Frequency-cap notice", o.freqNotice, "Shown at most once per visitor per day")
  }
  if (f === "video") add("asset", "Video asset", asset(c, "video"), "MP4 or WebM, max 30 seconds")
  const d = c.destination
  add("destination", "Destination", isHttpsUrl(d.url) || isDeepLink(d.deepLink), d.url || d.deepLink || "An https URL or an app deep link (scheme://path)")
  return out
}

export function checksPass(c: CreativeLike): boolean {
  return creativeChecks(c).every((x) => x.ok)
}

/** Formats where the size must be chosen explicitly. */
export function hasSizeChoice(f: AdFormat | "") {
  if (!f) return false
  return FORMAT_META[f].sizes.length > 1 || f === "banner" || f === "web_display"
}
export const isAppFormat = (f: AdFormat | "") => !!f && APP_ONLY_FORMATS.includes(f)
/** Formats that can carry an in-app deep link. */
export const allowsDeepLink = (f: AdFormat | "") => isAppFormat(f) || f === "native" || f === "video"
export const isVideoCreative = (c: { format: AdFormat; options: { media: string } }) => c.format === "rewarded_video" || c.format === "video" || (c.format === "interstitial" && c.options.media === "video")

export function utmString(utm: { source: string; medium: string; campaign: string }) {
  return ([["utm_source", utm.source], ["utm_medium", utm.medium], ["utm_campaign", utm.campaign]] as const)
    .filter((x) => x[1].trim())
    .map((x) => `${x[0]}=${encodeURIComponent(x[1].trim())}`)
    .join("&")
}

/** Destination with UTM parameters applied: what the click redirect sends the user to. */
export function finalUrl(d: { url: string | null; deepLink: string | null; utm: { source: string; medium: string; campaign: string } }) {
  const q = utmString(d.utm)
  const base = (d.url ?? "").trim()
  if (base) return base + (q ? (base.includes("?") ? "&" : "?") + q : "")
  const deep = (d.deepLink ?? "").trim()
  if (deep) return deep + (q ? (deep.includes("?") ? "&" : "?") + q : "")
  return ""
}

export function destinationType(d: { url: string | null; deepLink: string | null }): "deep_link" | "web_url" | "missing" {
  return d.deepLink ? "deep_link" : d.url ? "web_url" : "missing"
}
