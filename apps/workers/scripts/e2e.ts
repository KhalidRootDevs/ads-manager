/**
 * End-to-end check of the serving + event pipeline against the local stack and the dev database.
 *
 * Prerequisites (each in its own terminal, or `pnpm dev`):
 *   pnpm infra:up && pnpm db:seed
 *   pnpm --filter @orbit/workers dev      # compiler + aggregator + attribution + jobs + lake
 *   pnpm --filter @orbit/ad-server dev    # :4100
 *   pnpm --filter @orbit/collector dev    # :4200
 * Run:
 *   pnpm --filter @orbit/workers e2e      (= tsx --env-file=../../.env scripts/e2e.ts)
 *
 * Steps: wait for a published serving index → pick a fillable placement of a demo property (project/.data/demo-keys.json)
 * → POST /v1/serve with its live key → fire impression + view beacons and the click redirect → wait until
 * delivery_daily / campaign_stats / request_samples / clicks reflect them → replay the same beacons and click →
 * verify nothing is double counted → run the internal test request. Exits non-zero on failure.
 * Reads only the Orbit database (MONGODB_DB); the only writes come from the running services.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { connect, dbConfigFromEnv, trusted } from "@orbit/db"
import { inSchedule, reportingDay, SERVING, type ServingIndex } from "@orbit/domain"
import { createRedis } from "@orbit/server-kit"

const AD = process.env.AD_SERVER_URL ?? "http://localhost:4100"
const ROOT = join(import.meta.dirname, "..", "..", "..")
const keys = JSON.parse(readFileSync(join(ROOT, ".data", "demo-keys.json"), "utf8")) as {
  properties: { propertyId: string; name: string; platform: string; identifier: string; keys: { live?: string; test?: string }; placements: { id: string; name: string }[] }[]
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const step = (s: string) => console.log(`\n▶ ${s}`)
const fail = (s: string): never => {
  console.error(`✗ ${s}`)
  process.exit(1)
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 45_000): Promise<T> {
  const t0 = Date.now()
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) {
      console.log(`  ✓ ${what} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
      return v
    }
    if (Date.now() - t0 > timeoutMs) return fail(`timed out waiting for: ${what}`)
    await sleep(1_000)
  }
}

const redis = createRedis(process.env.REDIS_URL ?? "redis://localhost:6379")
const db = await connect(dbConfigFromEnv("workers"))
const m = db.models

step("serving index")
await waitFor("ad server ready", async () => (await fetch(`${AD}/readyz`)).ok)
const version = await redis.get(SERVING.current)
if (!version) fail("no serving:current — is the compiler running?")
const index = JSON.parse(gunzipSync((await redis.getBuffer(SERVING.index(version!)))!).toString()) as ServingIndex
console.log(`  version ${index.version}, built ${index.builtAt}, ${Object.keys(index.placements).length} placements`)

step("pick a fillable placement")
const now = Date.now()
let pick: { prop: (typeof keys.properties)[number]; placementId: string; country: string; device: string; campaignId: string } | null = null
for (const prop of keys.properties) {
  if (!prop.keys.live || !index.properties[prop.propertyId]?.active) continue
  for (const pl of prop.placements) {
    const spl = index.placements[pl.id]
    const c = spl?.active ? spl.candidates.find((x) => x.countries.length && inSchedule(x, now)) : undefined
    if (c) {
      pick = { prop, placementId: pl.id, country: c.countries[0], device: c.devices[0] ?? (prop.platform === "web" ? "desktop" : "phone"), campaignId: c.campaignId }
      break
    }
  }
  if (pick) break
}
if (!pick) fail("no demo placement with an in-schedule candidate (seed the DB, check flights)")
const P = pick!
console.log(`  ${P.prop.name} / ${P.placementId} · country ${P.country} · device ${P.device} · campaign ${P.campaignId}`)

const today = reportingDay(now)
async function snapshot() {
  const stats = await m.CampaignStats.findById(P.campaignId, { lifetime: 1 }).lean()
  const rows = await m.DeliveryDaily.find({ c: P.campaignId, d: today, pl: P.placementId }, { m: 1 }).lean()
  const samples = await m.RequestSample.countDocuments({ "k.p": P.prop.propertyId, at: trusted({ $gte: new Date(now - 60_000) }) })
  return {
    imp: Number(stats?.lifetime?.imp ?? 0), clk: Number(stats?.lifetime?.clk ?? 0), cost: Number(stats?.lifetime?.costMicros ?? 0),
    dImp: rows.reduce((a, r) => a + (r.m?.imp ?? 0), 0), dView: rows.reduce((a, r) => a + (r.m?.view ?? 0), 0), dClk: rows.reduce((a, r) => a + (r.m?.clk ?? 0), 0), samples,
  }
}
const before = await snapshot()
console.log("  before", before)

step("POST /v1/serve")
let ad: { ad: { campaignId: string; tracking: { impression: string; viewable: string }; click: { url: string } } } | null = null
for (let i = 0; i < 10 && !ad; i++) {
  const r = await fetch(`${AD}/v1/serve`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-orbit-app": P.prop.propertyId, "x-orbit-key": P.prop.keys.live!, "x-orbit-debug-country": P.country },
    body: JSON.stringify({ placementId: P.placementId, device: { type: P.device, appVersion: "99.0.0" }, sdkVersion: "e2e" }),
  })
  if (r.status === 200) ad = await r.json()
  else console.log(`  ${r.status} ${r.headers.get("x-orbit-no-fill") ?? ""}`)
}
if (!ad) fail("no fill after 10 tries")
const A = ad!.ad
const impToken = A.tracking.impression.split("/").pop()!
console.log(`  200 · campaign ${A.campaignId}`)
// the served campaign may differ from the candidate we looked at (weighted pick in the same placement)
P.campaignId = A.campaignId
const base = await snapshot()

step("beacons + click")
const tracking = new URL(A.tracking.impression).origin
const beacon = async () => (await fetch(`${tracking}/v1/e`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [{ type: "imp", token: impToken, at: Date.now() }, { type: "view", token: impToken, at: Date.now() }] }) })).status
const click = async () => {
  const r = await fetch(A.click.url, { redirect: "manual" })
  return { status: r.status, location: r.headers.get("location") ?? "" }
}
console.log(`  /v1/e → ${await beacon()}`)
const c1 = await click()
console.log(`  /c → ${c1.status} ${c1.location}`)
const clickId = new URL(c1.location.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "https://x/")).searchParams.get("orbit_click")
if (c1.status !== 302 || !clickId) fail("click redirect without orbit_click")

step("rollups")
const after = await waitFor("campaign_stats + delivery_daily updated", async () => {
  const s = await snapshot()
  return s.imp >= base.imp + 1 && s.clk >= base.clk + 1 && s.dImp >= base.dImp + 1 && s.dView >= base.dView + 1 && s.dClk >= base.dClk + 1 ? s : null
})
console.log("  after", after)
await waitFor("request_samples row", async () => (await snapshot()).samples > before.samples)
await waitFor("click stored for attribution", async () => !!(await m.Click.findById(clickId).lean()))

step("replay (dedupe)")
console.log(`  /v1/e replay → ${await beacon()}`)
const c2 = await click()
const clickId2 = new URL(c2.location.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "https://x/")).searchParams.get("orbit_click")
console.log(`  /c replay → ${c2.status}, same clickId: ${clickId2 === clickId}`)
await sleep(8_000)
const replay = await snapshot()
const doubled = replay.imp !== after.imp || replay.clk !== after.clk || replay.dImp !== after.dImp || replay.dView !== after.dView || replay.dClk !== after.dClk
console.log("  after replay", replay)
if (doubled) fail("replayed beacons were counted again")
console.log("  ✓ no double counting")

step("internal test request")
const t = await fetch(`${AD}/internal/test-serve`, { method: "POST", headers: { "content-type": "application/json", "x-orbit-internal": process.env.INTERNAL_TOKEN ?? "" }, body: JSON.stringify({ propertyId: P.prop.propertyId, placementId: P.placementId }) })
console.log(" ", t.status, await t.json())

console.log(`\n✓ e2e passed: +${after.imp - base.imp} imp, +${after.clk - base.clk} clk, +${after.cost - base.cost} µ$ spend, samples ${before.samples}→${replay.samples}`)
await db.close()
redis.disconnect()
