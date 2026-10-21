/**
 * Orbit web tag (§8). Usage:
 *   <script async src="https://ads.example/tag/orbit.js" data-orbit-app="prp_…" data-orbit-endpoint="https://ads.example"
 *           data-orbit-test="true"></script>
 *   <div data-orbit-placement="plc_…"></div>
 * Optional: data-orbit-tracking (collector base URL; default = origin of the signed tracking URLs),
 * data-orbit-consent="true" (send the first-party uid for frequency capping). No cookies are used.
 */
import { BeaconQueue } from "./queue"
import { renderAd } from "./render"
import { safeStorage } from "./storage"
import type { BeaconType, ServeResponse } from "./types"
import { DISPLAY_VIEW_MS, VIDEO_VIEW_MS, observeViewable } from "./viewability"

export const VERSION = "2.5.0"
const REQUEST_TIMEOUT_MS = 1_500
const FLUSH_INTERVAL_MS = 10_000
const HEARTBEAT_MS = 60_000
const HEARTBEAT_SAMPLE = 0.1

export function deviceType(ua: string, width: number): "phone" | "tablet" | "desktop" {
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return "tablet"
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua) || width < 600) return "phone"
  return "desktop"
}

function osOf(ua: string): string | undefined {
  if (/Android/i.test(ua)) return "android"
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios"
  if (/Windows/i.test(ua)) return "windows"
  if (/Mac OS X/i.test(ua)) return "macos"
  if (/Linux/i.test(ua)) return "linux"
  return undefined
}

/** `https://t.example/t/imp/<token>` → { base: "https://t.example", token } */
export function splitTrackingUrl(url: string): { base: string; token: string } | null {
  try {
    const u = new URL(url)
    const token = decodeURIComponent(u.pathname.split("/").pop() ?? "")
    return token ? { base: u.origin, token } : null
  } catch {
    return null
  }
}

function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function randomId() {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return "u_" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
}

interface SlotState {
  dispose?: () => void
  timer?: ReturnType<typeof setTimeout>
}

function start(script: HTMLScriptElement | null) {
  const ds = script?.dataset ?? {}
  const app = ds.orbitApp ?? ""
  let srcOrigin = location.origin
  try {
    if (script?.src) srcOrigin = new URL(script.src).origin
  } catch {
    /* keep page origin */
  }
  const endpoint = (ds.orbitEndpoint || srcOrigin).replace(/\/$/, "")
  let tracking = (ds.orbitTracking ?? "").replace(/\/$/, "")
  const test = ds.orbitTest === "true"
  const storage = safeStorage()
  let consent = ds.orbitConsent === "true"
  let debugOn = /[?&]orbit_debug=1\b/.test(location.search)
  const log = (...a: unknown[]) => debugOn && console.info("[orbit]", ...a)
  const slots = new Map<HTMLElement, SlotState>()

  const queue = new BeaconQueue({
    storage,
    log,
    send: (url, body) =>
      fetch(url, { method: "POST", body, headers: { "content-type": "application/json" }, credentials: "omit", keepalive: body.length < 60_000 }).then((r) => r.status),
  })

  const track = (type: BeaconType, url: string) => {
    const t = splitTrackingUrl(url)
    if (!t) return
    if (!tracking) tracking = t.base
    if (queue.push(type, t.token, tracking || t.base)) log("beacon", type)
  }

  const uid = () => {
    if (!consent) return undefined
    let id = storage.getItem("orbit.uid")
    if (!id) {
      id = randomId()
      storage.setItem("orbit.uid", id)
    }
    return id
  }

  async function request(slot: HTMLElement) {
    const placementId = slot.dataset.orbitPlacement
    if (!placementId || !app) return
    const st = slots.get(slot) ?? {}
    slots.set(slot, st)
    st.dispose?.()
    clearTimeout(st.timer)
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null
    const to = setTimeout(() => ctrl?.abort(), REQUEST_TIMEOUT_MS)
    const ua = navigator.userAgent
    const body = {
      placementId,
      device: { type: deviceType(ua, window.innerWidth), os: osOf(ua), lang: (navigator.language || "").slice(0, 10) || undefined },
      uid: uid(),
      consent: { personalised: consent },
      sdkVersion: VERSION,
      test,
    }
    let res: ServeResponse | null = null
    try {
      const r = await fetch(`${endpoint}/v1/serve`, {
        method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-orbit-app": app }, credentials: "omit", signal: ctrl?.signal,
      })
      if (r.status === 200) res = (await r.json()) as ServeResponse
      else log("no fill", placementId, r.status, r.headers.get("x-orbit-no-fill") ?? "")
    } catch (e) {
      log("serve failed", placementId, e)
    } finally {
      clearTimeout(to)
    }
    if (!res?.ad) return
    const ad = res.ad
    const out = renderAd(slot, ad, { storage, today: localDay(), track })
    if (!out) return log("not rendered", placementId, ad.format)
    track("imp", ad.tracking.impression)
    st.dispose = observeViewable(out.video ?? out.root, out.video ? VIDEO_VIEW_MS : DISPLAY_VIEW_MS, () => track("view", ad.tracking.viewable))
    if (ad.refreshSec && ad.format !== "web_popup") st.timer = setTimeout(() => whenVisible(() => request(slot)), ad.refreshSec * 1000)
    log("rendered", placementId, ad.format, ad.creativeId)
  }

  function whenVisible(fn: () => void) {
    if (document.visibilityState !== "hidden") return fn()
    const on = () => {
      if (document.visibilityState === "hidden") return
      document.removeEventListener("visibilitychange", on)
      fn()
    }
    document.addEventListener("visibilitychange", on)
  }

  function scan() {
    document.querySelectorAll<HTMLElement>("[data-orbit-placement]").forEach((el) => void request(el))
  }

  const sampled = test || Math.random() < HEARTBEAT_SAMPLE
  function heartbeat() {
    if (!sampled || !tracking || !app || document.visibilityState === "hidden") return
    fetch(`${tracking}/v1/heartbeat`, {
      method: "POST", keepalive: true, credentials: "omit", headers: { "content-type": "application/json", "x-orbit-app": app },
      body: JSON.stringify({ sdkVersion: VERSION, testMode: test, platform: "web" }),
    }).catch(() => {})
  }

  setInterval(() => void queue.tick(), FLUSH_INTERVAL_MS)
  setInterval(heartbeat, HEARTBEAT_MS)
  setTimeout(heartbeat, 5_000)
  const hide = () => {
    if (typeof navigator.sendBeacon !== "function") return void queue.flush(true)
    // text/plain is CORS-safelisted: no preflight. The collector parses JSON in text/plain bodies.
    queue.flushBeacon((url, body) => navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" })))
  }
  addEventListener("pagehide", hide)
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && hide())

  const api = {
    version: VERSION,
    setConsent(v: boolean) {
      consent = !!v
      if (!consent) storage.removeItem("orbit.uid")
    },
    refresh: scan,
    debug(on?: boolean) {
      if (on !== undefined) debugOn = on
      return { app, endpoint, tracking, test, consent, queued: queue.size, slots: slots.size }
    },
  }
  ;(window as unknown as { orbit: typeof api }).orbit = api
  if (!app) console.warn("[orbit] data-orbit-app is missing on the tag")
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan)
  else scan()
  void queue.flush()
}

if (typeof window !== "undefined" && typeof document !== "undefined" && !(window as unknown as { orbit?: unknown }).orbit) {
  const s = (document.currentScript as HTMLScriptElement | null) ?? document.querySelector<HTMLScriptElement>("script[data-orbit-app]")
  if (s) start(s)
}
