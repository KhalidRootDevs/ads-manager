/**
 * `pnpm db:seed [--reset] [--today=YYYY-MM-DD]`: load the demo workspace into the Orbit database (MONGODB_DB).
 * Without --reset it refuses to touch a database that already has campaigns. --reset empties Orbit's own collections
 * with deleteMany (never drops, never touches `_migrations` or other databases).
 * Clear SDK key secrets for a few demo properties go to project/.data/demo-keys.json (git-ignored); they are never printed.
 */
import "./env"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { APP_HEADER, KEY_HEADER } from "@orbit/domain"
import { connect, dbConfigFromEnv } from "../src"
import { DEMO_UPLOAD_ID, ensureMigrated, hasData, resetDatabase, seedDatabase, writeDemoAssets } from "../src/seed"

const args = process.argv.slice(2)
const reset = args.includes("--reset")
const today = args.find((a) => a.startsWith("--today="))?.slice(8)
const pepper = process.env.KEY_PEPPER ?? ""
if (!pepper) {
  console.error("KEY_PEPPER is not set (see .env.example)")
  process.exit(1)
}
const KEYS_FILE = fileURLToPath(new URL("../../../.data/demo-keys.json", import.meta.url))
/** Prototype ids of the properties whose secrets are written for local ad-server calls. */
const KEY_PROPS = ["p1", "p2", "p3", "w1", "w2"]

async function main() {
  const db = await connect(dbConfigFromEnv("seed"))
  try {
    await run(db)
  } finally {
    await db.close()
  }
}

async function run(db: Awaited<ReturnType<typeof connect>>) {
  console.log(`Seeding database "${db.primary.name}"`)
  await ensureMigrated(db, console.log)
  if (await hasData(db)) {
    if (!reset) {
      console.log("The database already has campaigns; nothing to do. Run `pnpm db:seed --reset` to replace them with fresh demo data.")
      return
    }
    const deleted = await resetDatabase(db)
    console.log(`Reset: deleted ${Object.values(deleted).reduce((a, b) => a + b, 0).toLocaleString("en-US")} documents from ${Object.keys(deleted).length} Orbit collections`)
  }
  const cdnBase = `${(process.env.CDN_BASE_URL ?? "http://localhost:4000/media").replace(/\/$/, "")}/${DEMO_UPLOAD_ID}`
  const res = await seedDatabase(db, { pepper, today, log: console.log, cdnBase })
  const uploadDir = process.env.UPLOAD_DIR ?? fileURLToPath(new URL("../../../.data/uploads", import.meta.url))
  console.log(`Wrote ${writeDemoAssets(uploadDir, res.demo.creatives)} placeholder asset files for local previews`)
  const width = Math.max(...Object.keys(res.counts).map((k) => k.length))
  for (const [k, v] of Object.entries(res.counts).sort()) console.log(`  ${k.padEnd(width)}  ${v.toLocaleString("en-US").padStart(7)}`)

  const { demo } = res
  const out = KEY_PROPS.map((proto) => {
    const p = demo.properties.find((x) => x.id === demo.idMap[proto])!
    const secret = (env: "live" | "test") => res.secrets.find((s) => s.propertyId === p.id && s.env === env)?.secret ?? null
    return {
      propertyId: p.id, name: p.name, platform: p.platform, identifier: p.identifier, testMode: p.testMode,
      keys: { live: secret("live"), test: secret("test") },
      placements: demo.placements.filter((pl) => pl.propertyId === p.id).map((pl) => ({ id: pl.id, name: pl.name, format: pl.format, size: pl.size, status: pl.status })),
    }
  })
  mkdirSync(dirname(KEYS_FILE), { recursive: true })
  writeFileSync(
    KEYS_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), database: db.primary.name, headers: { app: APP_HEADER, key: KEY_HEADER }, adServerUrl: process.env.AD_SERVER_URL ?? null, properties: out }, null, 2) + "\n",
    { mode: 0o600 },
  )
  console.log(`Demo SDK keys for ${out.length} properties written to ${KEYS_FILE}`)
  console.log(`Dev login: ${demo.users.find((u) => u.role === "owner")!.email} (owner); all users: firstname.lastname@orbit.example`)
}

await main()
