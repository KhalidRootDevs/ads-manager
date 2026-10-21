import type { Db } from "@orbit/db"
import { trusted } from "@orbit/db"
import { escapeRegex } from "../../lib/cursor"
import { ADMIN_MAX_MS } from "../../lib/mongo"
import { opt, revUpdate, type Session } from "../../lib/rev"
import { models, type Lean } from "../../lib/types"

const SEARCH_LIMIT = 200

export function creativesRepo(db: Db, log: { warn: (o: object, m: string) => void }) {
  const { Creative, CreativeVersion, Campaign } = models(db)
  const statusFilter = (includeArchived: boolean) => (includeArchived ? {} : { status: trusted({ $ne: "archived" }) })
  const regexSearch = (q: string, includeArchived: boolean) => {
    const rx = () => trusted({ $regex: escapeRegex(q), $options: "i" })
    return Creative.find({ ...statusFilter(includeArchived), $or: [{ name: rx() }, { "copy.headline": rx() }] })
      .sort({ updatedAt: -1 }).limit(SEARCH_LIMIT).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>()
  }
  return {
    /** Q1 library list: ≤ 5 k docs, newest first, no secondary index in v1 (§6.4 creatives). */
    list: (includeArchived: boolean) => Creative.find(statusFilter(includeArchived)).sort({ updatedAt: -1 }).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),
    /** Atlas Search (`creatives_search` on name + copy.headline); falls back to a bounded regex scan off Atlas. */
    async search(q: string, includeArchived: boolean): Promise<Lean[]> {
      try {
        const rows = await Creative.aggregate<Lean>([
          { $search: { index: "creatives_search", text: { query: q, path: ["name", "copy.headline"], fuzzy: { maxEdits: 1 } } } },
          { $match: includeArchived ? {} : { status: { $ne: "archived" } } },
          { $limit: SEARCH_LIMIT },
        ]).option({ maxTimeMS: ADMIN_MAX_MS })
        if (rows.length) return rows
      } catch (err) {
        log.warn({ err: (err as Error).message }, "Atlas Search unavailable; using regex fallback")
      }
      return regexSearch(q, includeArchived)
    },
    byId: (id: string, session?: Session) => Creative.findById(id, null, opt(session)).maxTimeMS(ADMIN_MAX_MS).lean<Lean>(),
    insert: async (doc: Lean, session?: Session) => {
      await Creative.create([doc], opt(session))
      return Creative.findById(doc._id, null, opt(session)).lean<Lean>()
    },
    update: (id: string, rev: number, update: Lean, session?: Session) => revUpdate(Creative, id, rev, update, session),
    insertVersion: (doc: Lean, session?: Session) => CreativeVersion.create([doc], opt(session)),
    /** creative_versions I1 `{ creativeId: 1, v: -1 }`. */
    versions: (creativeId: string) => CreativeVersion.find({ creativeId }, { snapshot: 0 }).sort({ v: -1 }).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),
    /** campaigns Q4 (I3 `{ creativeIds: 1 }`). */
    campaignsUsing: (creativeId: string, statuses: string[], session?: Session) =>
      Campaign.find({ creativeIds: creativeId, status: trusted({ $in: statuses }) }, { name: 1, status: 1 }, opt(session)).hint({ creativeIds: 1 }).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),
  }
}
export type CreativesRepo = ReturnType<typeof creativesRepo>
