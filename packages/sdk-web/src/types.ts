/** Wire types mirroring `zServeResponse` in @orbit/domain (not imported: the tag ships without dependencies). */
export interface AdPayload {
  creativeId: string
  campaignId: string
  format: string
  size: string
  assets: Record<string, string>
  copy: { headline: string; body: string; cta: string }
  altText: string
  options: Record<string, unknown>
  click: { url: string; deepLink: string | null }
  tracking: { impression: string; viewable: string; video: { start: string; complete: string } | null; reward: string | null }
  ttlSec: number
  refreshSec: number | null
  test: boolean
}

export interface ServeResponse {
  requestId: string
  ad: AdPayload
}

export type BeaconType = "imp" | "view" | "vs" | "vc" | "rw"

/** Minimal storage surface (localStorage, or an in-memory stand-in when it throws). */
export interface KV {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}
