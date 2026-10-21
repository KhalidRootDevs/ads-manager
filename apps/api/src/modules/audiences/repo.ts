import type { Db } from "@orbit/db"
import { ADMIN_MAX_MS } from "../../lib/mongo"
import { opt, type Session } from "../../lib/rev"
import { models, type Lean } from "../../lib/types"

export function audiencesRepo(db: Db) {
  const { Audience, Campaign } = models(db)
  return {
    list: () => Audience.find({}).sort({ createdAt: -1 }).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),
    byId: (id: string, session?: Session) => Audience.findById(id, null, opt(session)).lean<Lean>(),
    insert: async (doc: Lean, session?: Session) => {
      await Audience.create([doc], opt(session))
      return Audience.findById(doc._id, null, opt(session)).lean<Lean>()
    },
    remove: (id: string, session?: Session) => Audience.deleteOne({ _id: id }, opt(session)),
    /**
     * Referential cleanup (§6.9). No index on `constraints.audienceIds`: this rare admin action scans ≤ 3 k campaigns.
     * Campaigns' `rev` is bumped so open editors see the change.
     */
    pullFromCampaigns: (id: string, session?: Session) =>
      Campaign.updateMany({ "constraints.audienceIds": id }, { $pull: { "constraints.audienceIds": id }, $inc: { rev: 1 } }, opt(session)),
  }
}
export type AudiencesRepo = ReturnType<typeof audiencesRepo>
