/**
 * DOM renderers per format. Ad content is set with textContent / attributes only (never innerHTML),
 * so a creative's copy can't inject markup into the host page.
 */
import { readJson, writeJson } from "./storage"
import type { AdPayload, BeaconType, KV } from "./types"

export interface RenderCtx {
  storage: KV
  /** local calendar day "YYYY-MM-DD" (popup frequency) */
  today: string
  /** queue a beacon for a tracking URL */
  track(type: BeaconType, url: string): void
  doc?: Document
}

export interface Rendered {
  root: HTMLElement
  video: HTMLVideoElement | null
}

const POPUP_KEY = "orbit.popup"

type Attrs = Record<string, string>
function h<K extends keyof HTMLElementTagNameMap>(d: Document, tag: K, attrs: Attrs = {}, style = "", text?: string): HTMLElementTagNameMap[K] {
  const el = d.createElement(tag)
  for (const k in attrs) el.setAttribute(k, attrs[k])
  if (style) el.style.cssText = style
  if (text != null) el.textContent = text
  return el
}

function link(d: Document, ad: AdPayload, style = "display:block;text-decoration:none;color:inherit"): HTMLAnchorElement {
  return h(d, "a", { href: ad.click.url, target: "_blank", rel: "noopener sponsored", "data-orbit-click": "" }, style)
}

function badge(d: Document, ad: AdPayload, root: HTMLElement) {
  if (!ad.test) return
  root.appendChild(h(d, "span", { class: "orbit-test" }, "position:absolute;top:4px;right:4px;background:#b45309;color:#fff;font:600 10px/1.6 system-ui,sans-serif;padding:0 6px;border-radius:3px;z-index:2", "Test ad"))
}

function dims(size: string): { w: number; h: number } | null {
  const m = /^(\d+)x(\d+)$/.exec(size)
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null
}

/** Popups show at most once per visitor per day (§8, web_popup checks). */
export function popupAllowed(storage: KV, today: string): boolean {
  return readJson<string | null>(storage, POPUP_KEY, null) !== today
}

function image(d: Document, ad: AdPayload, root: HTMLElement) {
  const sz = dims(ad.size)
  const a = link(d, ad)
  const img = h(d, "img", { src: ad.assets.image ?? "", alt: ad.altText || ad.copy.headline || "Advertisement" }, "display:block;max-width:100%;height:auto;border:0")
  if (sz) {
    img.width = sz.w
    img.height = sz.h
    root.style.maxWidth = sz.w + "px"
  }
  a.appendChild(img)
  root.appendChild(a)
}

function native(d: Document, ad: AdPayload, root: HTMLElement) {
  root.style.cssText += ";font:14px/1.4 system-ui,sans-serif;border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#fff;color:#111"
  const a = link(d, ad)
  const head = h(d, "div", {}, "display:flex;gap:10px;align-items:center")
  if (ad.assets.icon) head.appendChild(h(d, "img", { src: ad.assets.icon, alt: "" }, "width:40px;height:40px;border-radius:8px;flex:none"))
  const t = h(d, "div", {}, "flex:1;min-width:0")
  t.appendChild(h(d, "strong", { class: "orbit-title" }, "display:block", ad.copy.headline))
  t.appendChild(h(d, "span", { class: "orbit-ad-label" }, "display:inline-block;font-size:11px;font-weight:600;color:#555;border:1px solid #999;border-radius:3px;padding:0 4px", "Ad"))
  head.appendChild(t)
  a.appendChild(head)
  if (ad.assets.image) a.appendChild(h(d, "img", { src: ad.assets.image, alt: ad.altText || "" }, "display:block;width:100%;height:auto;margin-top:8px;border-radius:6px"))
  if (ad.copy.body) a.appendChild(h(d, "p", { class: "orbit-body" }, "margin:8px 0", ad.copy.body))
  if (ad.copy.cta) a.appendChild(h(d, "span", { class: "orbit-cta", role: "button" }, "display:inline-block;background:#0f766e;color:#fff;padding:6px 12px;border-radius:6px;font-weight:600", ad.copy.cta))
  root.appendChild(a)
}

