/** Compiler data access (the only compiler code that touches Mongoose models). */
import { SERVABLE_CAMPAIGN_STATUSES, type HealthIssue } from "@orbit/domain"
import { trusted, type Db } from "@orbit/db"
import type { CompileInput } from "./compile"

const MAX_MS = 10_000

export async function loadCompileInput(db: Db): Promise<CompileInput> {
  const m = db.models
  const campaigns = await m.Campaign.find({ status: trusted({ $in: SERVABLE_CAMPAIGN_STATUSES }) }, { name: 1, status: 1, priority: 1, flight: 1, creativeIds: 1, targets: 1, constraints: 1, budget: 1, health: 1 })
    .lean().maxTimeMS(MAX_MS)
  const creativeIds = [...new Set(campaigns.flatMap((c) => c.creativeIds))]
  const [creatives, properties, placements, countries, keys, settings, stats] = await Promise.all([
    m.Creative.find({ _id: trusted({ $in: creativeIds }) }, { name: 1, format: 1, size: 1, status: 1, assets: 1, copy: 1, destination: 1, altText: 1, options: 1 }).lean().maxTimeMS(MAX_MS),
    m.Property.find({}, { name: 1, platform: 1, identifier: 1, status: 1, env: 1, testMode: 1, countryRule: 1, sdk: 1 }).lean().maxTimeMS(MAX_MS),
    m.Placement.find({}, { propertyId: 1, name: 1, format: 1, size: 1, status: 1, minAppVersion: 1, refreshSec: 1 }).lean().maxTimeMS(MAX_MS),
    m.Country.find({}, { name: 1, enabled: 1 }).lean().maxTimeMS(MAX_MS),
    m.PropertyKey.find({ status: trusted({ $in: ["active", "grace"] }) }, { propertyId: 1, hash: 1, env: 1, status: 1, graceUntil: 1 }).lean().maxTimeMS(MAX_MS),
    m.Settings.findOne({ _id: "global" }, { killSwitch: 1, defaults: 1 }).lean().maxTimeMS(MAX_MS),
    m.CampaignStats.find({ _id: trusted({ $in: campaigns.map((c) => c._id) }) }, { lifetime: 1 }).lean().maxTimeMS(MAX_MS),
  ])
  const spend: Record<string, number> = {}
  for (const s of stats) spend[s._id as string] = Number(s.lifetime?.costMicros ?? 0)
  return { campaigns, creatives, properties, placements, countries, keys, settings, spend } as unknown as CompileInput
}

/**
 * Persist `campaigns.health` with the native collection, so `updatedAt`/`rev` stay untouched and the change-stream
 * filter (which ignores `health*`-only updates) doesn't trigger another compile.
 */
export async function writeHealth(db: Db, id: string, issues: HealthIssue[], at: Date) {
  await db.models.Campaign.collection.updateOne({ _id: id } as never, { $set: { health: { issues, checkedAt: at } } })
}
