/**
 * Public SDK payloads (§4.1, §5.1, §7.3) and the normalised stream event written to `events.v1`.
 */
import { z } from "zod"
import { DEVICES } from "./enums"

// ---------- /v1/serve ----------
export const zServeRequest = z.object({
  placementId: z.string().min(4).max(40),
  device: z.object({
    type: z.enum(DEVICES), os: z.string().max(20).optional(), osVersion: z.string().max(20).optional(),
    appVersion: z.string().max(20).optional(), lang: z.string().max(10).optional(),
  }),
  /** first-party install id / cookie id; hashed again server-side */
  uid: z.string().max(80).optional(),
  consent: z.object({ gdpr: z.boolean().optional(), tcf: z.string().max(2000).nullable().optional(), att: z.string().max(20).optional(), personalised: z.boolean().optional() }).optional(),
  sdkVersion: z.string().max(20).optional(),
  test: z.boolean().default(false),
})
export type ServeRequest = z.infer<typeof zServeRequest>

export const zServeResponse = z.object({
  requestId: z.string(),
  ad: z.object({
    creativeId: z.string(), campaignId: z.string(), format: z.string(), size: z.string(),
    assets: z.record(z.string(), z.string()), copy: z.object({ headline: z.string(), body: z.string(), cta: z.string() }), altText: z.string(),
    options: z.record(z.string(), z.unknown()),
    click: z.object({ url: z.string(), deepLink: z.string().nullable() }),
    tracking: z.object({ impression: z.string(), viewable: z.string(), video: z.object({ start: z.string(), complete: z.string() }).nullable(), reward: z.string().nullable() }),
    ttlSec: z.number(), refreshSec: z.number().nullable(), test: z.boolean(),
  }),
})
export type ServeResponse = z.infer<typeof zServeResponse>

// ---------- /v1/e (beacon batch) ----------
export const BEACON_TYPES = ["imp", "view", "vs", "vc", "rw"] as const
export type BeaconType = (typeof BEACON_TYPES)[number]
export const zBeacon = z.object({ type: z.enum(BEACON_TYPES), token: z.string().min(10).max(2000), at: z.number().int().optional() })
export const zBeaconBatch = z.object({ events: z.array(zBeacon).min(1).max(50) })

// ---------- /v1/conversions (server to server) and SDK trackEvent ----------
export const zConversionInput = z.object({
  clickId: z.string().regex(/^clk_[0-9A-HJKMNP-TV-Z]{26}$/),
  event: z.string().regex(/^[a-z][a-z0-9_]{1,49}$/),
  valueMicros: z.number().int().nonnegative().nullable().default(null),
  at: z.number().int().optional(),
})
export const zConversionBatch = z.object({ conversions: z.array(zConversionInput).min(1).max(100) })

// ---------- /v1/heartbeat ----------
export const zHeartbeat = z.object({ sdkVersion: z.string().max(20), testMode: z.boolean().default(false), platform: z.string().max(10).optional() })

// ---------- stream event (events.v1) ----------
export type StreamKind = "imp" | "view" | "clk" | "vs" | "vc" | "rw" | "conv" | "supply" | "hb"

/** Dimensions carried by delivery events (from the signed token). */
export interface DeliveryDims {
  c: string
  cr: string
  p: string
  pl: string
  cc: string
  dv: string
  pf: string
  f: string
}

export type StreamEvent =
  | ({ k: "imp" | "view" | "vs" | "vc" | "rw"; id: string; at: number; r: string; cpi: number; t?: 1 } & DeliveryDims)
  | ({ k: "clk"; id: string; at: number; r: string; clickId: string; u?: string; t?: 1 } & DeliveryDims)
  /** Conversions from the collector carry only the click id; attribution resolves the dims from the stored click. */
  | ({ k: "conv"; id: string; at: number; clickId: string; event: string; valueMicros: number | null; source: string } & Partial<DeliveryDims>)
  /** `sample: 1` marks requests sampled into `request_samples` (REQUEST_SAMPLE_RATE; test requests always). */
  | { k: "supply"; id: string; at: number; r: string; p: string; pl: string; cc: string; dv: string; pf: string; result: "filled" | "no_fill" | "error"; reason: string | null; latencyMs: number; sdk: string | null; t?: 1; sample?: 1 }
  | { k: "hb"; id: string; at: number; p: string; sdk: string; testMode: boolean }

export const EVENTS_TOPIC = "events.v1"
export const DLQ_TOPIC = "events.dlq.v1"

/** Stream partition key: delivery by campaign, supply and heartbeats by property (§5.2). */
export function partitionKey(e: StreamEvent): string {
  if (e.k === "supply" || e.k === "hb") return e.p
  // conversions without dims are keyed by click id, so every conversion of one click lands on one partition (dedupe)
  if (e.k === "conv") return e.c ?? e.clickId
  return e.c
}

/** Human-readable request result shown in Diagnostics and returned by the test request ("200 Served", "204 No fill: country"). */
export function supplyResultLabel(result: "filled" | "no_fill" | "error", reason: string | null, test = false): string {
  const label = result === "filled" ? "200 Served" : result === "no_fill" ? `204 No fill: ${reason ?? "unknown"}` : `500 Error${reason ? `: ${reason}` : ""}`
  return test ? `${label} (test)` : label
}
