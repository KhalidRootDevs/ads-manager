/**
 * Properties (apps and websites) and their SDK keys (§6.4 properties / property_keys, §9 secrets).
 * Secrets are generated here, returned exactly once, and stored only as HMAC-SHA256(secret, KEY_PEPPER).
 */
import {
  FORMAT_LABEL, INTERNAL_HEADER, KEY_ENV_LABEL, newId, PLATFORM_LABEL, ruleSummary, zRequestSample,
  type Property, type PropertyCreate, type PropertyKey, type PropertyPatch, type RequestSample,
} from "@orbit/domain"
import { generateKeySecret, hashKeySecret } from "@orbit/domain/node"
import { conflict, notFound, unavailable } from "@orbit/server-kit"
import type { ClientSession } from "mongoose"
import type { Ctx, Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import { keyDto, propertyDto, requestSampleDto } from "../../lib/dto"
import { isDuplicate } from "../../lib/mongo"
import type { Lean } from "../../lib/types"
import type { PropertiesRepo } from "./repo"

const GRACE_MS = 24 * 3600_000

function patchDetail(before: Property, patch: PropertyPatch): string {
  const out: string[] = []
  if (patch.name !== undefined && patch.name !== before.name) out.push(`Renamed ${before.name} → ${patch.name}`)
  if (patch.team !== undefined && patch.team !== before.team) out.push(`Team ${before.team} → ${patch.team}`)
  if (patch.env !== undefined && patch.env !== before.env) out.push(`Environment ${before.env} → ${patch.env}`)
  if (patch.formats && patch.formats.join() !== before.formats.join()) out.push(`Formats: ${patch.formats.map((f) => FORMAT_LABEL[f]).join(", ")}`)
  if (patch.countryRule && JSON.stringify(patch.countryRule) !== JSON.stringify(before.countryRule)) out.push(`Country defaults: ${ruleSummary(before.countryRule)} → ${ruleSummary(patch.countryRule)}`)
  if (patch.tags && patch.tags.join() !== before.tags.join()) out.push(`Tags: ${patch.tags.join(", ") || "none"}`)
  if (patch.testMode !== undefined && patch.testMode !== before.testMode) out.push(`Test mode ${patch.testMode ? "on" : "off"}`)
  if (patch.ownerId !== undefined && patch.ownerId !== before.ownerId) out.push("Owner changed")
  return out.join("; ") || "No changes"
}

export function propertiesService(deps: Pick<Deps, "db" | "env" | "now" | "fetch" | "log">, repo: PropertiesRepo, audit: AuditWriter) {
  const tx = <T>(fn: (s: ClientSession) => Promise<T>) => deps.db.primary.transaction(fn)
  const target = (p: { _id?: string; id?: string; name: string }) => ({ type: "property", id: (p._id ?? p.id)!, name: p.name })

  async function load(id: string, session?: ClientSession) {
    const p = await repo.byId(id, session)
    if (!p) throw notFound("Property")
    return p
  }
  async function stale(id: string): Promise<never> {
    const cur = await repo.byId(id)
    if (!cur) throw notFound("Property")
    throw conflict("This property was changed by someone else. Review the latest version.", propertyDto(cur))
  }

  function newKey(propertyId: string, env: "live" | "test", label: string, by: string) {
    const { secret, prefix, last4 } = generateKeySecret(env)
    const doc = {
      _id: newId("key"), propertyId, label, env, prefix, last4, hash: hashKeySecret(secret, deps.env.KEY_PEPPER), status: "active", graceUntil: null, createdBy: by,
      lastUsedAt: null, revokedAt: null, revokedBy: null,
    }
    return { doc, secret }
  }

  async function setStatus(ctx: Ctx, id: string, rev: number, status: "active" | "paused", action: string) {
    const p = await load(id)
    return tx(async (s) => {
      const updated = await repo.update(id, rev, { $set: { status } }, s)
      if (!updated) return stale(id)
      await audit(ctx, { action, target: target(p), detail: `${p.status} → ${status}` }, s)
      return propertyDto(updated)
    })
  }

  return {
    list: async (): Promise<{ items: Property[] }> => ({ items: (await repo.list()).map(propertyDto) }),
    get: async (id: string): Promise<Property> => propertyDto(await load(id)),

    /** Register + a test key (secret returned once). One transaction; a duplicate platform + identifier → 409. */
    async create(ctx: Ctx, input: PropertyCreate): Promise<{ property: Property; testKey: { key: PropertyKey; secret: string } }> {
      try {
        return await tx(async (s) => {
          const id = newId("property")
          const p = await repo.insert(
            {
              _id: id, name: input.name, platform: input.platform, identifier: input.identifier, team: input.team, ownerId: input.ownerId ?? ctx.actor.id, env: input.env,
              status: "pending", formats: input.formats, countryRule: input.countryRule, tags: input.tags, testMode: input.testMode,
              sdk: { state: "not_integrated", version: null, lastHeartbeatAt: null }, rev: 0,
            },
            s,
          )
          const { doc, secret } = newKey(id, "test", "Test SDK key", ctx.actor.id)
          const key = await repo.insertKey(doc, s)
          await audit(ctx, { action: "property.created", target: { type: "property", id, name: input.name }, detail: `${PLATFORM_LABEL[input.platform]} · ${input.identifier}` }, s)
          return { property: propertyDto(p!), testKey: { key: keyDto(key!), secret } }
        })
      } catch (e) {
        if (isDuplicate(e)) throw conflict(`${input.identifier} is already registered as ${input.platform === "web" ? "a Web" : `an ${PLATFORM_LABEL[input.platform]}`} property.`, undefined, "duplicate")
        throw e
      }
    },

    async patch(ctx: Ctx, id: string, input: PropertyPatch): Promise<Property> {
      const before = propertyDto(await load(id))
      const { rev, ...fields } = input
      return tx(async (s) => {
        const updated = await repo.update(id, rev, { $set: fields }, s)
        if (!updated) return stale(id)
        await audit(ctx, { action: "property.updated", target: target(updated), detail: patchDetail(before, input) }, s)
        return propertyDto(updated)
      })
    },
    pause: (ctx: Ctx, id: string, rev: number) => setStatus(ctx, id, rev, "paused", "property.paused"),
    activate: (ctx: Ctx, id: string, rev: number) => setStatus(ctx, id, rev, "active", "property.activated"),

    // ---------- keys ----------
    async keys(id: string): Promise<{ items: PropertyKey[] }> {
      await load(id)
      const rows = await repo.keys(id)
      rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      return { items: rows.map(keyDto) }
    },
    async createKey(ctx: Ctx, id: string, input: { env: "live" | "test"; label: string }) {
      const p = await load(id)
      return tx(async (s) => {
        const { doc, secret } = newKey(id, input.env, input.label, ctx.actor.id)
        const key = await repo.insertKey(doc, s)
        await audit(ctx, { action: "key.created", target: target(p), detail: `${input.label} (${KEY_ENV_LABEL[input.env]}) ••••${doc.last4}` }, s)
        return { key: keyDto(key!), secret }
      })
    },
    /** Old key → grace for 24 h, new key active, both in one transaction: never zero valid keys (§6.9). */
    async rotateKey(ctx: Ctx, id: string, keyId: string) {
      const p = await load(id)
      return tx(async (s) => {
        const old = await repo.key(keyId, s)
        if (!old || old.propertyId !== id) throw notFound("Key")
        if (old.status !== "active") throw conflict(old.status === "grace" ? "This key was already rotated; rotate the new key instead." : "A revoked key can’t be rotated.", keyDto(old))
        const graced = await repo.updateKey(keyId, "active", { status: "grace", graceUntil: new Date(deps.now().getTime() + GRACE_MS) }, s)
        if (!graced) throw conflict("This key changed while rotating. Reload and try again.")
        const { doc, secret } = newKey(id, old.env, old.label, ctx.actor.id)
        const key = await repo.insertKey(doc, s)
        await audit(ctx, { action: "key.rotated", target: target(p), detail: `${old.label} ••••${old.last4} → ••••${doc.last4} (old key works for 24 h)` }, s)
        return { key: keyDto(key!), secret }
      })
    },
    async revokeKey(ctx: Ctx, id: string, keyId: string): Promise<PropertyKey> {
      const p = await load(id)
      return tx(async (s) => {
        const k = await repo.key(keyId, s)
        if (!k || k.propertyId !== id) throw notFound("Key")
        if (k.status === "revoked") return keyDto(k)
        const revoked = await repo.updateKey(keyId, k.status, { status: "revoked", graceUntil: null, revokedAt: deps.now(), revokedBy: ctx.actor.id }, s)
        if (!revoked) throw conflict("This key changed while revoking. Reload and try again.")
        await audit(ctx, { action: "key.revoked", target: target(p), detail: `${k.label} ••••${k.last4}` }, s)
        return keyDto(revoked)
      })
    },

    // ---------- diagnostics ----------
    /**
     * Send a test request through the ad server's internal endpoint. A first successful request marks a
     * not-yet-integrated property as healthy and active (the prototype's "go live" moment).
     */
    async testRequest(ctx: Ctx, id: string): Promise<RequestSample> {
      const p = await load(id)
      const pl = await repo.firstActivePlacement(id)
      let sample: RequestSample
      try {
        const res = await deps.fetch(`${deps.env.AD_SERVER_URL}/internal/test-serve`, {
          method: "POST",
          headers: { "content-type": "application/json", [INTERNAL_HEADER]: deps.env.INTERNAL_TOKEN },
          body: JSON.stringify({ propertyId: id, ...(pl ? { placementId: pl._id } : {}) }),
          signal: AbortSignal.timeout(5_000),
        })
        if (!res.ok) throw new Error(`ad server responded ${res.status}`)
        sample = zRequestSample.parse(await res.json())
      } catch (err) {
        deps.log.warn({ err, propertyId: id }, "test request failed")
        throw unavailable("The ad server isn’t reachable right now, so the test request couldn’t be sent. Try again in a minute.")
      }
      await tx(async (s) => {
        if (p.sdk?.state === "not_integrated") {
          await repo.update(id, p.rev, { $set: { status: "active", "sdk.state": "healthy", "sdk.version": "test", "sdk.lastHeartbeatAt": deps.now() } }, s)
          await audit(ctx, { action: "property.integrated", target: target(p), detail: `First test request answered (${sample.result}, ${sample.latencyMs} ms)` }, s)
        } else {
          await audit(ctx, { action: "property.tested", target: target(p), detail: `${sample.result}, ${sample.latencyMs} ms` }, s)
        }
      })
      return sample
    },
    async diagnostics(id: string): Promise<{ items: RequestSample[] }> {
      await load(id)
      const rows: Lean[] = await repo.samples(id, new Date(deps.now().getTime() - 24 * 3600_000), 50)
      const names = await repo.placementNames([...new Set(rows.map((r) => r.k?.pl).filter(Boolean))] as string[])
      return { items: rows.map((r) => requestSampleDto(r, names)) }
    },
  }
}
export type PropertiesService = ReturnType<typeof propertiesService>
