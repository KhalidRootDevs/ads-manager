/**
 * Decision-path CPU benchmark (§4.4: target < 2 ms CPU per decision). Realistic placement: 25 candidates, 10 countries.
 * Vitest 5 API: benchmarks are registered through the test context. Run: pnpm --filter @orbit/ad-server bench
 */
import { eligible, pick } from "@orbit/domain"
import { signToken } from "@orbit/domain/node"
import { test } from "vitest"
import { authenticate } from "../src/decision"
import { prepare } from "../src/index-store"
import { APP, candidate, CMP, fixtureIndex, LIVE, PEPPER, PL, ring } from "../test/fixtures"

const many = Array.from({ length: 25 }, (_, i) =>
  candidate({ campaignId: `${CMP.slice(0, -2)}${String(i).padStart(2, "0")}`, priority: ((i % 3) + 1) as 1 | 2 | 3, countries: i % 4 ? ["BD", "IN", "PK", "NP", "LK", "AE", "SA", "QA", "KW", "MY"] : ["IN"] }),
)
const p = prepare(fixtureIndex(many))
const now = Date.now()
const payload = { r: "req_x", c: CMP, cr: "crv_x", p: APP, pl: PL, cc: "BD", dv: "ph", pf: "an", f: "banner", ts: Math.floor(now / 1000), cpi: 1800 }

test("decision path", async ({ bench }) => {
  const res = await bench.compare(
    bench("authenticate (cached key hash)", () => {
      authenticate(p, APP, LIVE, undefined, { keyPepper: PEPPER, allowLocalOrigins: false }, now)
    }),
    bench("eligible + pick (25 candidates)", () => {
      const el = eligible(p.index, { placementId: PL, propertyId: APP, country: "BD", device: "phone", appVersion: "6.2.1", test: false, now })
      if (el.ok) pick(el.candidates)
    }),
    bench("full CPU path (auth + eligible + pick + 2 signed tokens)", () => {
      authenticate(p, APP, LIVE, undefined, { keyPepper: PEPPER, allowLocalOrigins: false }, now)
      const el = eligible(p.index, { placementId: PL, propertyId: APP, country: "BD", device: "phone", appVersion: "6.2.1", test: false, now })
      if (el.ok) pick(el.candidates)
      signToken(payload, ring)
      signToken({ ...payload, d: "https://example.com/land" }, ring)
    }),
  )
  const names = ["authenticate (cached key hash)", "eligible + pick (25 candidates)", "full CPU path (auth + eligible + pick + 2 signed tokens)"] as const
  const rows = names.map((name) => [name, res.get(name)] as const).map(
    ([name, r]) => `${name.padEnd(58)} mean ${(r.latency.mean * 1000).toFixed(2).padStart(8)} µs   p99 ${(r.latency.p99 * 1000).toFixed(2).padStart(8)} µs   ${Math.round(r.throughput.mean).toLocaleString("en-US")} ops/s`,
  )
  process.stderr.write("\n" + rows.join("\n") + "\n")
})
