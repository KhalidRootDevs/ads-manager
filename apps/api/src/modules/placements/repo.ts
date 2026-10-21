import type { Db } from "@orbit/db"
import { ADMIN_MAX_MS } from "../../lib/mongo"
import { opt, revUpdate, type Session } from "../../lib/rev"
import { models, type Lean } from "../../lib/types"

const CI = { locale: "en", strength: 2 }

export function placementsRepo(db: Db) {
  const { Placement, Property } = models(db)
  return {
    /** Q1 by property uses `{ propertyId: 1, name: 1 }` (prefix + sort, same collation). Q2 global list: ≤ 1 k docs. */
    list: (propertyId?: string) =>
      (propertyId ? Placement.find({ propertyId }).collation(CI).sort({ propertyId: 1, name: 1 }) : Placement.find({}).sort({ name: 1 })).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),
    byId: (id: string, session?: Session) => Placement.findById(id, null, opt(session)).maxTimeMS(ADMIN_MAX_MS).lean<Lean>(),
    property: (id: string) => Property.findById(id, { name: 1, formats: 1, platform: 1 }).lean<Lean>(),
    insert: async (doc: Lean, session?: Session) => {
      await Placement.create([doc], opt(session))
      return Placement.findById(doc._id, null, opt(session)).lean<Lean>()
    },
    update: (id: string, rev: number, set: Lean, session?: Session) => revUpdate(Placement, id, rev, { $set: set }, session),
  }
}
export type PlacementsRepo = ReturnType<typeof placementsRepo>
