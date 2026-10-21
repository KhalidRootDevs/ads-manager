import type { KV } from "../src/types"
import type { AdPayload } from "../src/types"

export function memStorage(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
}

export function ad(over: Partial<AdPayload> = {}): AdPayload {
  return {
    creativeId: "crv_1", campaignId: "cmp_1", format: "web_display", size: "300x250",
    assets: { image: "https://cdn.example/a.png" }, copy: { headline: "Big match", body: "Watch live", cta: "Watch" }, altText: "Banner alt", options: {},
    click: { url: "http://localhost:4200/c/CLICKTOKEN", deepLink: null },
    tracking: { impression: "http://localhost:4200/t/imp/IMPTOKEN", viewable: "http://localhost:4200/t/view/VIEWTOKEN", video: null, reward: null },
    ttlSec: 300, refreshSec: null, test: false, ...over,
  }
}
