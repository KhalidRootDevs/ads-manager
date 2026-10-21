import { APP_HEADER, formatsForPlatform, KEY_HEADER, TEAMS as DOMAIN_TEAMS, type AdFormat, type Placement, type Platform, type Property, type PropertyEnv, type PropertyKey } from "@orbit/domain"
import { toast } from "sonner"
import { AD_SERVER_URL } from "@/lib/api"

const APP_DEFAULT_FORMATS: AdFormat[] = ["banner", "interstitial", "rewarded_video", "native", "app_open"]
const WEB_DEFAULT_FORMATS: AdFormat[] = ["web_display", "web_popup", "video", "native"]

/** Formats a property of this platform may allow (HTML / Rich Media is future-ready, so it is always offered last). */
export function formatsFor(platform: Platform): AdFormat[] {
  return [...formatsForPlatform(platform), "rich_media"]
}
export function defaultFormatsFor(platform: Platform): AdFormat[] {
  return platform === "web" ? [...WEB_DEFAULT_FORMATS] : [...APP_DEFAULT_FORMATS]
}

export const TEAMS: readonly string[] = DOMAIN_TEAMS

export const PROPERTY_TABS = [
  { value: "overview", label: "Overview" },
  { value: "placements", label: "Placements" },
  { value: "formats", label: "Formats & countries" },
  { value: "credentials", label: "Credentials" },
  { value: "integration", label: "Integration" },
  { value: "diagnostics", label: "Diagnostics" },
] as const
export type PropertyTab = (typeof PROPERTY_TABS)[number]["value"]

/** Public ad decision endpoint. One ad server serves both environments; staging properties simply use test keys. */
export const SERVE_URL = `${AD_SERVER_URL.replace(/\/$/, "")}/v1/serve`
export const TAG_URL = `${AD_SERVER_URL.replace(/\/$/, "")}/tag/orbit.js`
export const ENDPOINTS: Record<PropertyEnv, string> = { production: SERVE_URL, staging: SERVE_URL }

/** Secrets are never shown after creation: prefix + dots + last 4. */
export function maskKey(k: Pick<PropertyKey, "prefix" | "last4">) {
  return k.prefix + "••••••••••••••••" + k.last4
}

export function copyToClipboard(text: string, label: string) {
  if (!navigator.clipboard) {
    toast.error("Clipboard isn’t available in this browser. Select the text and copy it manually.")
    return
  }
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied to clipboard`),
    () => toast.error("Couldn’t copy. Select the text and copy it manually."),
  )
}

export function snippetLang(platform: Platform) {
  return platform === "android" ? "Kotlin" : platform === "ios" ? "Swift" : "HTML"
}

const PLACEHOLDER_PLACEMENT = "plc_xxx"

/**
 * Integration code for the property's platform, with the real App ID (= property id) and placement id.
 * Never includes a secret: apps read their SDK key from their own config.
 */
export function snippet(p: Pick<Property, "id" | "platform" | "testMode">, pl?: Pick<Placement, "id"> | null) {
  const pid = pl ? pl.id : PLACEHOLDER_PLACEMENT
  if (p.platform === "android")
    return `// build.gradle\nimplementation("com.orbitads:sdk-android:6.2.1")\n\n// Application.onCreate()\nOrbitAds.init(this, OrbitConfig(\n    appId = "${p.id}",\n    sdkKey = BuildConfig.ORBIT_SDK_KEY,\n    endpoint = "${AD_SERVER_URL}",\n    testMode = ${p.testMode}\n))\n\n// Load a placement\nval ad = OrbitBannerView(context, placementId = "${pid}")\nad.load()`
  if (p.platform === "ios")
    return `// Package.swift\n.package(url: "https://git.internal/orbit-ads-ios", from: "6.2.0")\n\n// AppDelegate\nOrbitAds.start(\n    appId: "${p.id}",\n    sdkKey: Config.orbitSdkKey,\n    endpoint: URL(string: "${AD_SERVER_URL}")!,\n    testMode: ${p.testMode}\n)\n\n// Load a placement\nlet ad = OrbitBannerView(placementId: "${pid}")\nad.load()`
  return `<!-- Add once per page -->\n<script async src="${TAG_URL}"\n        data-orbit-app="${p.id}"${p.testMode ? '\n        data-orbit-test="true"' : ""}></script>\n\n<!-- Where the ad should render -->\n<div data-orbit-placement="${pid}"></div>`
}

/** Raw HTTP request the SDKs make, for server-side or custom integrations. The key stays a placeholder. */
export function serveSnippet(p: Pick<Property, "id" | "platform" | "testMode">, pl?: Pick<Placement, "id"> | null) {
  const pid = pl ? pl.id : PLACEHOLDER_PLACEMENT
  const device = p.platform === "web" ? "desktop" : "phone"
  return `curl -X POST ${SERVE_URL} \\\n  -H "content-type: application/json" \\\n  -H "${APP_HEADER}: ${p.id}" \\\n  -H "${KEY_HEADER}: $ORBIT_SDK_KEY" \\\n  -d '{"placementId":"${pid}","device":{"type":"${device}"},"test":${p.testMode}}'`
}

export function resultTone(result: string): "success" | "info" | "neutral" | "danger" {
  if (result.includes("(test)")) return "info"
  if (result.startsWith("200")) return "success"
  if (result.startsWith("204")) return "neutral"
  return "danger"
}

export function sameSet<T>(a: T[], b: T[]) {
  return a.length === b.length && a.every((x) => b.includes(x))
}