function video(d: Document, ad: AdPayload, root: HTMLElement, ctx: RenderCtx): HTMLVideoElement {
  const v = h(d, "video", { playsinline: "", controls: "", preload: "metadata" }, "display:block;width:100%;height:auto;background:#000")
  v.muted = true
  v.autoplay = true
  v.src = ad.assets.video ?? ""
  if (ad.assets.image) v.poster = ad.assets.image
  let started = false
  v.addEventListener("playing", () => {
    if (started) return
    started = true
    if (ad.tracking.video) ctx.track("vs", ad.tracking.video.start)
  })
  v.addEventListener("ended", () => {
    if (ad.tracking.video) ctx.track("vc", ad.tracking.video.complete)
    if (ad.tracking.reward) ctx.track("rw", ad.tracking.reward)
  })
  root.appendChild(v)
  if (ad.copy.cta) {
    const a = link(d, ad, "display:inline-block;margin-top:6px;font:600 13px system-ui,sans-serif;color:#0f766e")
    a.textContent = ad.copy.cta
    root.appendChild(a)
  }
  return v
}

function popup(d: Document, ad: AdPayload, ctx: RenderCtx): HTMLElement {
  const overlay = h(d, "div", { class: "orbit-popup", role: "dialog", "aria-modal": "true", "aria-label": ad.copy.headline || "Advertisement" },
    "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2147483646")
  const box = h(d, "div", {}, "position:relative;background:#fff;color:#111;border-radius:10px;max-width:min(92vw,600px);padding:16px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.3)")
  const close = h(d, "button", { type: "button", class: "orbit-close", "aria-label": "Close ad" }, "position:absolute;top:6px;left:6px;border:0;background:#111;color:#fff;width:28px;height:28px;border-radius:14px;cursor:pointer;font-size:16px;line-height:28px;z-index:3", "×")
  const remove = () => overlay.remove()
  close.addEventListener("click", remove)
  overlay.addEventListener("click", (e) => e.target === overlay && remove())
  box.appendChild(close)
  if (ad.copy.headline) box.appendChild(h(d, "strong", { class: "orbit-title" }, "display:block;margin:0 32px 8px;font-size:16px", ad.copy.headline))
  if (ad.assets.image) image(d, ad, box)
  if (ad.copy.body) box.appendChild(h(d, "p", {}, "margin:8px 0", ad.copy.body))
  if (ad.copy.cta) {
    const a = link(d, ad, "display:inline-block;background:#0f766e;color:#fff;padding:6px 12px;border-radius:6px;font-weight:600;text-decoration:none")
    a.textContent = ad.copy.cta
    box.appendChild(a)
  }
  badge(d, ad, box)
  overlay.appendChild(box)
  writeJson(ctx.storage, POPUP_KEY, ctx.today)
  return overlay
}

/** Render an ad into its slot. Returns null when nothing was shown (e.g. popup already shown today). */
export function renderAd(slot: HTMLElement, ad: AdPayload, ctx: RenderCtx): Rendered | null {
  const d = ctx.doc ?? slot.ownerDocument
  if (ad.format === "web_popup") {
    if (!popupAllowed(ctx.storage, ctx.today)) return null
    const el = popup(d, ad, ctx)
    d.body.appendChild(el)
    return { root: el, video: null }
  }
  const root = h(d, "div", { class: "orbit-ad", "data-orbit-format": ad.format, "data-orbit-creative": ad.creativeId }, "position:relative;display:block")
  let v: HTMLVideoElement | null = null
  if (ad.format === "native") native(d, ad, root)
  else if (ad.format === "video" || ad.format === "rewarded_video") v = video(d, ad, root, ctx)
  else if (ad.assets.image) image(d, ad, root)
  else return null
  badge(d, ad, root)
  slot.replaceChildren(root)
  return { root, video: v }
}
