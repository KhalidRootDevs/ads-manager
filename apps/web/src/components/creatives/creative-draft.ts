/**
 * Creative wizard draft ⇄ API payload mapping. UI-only: every rule (checks, URL formats, deep-link support)
 * comes from `@orbit/domain`, the same code the API runs on submit.
 */
import {
  allowsDeepLink, CLOSE_DELAY_MAX_SEC, creativeChecks, FORMAT_META, hasSizeChoice, isDeepLink, isHttpsUrl, isVideoCreative,
  type AdFormat, type Asset, type Creative, type CreativeInput, type CreativeStatus,
} from "@orbit/domain"

/** Editable state of the creative wizard. Assets are real uploads (or reused library assets). */
export interface CreativeDraft {
  format: AdFormat | ""
  name: string
  size: string
  /** main image or video */
  asset: Asset | null
  icon: Asset | null
  color: string
  headline: string
  body: string
  cta: string
  url: string
  deepLink: string
  utmS: string
  utmM: string
  utmC: string
  alt: string
  reward: string
  event: string
  closeDelay: string
  media: "image" | "video"
  closeBtn: boolean
  freqNotice: boolean
  safeArea: boolean
}

export type CreativeContent = Omit<CreativeInput, "intent">

export const PLACEHOLDER_COLORS = ["#0F766E", "#3730A3", "#9A3412", "#1D4ED8", "#9F1239", "#334155"]
export const CLOSE_DELAYS = ["0", "3", "5", "10"]
export const STEPS = ["Format", "Assets & copy", "Preview", "Destination", "Validate & save"]
export const DEFAULT_CTA = "Learn more"

/** Client-side upload limits (the API enforces the same and sniffs file bytes). */
export const UPLOAD_LIMITS = { image: 1_000_000, video: 50_000_000 } as const
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
export const VIDEO_MIMES = ["video/mp4", "video/webm"]

export function newDraft(): CreativeDraft {
  return {
    format: "", name: "", size: "", asset: null, icon: null, color: PLACEHOLDER_COLORS[0], headline: "", body: "", cta: "", url: "", deepLink: "",
    utmS: "orbit", utmM: "", utmC: "", alt: "", reward: "", event: "video_complete", closeDelay: "5", media: "image", closeBtn: true, freqNotice: true, safeArea: false,
  }
}

export function draftFrom(c: Creative): CreativeDraft {
  const o = c.options
  return {
    ...newDraft(),
    format: c.format, name: c.name, size: c.size,
    asset: c.assets.find((a) => a.kind === "video") ?? c.assets.find((a) => a.kind === "image") ?? null,
    icon: c.assets.find((a) => a.kind === "icon") ?? null,
    color: o.brandColor, headline: c.copy.headline, body: c.copy.body, cta: c.copy.cta, url: c.destination.url ?? "", deepLink: c.destination.deepLink ?? "",
    utmS: c.destination.utm.source, utmM: c.destination.utm.medium, utmC: c.destination.utm.campaign, alt: c.altText,
    reward: o.reward ?? "", event: o.completionEvent ?? "video_complete", closeDelay: String(o.closeDelaySec ?? 5), media: o.media,
    closeBtn: o.closeButton !== false, freqNotice: o.freqNotice !== false, safeArea: !!o.safeArea,
  }
}

export const isVideoDraft = (w: Pick<CreativeDraft, "format" | "media">) => !!w.format && isVideoCreative({ format: w.format, options: { media: w.media } })

/** Draft → the content part of `zCreativeInput` / `zCreativePatch`. Format-specific options are null when they don't apply. */
export function toContent(w: CreativeDraft): CreativeContent {
  const f = (w.format || "banner") as AdFormat
  const trim = (s: string) => s.trim()
  const assets: Asset[] = []
  if (w.asset) assets.push(w.asset)
  if (f === "native" && w.icon) assets.push(w.icon)
  return {
    name: trim(w.name),
    format: f,
    size: w.size || FORMAT_META[f].sizes[0] || "",
    assets,
    copy: { headline: trim(w.headline), body: trim(w.body), cta: trim(w.cta) || (f === "native" ? "" : DEFAULT_CTA) },
    destination: {
      url: trim(w.url) || null,
      deepLink: allowsDeepLink(f) ? trim(w.deepLink) || null : null,
      utm: { source: trim(w.utmS), medium: trim(w.utmM), campaign: trim(w.utmC) },
    },
    altText: trim(w.alt),
    options: {
      media: isVideoDraft({ format: f, media: w.media }) ? "video" : "image",
      closeDelaySec: f === "interstitial" ? Number(w.closeDelay) : null,
      reward: f === "rewarded_video" ? trim(w.reward) || null : null,
      completionEvent: f === "rewarded_video" ? w.event || null : null,
      safeArea: f === "app_open" ? w.safeArea : null,
      closeButton: f === "web_popup" ? w.closeBtn : null,
      freqNotice: f === "web_popup" ? w.freqNotice : null,
      brandColor: w.color,
    },
  }
}

/** Only the content keys that differ from the saved creative (PATCH sends changed keys + rev). */
export function changedContent(before: Creative, next: CreativeContent): Partial<CreativeContent> {
  const out: Partial<CreativeContent> = {}
  for (const k of Object.keys(next) as (keyof CreativeContent)[]) {
    if (JSON.stringify(next[k]) !== JSON.stringify(before[k])) (out as Record<string, unknown>)[k] = next[k]
  }
  return out
}

export function checksFor(w: CreativeDraft) {
  if (!w.format) return [{ key: "format", label: "Format", ok: false, detail: "Choose a format" }]
  return creativeChecks(toContent(w))
}

export const needsAsset = (f: AdFormat | "") => !!f && f !== "web_popup" && f !== "rich_media"

/** Blocking error for leaving step `n`. */
export function stepError(w: CreativeDraft, n: number): string {
  if (n === 1 && !w.format) return "Choose a format to continue."
  if (n === 2) {
    if (w.name.trim().length < 3) return "Enter a creative name of at least 3 characters."
    if (hasSizeChoice(w.format) && !w.size) return "Choose the creative’s dimensions."
    if (needsAsset(w.format) && !w.asset) return "Upload or pick an asset."
  }
  if (n === 4 && w.format !== "rich_media") {
    const e = destinationError(w)
    if (e) return e
    const c = checksFor(w).find((x) => x.key === "destination")
    if (c && !c.ok) return "Add a valid https URL or deep link."
  }
  return ""
}

/** Malformed URLs block every save (the API validates their shape even on drafts). */
export function destinationError(w: CreativeDraft): string {
  if (w.url.trim() && !isHttpsUrl(w.url)) return "The click URL must start with https:// and include a domain."
  if (allowsDeepLink(w.format) && w.deepLink.trim() && !isDeepLink(w.deepLink)) return "Deep links look like scheme://path."
  return ""
}

export const closeDelayTooLong = (w: CreativeDraft) => Number(w.closeDelay) > CLOSE_DELAY_MAX_SEC

/** Statuses that keep serving (and keep their status) when edited with passing checks. */
export const LIVE_CREATIVE: CreativeStatus[] = ["ready", "in_review"]

export function fileSize(bytes: number | null | undefined) {
  if (!bytes) return "—"
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1000))} KB`
}
