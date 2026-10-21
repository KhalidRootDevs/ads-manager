/**
 * Load test (autocannon) for the hot path. Usage (stack running, DB seeded):
 *   pnpm --filter @orbit/ad-server load [seconds=20] [connections=50]
 * 1. POST /v1/serve with a demo live key on a fillable placement (no uid → contextual, no caps).
 * 2. POST /v1/e on the collector with a fresh signed TEST token per request (t: 1 → excluded from rollups),
 *    so every request passes dedupe and waits for the broker ack.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { inSchedule, newId, SERVING, type ServingIndex } from "@orbit/domain"
import { parseSecrets, signToken } from "@orbit/domain/node"
import { createRedis } from "@orbit/server-kit"
import autocannon from "autocannon"

const duration = Number(process.argv[2] ?? 20)
const connections = Number(process.argv[3] ?? 50)
const AD = process.env.AD_SERVER_URL ?? "http://localhost:4100"
const T = process.env.TRACKING_URL ?? "http://localhost:4200"
const keys = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", ".data", "demo-keys.json"), "utf8")) as { properties: { propertyId: string; keys: { live?: string }; placements: { id: string }[] }[] }
const redis = createRedis(process.env.REDIS_URL ?? "redis://localhost:6379")
const v = await redis.get(SERVING.current)
const index = JSON.parse(gunzipSync((await redis.getBuffer(SERVING.index(v!)))!).toString()) as ServingIndex
redis.disconnect()
let target: { app: string; key: string; pl: string; cc: string } | null = null
for (const p of keys.properties) {
  for (const pl of p.placements) {
    const c = index.placements[pl.id]?.candidates.find((x) => x.countries.length && inSchedule(x, Date.now()))
    if (c && p.keys.live && !target) target = { app: p.propertyId, key: p.keys.live, pl: pl.id, cc: c.countries[0] }
  }
}
if (!target) throw new Error("no fillable placement")

const run = (o: autocannon.Options) => new Promise<autocannon.Result>((res, rej) => autocannon(o, (e, r) => (e ? rej(e) : res(r))))
const fmt = (name: string, r: autocannon.Result) =>
  `${name.padEnd(28)} ${Math.round(r.requests.average).toLocaleString("en-US").padStart(7)} req/s   p50 ${r.latency.p50} ms   p99 ${r.latency.p99} ms   max ${r.latency.max} ms   2xx ${r["2xx"]}  non-2xx ${r.non2xx}  errors ${r.errors}  timeouts ${r.timeouts}`

const serve = await run({
  url: `${AD}/v1/serve`, method: "POST", duration, connections,
  headers: { "content-type": "application/json", "x-orbit-app": target.app, "x-orbit-key": target.key, "x-orbit-debug-country": target.cc },
  body: JSON.stringify({ placementId: target.pl, device: { type: "phone", appVersion: "99.0.0" }, sdkVersion: "load" }),
})
const ring = parseSecrets(process.env.TRACKING_SECRETS!, process.env.TRACKING_ACTIVE_KID!)
const beacons = await run({
  url: `${T}/v1/e`, method: "POST", duration, connections, headers: { "content-type": "application/json" },
  requests: [{
    setupRequest: (req) => {
      const tok = signToken({ r: newId("request"), c: "cmp_LOADTEST", cr: "crv_LOADTEST", p: target!.app, pl: target!.pl, cc: "BD", dv: "ph", pf: "an", f: "banner", ts: Math.floor(Date.now() / 1000), cpi: 0, t: 1 }, ring)
      return { ...req, body: JSON.stringify({ events: [{ type: "imp", token: tok }] }) }
    },
  }],
})
console.log(`\nautocannon ${duration}s × ${connections} connections`)
console.log(fmt("ad-server POST /v1/serve", serve))
console.log(fmt("collector POST /v1/e", beacons))
