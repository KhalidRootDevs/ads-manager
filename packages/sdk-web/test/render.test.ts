import { beforeEach, describe, expect, it, vi } from "vitest"
import { deviceType, splitTrackingUrl } from "../src/index"
import { popupAllowed, renderAd } from "../src/render"
import { ad, memStorage } from "./helpers"

beforeEach(() => {
  document.body.replaceChildren()
})

function slot() {
  const el = document.createElement("div")
  el.dataset.orbitPlacement = "plc_x"
  document.body.appendChild(el)
  return el
}

describe("renderAd", () => {
  it("renders a display ad as a sponsored link around an image", () => {
    const s = slot()
    const out = renderAd(s, ad(), { storage: memStorage(), today: "2026-10-19", track: vi.fn() })
    const a = s.querySelector("a")!
    expect(out).not.toBeNull()
    expect(a.getAttribute("href")).toBe("http://localhost:4200/c/CLICKTOKEN")
    expect(a.getAttribute("rel")).toBe("noopener sponsored")
    const img = s.querySelector("img")!
    expect(img.getAttribute("alt")).toBe("Banner alt")
    expect(img.width).toBe(300)
    expect(s.querySelector(".orbit-test")).toBeNull()
  })

  it("shows the test badge for test ads", () => {
    const s = slot()
    renderAd(s, ad({ test: true }), { storage: memStorage(), today: "2026-10-19", track: vi.fn() })
    expect(s.querySelector(".orbit-test")?.textContent).toBe("Test ad")
  })

  it("renders native with the required Ad label and escapes copy", () => {
    const s = slot()
    renderAd(s, ad({ format: "native", size: "fluid", assets: { icon: "https://cdn.example/i.png", image: "https://cdn.example/m.png" }, copy: { headline: "<b>Hi</b>", body: "Body", cta: "Install" } }), {
      storage: memStorage(), today: "2026-10-19", track: vi.fn(),
    })
    expect(s.querySelector(".orbit-ad-label")?.textContent).toBe("Ad")
    expect(s.querySelector(".orbit-title")?.textContent).toBe("<b>Hi</b>")
    expect(s.querySelector("b")).toBeNull()
    expect(s.querySelector(".orbit-cta")?.textContent).toBe("Install")
  })

  it("shows a popup at most once per visitor per day, with a close button", () => {
    const storage = memStorage()
    const p = ad({ format: "web_popup", size: "600x400" })
    const first = renderAd(slot(), p, { storage, today: "2026-10-19", track: vi.fn() })
    expect(first).not.toBeNull()
    expect(document.querySelector(".orbit-popup")).not.toBeNull()
    expect(popupAllowed(storage, "2026-10-19")).toBe(false)
    expect(renderAd(slot(), p, { storage, today: "2026-10-19", track: vi.fn() })).toBeNull()
    ;(document.querySelector(".orbit-close") as HTMLButtonElement).click()
    expect(document.querySelector(".orbit-popup")).toBeNull()
    expect(renderAd(slot(), p, { storage, today: "2026-10-20", track: vi.fn() })).not.toBeNull()
  })

  it("fires video start once and complete on end", () => {
    const track = vi.fn()
    const s = slot()
    const out = renderAd(s, ad({ format: "video", size: "640x360", assets: { video: "https://cdn.example/v.mp4" }, tracking: { impression: "x", viewable: "y", video: { start: "http://t/t/vs/S", complete: "http://t/t/vc/C" }, reward: null } }), {
      storage: memStorage(), today: "2026-10-19", track,
    })
    const v = out!.video!
    expect(v.muted).toBe(true)
    v.dispatchEvent(new Event("playing"))
    v.dispatchEvent(new Event("playing"))
    v.dispatchEvent(new Event("ended"))
    expect(track.mock.calls).toEqual([["vs", "http://t/t/vs/S"], ["vc", "http://t/t/vc/C"]])
  })
})

describe("helpers", () => {
  it("splits tracking URLs into collector base + token", () => {
    expect(splitTrackingUrl("http://localhost:4200/t/imp/k1.abc.def")).toEqual({ base: "http://localhost:4200", token: "k1.abc.def" })
    expect(splitTrackingUrl("not a url")).toBeNull()
  })
  it("detects device type", () => {
    expect(deviceType("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile", 390)).toBe("phone")
    expect(deviceType("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 834)).toBe("tablet")
    expect(deviceType("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", 1440)).toBe("desktop")
  })
})
