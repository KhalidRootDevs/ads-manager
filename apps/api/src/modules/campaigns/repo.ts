import type { Db } from "@orbit/db"
import { trusted } from "@orbit/db"
import { LIVE_CAMPAIGN_STATUSES } from "@orbit/domain"
import { escapeRegex } from "../../lib/cursor"
import { ADMIN_MAX_MS } from "../../lib/mongo"
import { opt, revUpdate, type Session } from "../../lib/rev"
import { models, type Lean } from "../../lib/types"

const CI = { locale: "en", strength: 2 }
/** Extra rows fetched per page so equal `updatedAt` values can be ordered by `_id` in memory. */
export const TIE_SLACK = 10

export interface ListOptions {
  statuses: string[]
  cursor: { updatedAt: Date; id: string } | null
  propertyId?: string
  creativeId?: string
  q?: string
  limit: number
}

export function campaignsRepo(db: Db) {
  const { Campaign, CampaignStats, CampaignRevision, Property, Placement, Creative, Country, Budget } = models(db)
  return {
    /**
     * Q1 list (§6.7): `status ∈ …` sorted by `updatedAt` desc on I1 `{ status: 1, updatedAt: -1 }` (SORT_MERGE, no blocking sort).
     * Property / creative filters use I2 / I3 instead. The cursor bound is `updatedAt ≤ cursor`; ties are resolved by the caller.
     */
    list(o: ListOptions) {
      const filter: Lean = { status: trusted({ $in: o.statuses }) }
      if (o.cursor) filter.updatedAt = trusted({ $lte: o.cursor.updatedAt })
      if (o.propertyId) filter["targets.propertyId"] = o.propertyId
      if (o.creativeId) filter.creativeIds = o.creativeId
      if (o.q) filter.name = trusted({ $regex: escapeRegex(o.q), $options: "i" })
      const q = Campaign.find(filter).sort({ updatedAt: -1 }).limit(o.limit + 1 + TIE_SLACK).maxTimeMS(ADMIN_MAX_MS)
      if (o.propertyId) q.hint({ "targets.propertyId": 1 })
      else if (o.creativeId) q.hint({ creativeIds: 1 })
      return q.lean<Lean[]>()
    },
    countsByStatus: () => Campaign.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]).option({ maxTimeMS: ADMIN_MAX_MS }),
    countNeedsAttention: () => Campaign.countDocuments({ status: "active", "health.issues.0": trusted({ $exists: true }) }).maxTimeMS(ADMIN_MAX_MS),

    byId: (id: string, session?: Session) => Campaign.findById(id, null, opt(session)).maxTimeMS(ADMIN_MAX_MS).lean<Lean>(),
    insert: async (doc: Lean, session?: Session) => {
      await Campaign.create([doc], opt(session))
      return Campaign.findById(doc._id, null, opt(session)).lean<Lean>()
    },
    update: (id: string, rev: number, update: Lean, session?: Session) => revUpdate(Campaign, id, rev, update, session),

    /** Q5: is the name used by another live (non-archived) campaign? Served by I4 (unique, CI collation, partial live). */
    nameTaken: async (name: string, excludeId: string | undefined, session?: Session) => {
      const hit = await Campaign.findOne({ name: name.trim(), live: true }, { _id: 1 }, opt(session)).collation(CI).lean<Lean>()
      return !!hit && hit._id !== excludeId
    },
    /** Live campaigns of a team (budget allocation), on I1's status prefix. */
    liveForTeam: (team: string, session?: Session) =>
      Campaign.find({ status: trusted({ $in: LIVE_CAMPAIGN_STATUSES }), team }, { team: 1, status: 1, budget: 1 }, opt(session)).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),

    stats: (ids: string[]) => (ids.length ? CampaignStats.find({ _id: trusted({ $in: ids }) }).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>() : Promise.resolve([] as Lean[])),
    statsOne: (id: string, session?: Session) => CampaignStats.findById(id, null, opt(session)).lean<Lean>(),

    insertRevision: (doc: Lean, session?: Session) => CampaignRevision.create([doc], opt(session)),
    /** campaign_revisions I1 `{ campaignId: 1, rev: -1 }`. */
    latestRevision: (campaignId: string, session?: Session) => CampaignRevision.findOne({ campaignId }, null, opt(session)).sort({ rev: -1 }).lean<Lean>(),
    revisions: (campaignId: string) => CampaignRevision.find({ campaignId }, { snapshot: 0 }).sort({ rev: -1 }).limit(100).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),

    // ---------- reads for validation, health and the targeting matrix ----------
    properties: (ids: string[], session?: Session) => (ids.length ? Property.find({ _id: trusted({ $in: ids }) }, null, opt(session)).lean<Lean[]>() : Promise.resolve([] as Lean[])),
    placements: (ids: string[], session?: Session) => (ids.length ? Placement.find({ _id: trusted({ $in: ids }) }, null, opt(session)).lean<Lean[]>() : Promise.resolve([] as Lean[])),
    creatives: (ids: string[], session?: Session) => (ids.length ? Creative.find({ _id: trusted({ $in: ids }) }, null, opt(session)).lean<Lean[]>() : Promise.resolve([] as Lean[])),
    countries: (session?: Session) => Country.find({}, null, opt(session)).lean<Lean[]>(),
    budget: (id: string, session?: Session) => Budget.findById(id, null, opt(session)).lean<Lean>(),
  }
}
export type CampaignsRepo = ReturnType<typeof campaignsRepo>
