import { describe, expect, it } from "vitest"
import {
  allowsDeepLink, checksPass, creativeChecks, destinationType, finalUrl, formatsForPlatform, hasSizeChoice, isAppFormat, isDeepLink, isHttpsUrl, isVideoCreative, isVideoFormat,
  placementSizes, sizeLabel, utmString, type AdFormat, type Asset,
} from "../src"

const img: Asset = { kind: "image", url: "https://cdn/x.png", name: "x.png", mime: "image/png", bytes: 1000, width: 320, height: 50, durationSec: null, sha256: null }
const vid: Asset = { ...img, kind: "video", name: "v.mp4", mime: "video/mp4", durationSec: 15 }
const icon: Asset = { ...img, kind: "icon", name: "i.png", width: 128, height: 128 }

function cr(format: AdFormat, over: Record<string, unknown> = {}) {
  const base = {
    name: "Test creative", format, size: "320x50", assets: [img], copy: { headline: "Hello", body: "Short body", cta: "Go" },
    destination: { url: "https://example.com", deepLink: null, utm: { source: "orbit", medium: "", campaign: "" } }, altText: "Alt",
    options: { media: "image" as const, closeDelaySec: 3, reward: "Coins", completionEvent: "video_complete", safeArea: true, closeButton: true, freqNotice: true, brandColor: "#0F766E" },
  }
  return { ...base, ...over } as never
}
const failing = (c: never) => creativeChecks(c).filter((x) => !x.ok).map((x) => x.key)

describe("creativeChecks", () => {
  it("passes complete creatives of every supported format", () => {
    expect(failing(cr("banner"))).toEqual([])
    expect(failing(cr("web_display", { size: "300x250" }))).toEqual([])
    expect(failing(cr("interstitial"))).toEqual([])
    expect(failing(cr("rewarded_video", { assets: [vid] }))).toEqual([])
    expect(failing(cr("native", { assets: [img, icon] }))).toEqual([])
    expect(failing(cr("app_open"))).toEqual([])
    expect(failing(cr("web_popup", { size: "480x360" }))).toEqual([])
    expect(failing(cr("video", { assets: [vid] }))).toEqual([])
    expect(checksPass(cr("banner"))).toBe(true)
  })
  it("name and destination apply to all formats", () => {
    expect(failing(cr("banner", { name: "ab" }))).toEqual(["name"])
    expect(failing(cr("banner", { destination: { url: "http://x.com", deepLink: null, utm: { source: "", medium: "", campaign: "" } } }))).toEqual(["destination"])
    expect(failing(cr("banner", { destination: { url: null, deepLink: "app://home", utm: { source: "", medium: "", campaign: "" } } }))).toEqual([])
  })
  it("sized formats need size, image and alt text", () => {
    expect(failing(cr("banner", { size: "", assets: [], altText: " " }))).toEqual(["size", "asset", "alt"])
    expect(failing(cr("web_display", { assets: [vid] }))).toEqual(["asset"])
  })
  it("interstitial: media, close delay ≤ 5 s, headline", () => {
    expect(failing(cr("interstitial", { assets: [], options: { media: "video", closeDelaySec: 8 }, copy: { headline: " ", body: "", cta: "" } }))).toEqual(["asset", "close", "headline"])
    expect(creativeChecks(cr("interstitial", { options: { media: "video", closeDelaySec: null } })).find((x) => x.key === "asset")!.detail).toContain("Video")
  })
  it("rewarded video: video asset, reward label, completion event", () => {
    expect(failing(cr("rewarded_video", { assets: [img], options: { reward: " ", completionEvent: null } }))).toEqual(["asset", "reward", "event"])
  })
  it("native: icon, image, title and body limits, CTA", () => {
    expect(failing(cr("native", { assets: [], copy: { headline: "x".repeat(41), body: "y".repeat(91), cta: "" } }))).toEqual(["icon", "asset", "title", "body", "cta"])
  })
  it("app open: portrait asset and safe area", () => {
    expect(failing(cr("app_open", { assets: [], options: { safeArea: null } }))).toEqual(["asset", "safe_area"])
  })
  it("web popup: headline, close button, frequency notice (no size/alt check)", () => {
    expect(failing(cr("web_popup", { altText: "", copy: { headline: "", body: "", cta: "" }, options: { closeButton: false, freqNotice: null } }))).toEqual(["headline", "close_button", "freq_notice"])
  })
  it("video needs a video asset", () => expect(failing(cr("video"))).toEqual(["asset"]))
  it("rich media can never pass", () => {
    expect(creativeChecks(cr("rich_media")).map((x) => x.key)).toEqual(["name", "rich_media"])
    expect(checksPass(cr("rich_media"))).toBe(false)
  })
})

