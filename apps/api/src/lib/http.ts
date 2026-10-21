import { truncateIp } from "@orbit/domain/node"
import { unauthorized } from "@orbit/server-kit"
import type { Request } from "express"
import type { Ctx } from "../context"

/** Service context from an authenticated request. */
export function ctxOf(req: Request): Ctx {
  if (!req.actor) throw unauthorized()
  return { actor: req.actor, ip: req.ip ? truncateIp(req.ip) : null, requestId: String(req.id ?? "") }
}

export const p = (req: Request, name: string) => String(req.params[name] ?? "")

/**
 * PATCH semantics: keep only the top-level keys the client actually sent. Zod 4's `.partial()` keeps inner
 * `.default()`s, so `zCreativePatch` / `zPlacementPatch` / `zCampaignPatch` would otherwise fill omitted fields with defaults.
 */
export function sent<T extends object>(req: Request, parsed: T): T {
  const raw = (req.body ?? {}) as Record<string, unknown>
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => Object.prototype.hasOwnProperty.call(raw, k))) as T
}
