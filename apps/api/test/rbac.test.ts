/** RBAC matrix: every role × a representative write per permission → 2xx when `can(role, perm)`, else 403. */
import { can, newId, PERMISSIONS, type Permission, type Role } from "@orbit/domain"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { bannerCreative, campaignBody, harness, inventory, ORIGIN, propertyBody, ROLES, uniq, type Harness } from "./helpers"

let h: Harness
let inv: Awaited<ReturnType<typeof inventory>>
beforeAll(async () => {
  h = await harness()
  inv = await inventory(h)
})
afterAll(() => h?.close())

const post = (role: Role, path: string, body?: object) => h.as[role].post(path).set("Origin", ORIGIN).send(body ?? {})

const ACTIONS: Record<Permission, (role: Role) => Promise<{ status: number }>> = {
  "campaigns.write": (role) => post(role, "/v1/campaigns", campaignBody(inv)),
  "campaigns.publish": async (role) => {
    const c = await post("owner", "/v1/campaigns", campaignBody(inv))
    return post(role, `/v1/campaigns/${c.body.id}/archive`, { rev: c.body.rev })
  },
  "campaigns.targeting": async (role) => {
    const c = await post("owner", "/v1/campaigns", campaignBody(inv))
    const targets = [{ ...c.body.targets[0], countryRule: { mode: "include", countries: ["BD"] } }]
    return h.as[role].patch(`/v1/campaigns/${c.body.id}`).set("Origin", ORIGIN).send({ rev: c.body.rev, targets })
  },
  "creatives.write": (role) => post(role, "/v1/creatives", bannerCreative()),
  "creatives.approve": async (role) => {
    const c = await post("campaign_manager", "/v1/creatives", { ...bannerCreative(), intent: "submit" })
    expect(c.body.status).toBe("in_review")
    return post(role, `/v1/creatives/${c.body.id}/approve`, { rev: c.body.rev })
  },
  "properties.write": (role) => post(role, "/v1/properties", propertyBody()),
  "keys.manage": (role) => post(role, `/v1/properties/${inv.propertyId}/keys`, { env: "live", label: "Production key" }),
  "reports.export": (role) => post(role, "/v1/analytics/export.csv", { range: { days: 7 }, groupBy: "country" }),
  "team.manage": (role) => post(role, "/v1/team", { email: `invite.${role}.${Date.now()}@orbit.test`, role: "analyst" }),
  "budgets.write": (role) => h.as[role].put(`/v1/budgets/${encodeURIComponent(`Team ${role}`)}/2026-Q4`).set("Origin", ORIGIN).send({ amountMicros: 1_000_000, rev: null }),
  "settings.write": (role) => h.as[role].patch("/v1/countries/AE").set("Origin", ORIGIN).send({ enabled: true }),
  "events.write": (role) => post(role, "/v1/events", { key: `evt_${role}`, name: uniq("Trial started"), source: "server" }),
  "audiences.write": (role) => post(role, "/v1/audiences", { name: uniq("Lapsed trials"), rule: { event: "trial_start", withinDays: 30, exclude: null } }),
  "alerts.ack": async (role) => {
    const id = newId("alert")
    const now = new Date()
    await h.db.models.Alert.create({ _id: id, type: "behind_pace", severity: "warning", entity: { type: "campaign", id: newId("campaign") }, status: "open", title: "Behind pace", message: "m", href: "/campaigns", dedupeKey: `k:${id}`, firstSeenAt: now, lastSeenAt: now })
    return post(role, `/v1/alerts/${id}/ack`)
  },
}

describe("RBAC matrix", () => {
  for (const perm of Object.keys(PERMISSIONS) as Permission[]) {
    for (const role of ROLES) {
      const allowed = can(role, perm) && (perm !== "campaigns.targeting" || can(role, "campaigns.write"))
      it(`${perm} × ${role} → ${allowed ? "2xx" : "403"}`, async () => {
        const res = await ACTIONS[perm](role)
        if (allowed) expect(res.status, JSON.stringify((res as { body?: unknown }).body)).toBeGreaterThanOrEqual(200)
        if (allowed) expect(res.status).toBeLessThan(300)
        else expect(res.status).toBe(403)
      })
    }
  }

  it("every role can read", async () => {
    for (const role of ROLES) {
      for (const path of ["/v1/campaigns", "/v1/creatives", "/v1/properties", "/v1/placements", "/v1/team", "/v1/settings", "/v1/countries", "/v1/lookups", "/v1/audit", "/v1/alerts"]) {
        const res = await h.as[role].get(path)
        expect(res.status, `${role} ${path}`).toBe(200)
      }
    }
  })
})