describe("creative helpers", () => {
  it("url checks", () => {
    expect(isHttpsUrl("https://a.com/x")).toBe(true)
    expect(isHttpsUrl("http://a.com")).toBe(false)
    expect(isHttpsUrl(null)).toBe(false)
    expect(isDeepLink("drm://x")).toBe(true)
    expect(isDeepLink("nope")).toBe(false)
  })
  it("utm and final url", () => {
    const utm = { source: "orbit", medium: "banner", campaign: "wc 26" }
    expect(utmString(utm)).toBe("utm_source=orbit&utm_medium=banner&utm_campaign=wc%2026")
    expect(utmString({ source: " ", medium: "", campaign: "" })).toBe("")
    expect(finalUrl({ url: "https://a.com/p", deepLink: null, utm })).toBe("https://a.com/p?utm_source=orbit&utm_medium=banner&utm_campaign=wc%2026")
    expect(finalUrl({ url: "https://a.com/p?x=1", deepLink: null, utm: { source: "o", medium: "", campaign: "" } })).toBe("https://a.com/p?x=1&utm_source=o")
    expect(finalUrl({ url: null, deepLink: "app://x", utm: { source: "o", medium: "", campaign: "" } })).toBe("app://x?utm_source=o")
    expect(finalUrl({ url: null, deepLink: "app://x?a=1", utm: { source: "", medium: "", campaign: "" } })).toBe("app://x?a=1")
    expect(finalUrl({ url: null, deepLink: null, utm })).toBe("")
  })
  it("destination type", () => {
    expect(destinationType({ url: "https://a.com", deepLink: "x://y" })).toBe("deep_link")
    expect(destinationType({ url: "https://a.com", deepLink: null })).toBe("web_url")
    expect(destinationType({ url: null, deepLink: null })).toBe("missing")
  })
  it("format helpers", () => {
    expect(hasSizeChoice("")).toBe(false)
    expect(hasSizeChoice("banner")).toBe(true)
    expect(hasSizeChoice("interstitial")).toBe(true)
    expect(hasSizeChoice("app_open")).toBe(false)
    expect(isAppFormat("app_open")).toBe(true)
    expect(isAppFormat("native")).toBe(false)
    expect(allowsDeepLink("native")).toBe(true)
    expect(allowsDeepLink("web_display")).toBe(false)
    expect(isVideoCreative({ format: "interstitial", options: { media: "video" } })).toBe(true)
    expect(isVideoCreative({ format: "banner", options: { media: "image" } })).toBe(false)
    expect(isVideoFormat("rewarded_video")).toBe(true)
    expect(formatsForPlatform("web")).toEqual(["native", "web_popup", "web_display", "video"])
    expect(formatsForPlatform("ios")).not.toContain("web_popup")
    expect(placementSizes("app_open")).toEqual(["fullscreen"])
    expect(placementSizes("native")).toEqual(["fluid"])
    expect(placementSizes("video")).toEqual(["640x360", "1280x720"])
    expect(placementSizes("banner")).toContain("320x50")
    expect(sizeLabel("fullscreen")).toBe("Full screen")
    expect(sizeLabel("fluid")).toBe("Fluid")
    expect(sizeLabel("320x50")).toBe("320×50")
  })
})
