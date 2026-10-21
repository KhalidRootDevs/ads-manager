/**
 * Migration runner and index governance (guideline §6.2, §6.6, §6.13).
 *
 * Safety rules (shared dev cluster):
 * - Only ever touches the configured Orbit database (`assertOrbitDb`).
 * - Never drops or renames collections, and never drops indexes automatically.
 *   `syncIndexes()` is not used; an index that should go is removed by a reviewed migration.
 */
import type { Connection } from "mongoose"
import type { Db, Models } from "./connection"
import { VALIDATION_ACTION, VALIDATORS } from "./validators"

export interface Migration {
  id: string
  description: string
  up(db: Db): Promise<void>
}

/** The 22 B-tree indexes of §6.6, by collection, as declared in the schemas. */
export function declaredIndexes(models: Models) {
  const out: { collection: string; key: Record<string, unknown>; options: Record<string, unknown> }[] = []
  for (const m of Object.values(models)) {
    for (const [key, options] of m.schema.indexes()) out.push({ collection: m.collection.collectionName, key: key as Record<string, unknown>, options: options as Record<string, unknown> })
  }
  return out
}

export const EXPECTED_INDEX_COUNT = 22

/** Non-fatal environment limitations seen during a run, printed once at the end. */
const notices = new Set<string>()

/** Create a collection with its validator, or update the validator if it already exists. Never drops. */
export async function ensureCollection(conn: Connection, name: string, extra: Record<string, unknown> = {}) {
  const exists = (await conn.db!.listCollections({ name }, { nameOnly: true }).toArray()).length > 0
  const validator = VALIDATORS[name]
  const validation = validator ? { validator, validationLevel: "strict", validationAction: VALIDATION_ACTION[name] ?? "error" } : {}
  if (!exists) {
    try {
      await conn.db!.createCollection(name, { ...extra, ...validation } as never)
    } catch (e) {
      // Shared Atlas tiers reject storageEngine options (zstd); fall back to the default compressor.
      if (!("storageEngine" in extra) || !/storageEngine/.test((e as Error).message)) throw e
      notices.add("zstd compression unavailable on this tier (rollups use the default compressor)")
      await conn.db!.createCollection(name, validation as never)
    }
    return "created"
  }
  if (validator) {
    try {
      await conn.db!.command({ collMod: name, ...validation })
    } catch (e) {
      // Atlas app users (and shared tiers) may lack collMod; the validator set at creation stays in force.
      if ((e as { code?: number }).code !== 8000 && (e as { codeName?: string }).codeName !== "Unauthorized") throw e
      notices.add("validators on existing collections were not updated: the database user lacks collMod (grant it to the migration user in production)")
      return "unchanged"
    }
  }
  return "updated"
}

const ZSTD = { storageEngine: { wiredTiger: { configString: "block_compressor=zstd" } } }

export const MIGRATIONS: Migration[] = [
  {
    id: "0001_init",
    description: "Collections, validators, time-series request_samples and the §6.6 indexes",
    async up(db) {
      const conn = db.primary
      const rollups = new Set(["delivery_daily", "supply_daily"])
      for (const m of Object.values(db.models)) {
        const name = m.collection.collectionName
        if (name === "request_samples") {
          const exists = (await conn.db!.listCollections({ name }, { nameOnly: true }).toArray()).length > 0
          if (!exists) await conn.db!.createCollection(name, { timeseries: { timeField: "at", metaField: "k", granularity: "seconds" }, expireAfterSeconds: 604_800 })
          continue
        }
        await ensureCollection(conn, name, rollups.has(name) ? ZSTD : {})
      }
      for (const m of Object.values(db.models)) await m.createIndexes()
    },
  },
  {
    id: "0002_creatives_search",
    description: "Atlas Search index on creatives (name, copy.headline) for the library search box",
    async up(db) {
      try {
        const existing = await db.models.Creative.collection.listSearchIndexes(CREATIVE_SEARCH_INDEX.name).toArray()
        if (!existing.length) await db.models.Creative.collection.createSearchIndex(CREATIVE_SEARCH_INDEX)
      } catch (e) {
        // Not Atlas (local replica set, memory server) or search not enabled: the API falls back to a bounded regex scan.
        notices.add(`Atlas Search unavailable (${(e as Error).message.slice(0, 80)}); creative search uses the regex fallback`)
      }
    },
  },
]

/** The one search index in the system (§6.6). */
export const CREATIVE_SEARCH_INDEX = {
  name: "creatives_search",
  definition: { mappings: { dynamic: false, fields: { name: { type: "string" }, copy: { type: "document", fields: { headline: { type: "string" } } } } } },
}

export async function runMigrations(db: Db, log: (s: string) => void = console.log) {
  const coll = db.primary.db!.collection<{ _id: string; at: Date; description: string }>("_migrations")
  const done = new Set((await coll.find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id))
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) {
      log(`= ${m.id} already applied`)
      continue
    }
    log(`→ ${m.id}: ${m.description}`)
    await m.up(db)
    await coll.insertOne({ _id: m.id, at: new Date(), description: m.description })
    log(`✓ ${m.id}`)
  }
  for (const n of notices) log(`! ${n}`)
  notices.clear()
}

export interface DriftReport {
  collection: string
  toCreate: string[]
  toDrop: string[]
}

/** Declared vs actual indexes per model (`Model.diffIndexes()`); any difference fails CI. */
export async function indexDrift(db: Db): Promise<DriftReport[]> {
  const out: DriftReport[] = []
  for (const m of Object.values(db.models)) {
    if (m.collection.collectionName === "request_samples") continue // automatic meta+time index only
    const exists = (await db.primary.db!.listCollections({ name: m.collection.collectionName }, { nameOnly: true }).toArray()).length > 0
    if (!exists) {
      out.push({ collection: m.collection.collectionName, toCreate: m.schema.indexes().map(([k]) => JSON.stringify(k)), toDrop: [] })
      continue
    }
    const diff = await m.diffIndexes()
    const toCreate = diff.toCreate.map((x) => JSON.stringify(x))
    const toDrop = diff.toDrop.map((x) => String(x))
    if (toCreate.length || toDrop.length) out.push({ collection: m.collection.collectionName, toCreate, toDrop })
  }
  return out
}
