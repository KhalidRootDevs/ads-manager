/**
 * One-off: point already-seeded demo creatives at local placeholder files and write those files.
 * Only rewrites asset URLs under the old demo host; touches nothing else (no rev/updatedAt change).
 */
import "./env"
import { fileURLToPath } from "node:url"
import { connect, dbConfigFromEnv, trusted } from "../src"
import { DEMO_UPLOAD_ID, writeDemoAssets } from "../src/seed"

const OLD = "https://cdn.orbit.example/demo"
const base = `${(process.env.CDN_BASE_URL ?? "http://localhost:4000/media").replace(/\/$/, "")}/${DEMO_UPLOAD_ID}`
const db = await connect(dbConfigFromEnv("seed"))
try {
  const list = await db.models.Creative.find({ "assets.url": trusted({ $regex: `^${OLD.replace(/\./g, "\\.")}/` }) }, { assets: 1, options: 1 }).lean()
  for (const c of list) {
    const assets = c.assets.map((a) => ({ ...a, url: a.url.startsWith(OLD + "/") ? `${base}/${a.url.slice(OLD.length + 1)}` : a.url }))
    await db.models.Creative.collection.updateOne({ _id: c._id } as never, { $set: { assets } })
  }
  const all = await db.models.Creative.find({ "assets.url": trusted({ $regex: `^${base.replace(/[.]/g, "\\.")}/` }) }, { assets: 1, options: 1 }).lean()
  const dir = process.env.UPLOAD_DIR ?? fileURLToPath(new URL("../../../.data/uploads", import.meta.url))
  console.log(`Updated ${list.length} creatives; wrote ${writeDemoAssets(dir, all as never)} placeholder files`)
} finally {
  await db.close()
}
