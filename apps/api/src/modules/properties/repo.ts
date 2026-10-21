import type { Db } from "@orbit/db"
import { trusted } from "@orbit/db"
import { ADMIN_MAX_MS } from "../../lib/mongo"
import { opt, revUpdate, type Session } from "../../lib/rev"
import { models, roModels, type Lean } from "../../lib/types"

export function propertiesRepo(db: Db) {
  const { Property, PropertyKey, Placement } = models(db)
  const { RequestSampleRO } = roModels(db)
  return {
    /** Q2: all properties (≤ 200), filtered in the UI. */
    list: () => Property.find({}).sort({ name: 1 }).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),
    byId: (id: string, session?: Session) => Property.findById(id, null, opt(session)).maxTimeMS(ADMIN_MAX_MS).lean<Lean>(),
    insert: async (doc: Lean, session?: Session) => {
      await Property.create([doc], opt(session))
      return Property.findById(doc._id, null, opt(session)).lean<Lean>()
    },
    update: (id: string, rev: number, update: Lean, session?: Session) => revUpdate(Property, id, rev, update, session),

    /** Credentials tab (property_keys I1 `{ propertyId: 1 }`). */
    keys: (propertyId: string) => PropertyKey.find({ propertyId }, { hash: 0 }).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),
    key: (id: string, session?: Session) => PropertyKey.findById(id, { hash: 0 }, opt(session)).lean<Lean>(),
    insertKey: async (doc: Lean, session?: Session) => {
      await PropertyKey.create([doc], opt(session))
      return PropertyKey.findById(doc._id, { hash: 0 }, opt(session)).lean<Lean>()
    },
    /** Status transition guarded by the expected current status (keys have no rev). */
    updateKey: (id: string, fromStatus: string, set: Lean, session?: Session) =>
      PropertyKey.findOneAndUpdate({ _id: id, status: fromStatus }, { $set: set }, { returnDocument: "after", runValidators: true, projection: { hash: 0 }, ...opt(session) }).lean<Lean>(),

    firstActivePlacement: (propertyId: string) =>
      Placement.findOne({ propertyId, status: "active" }, { _id: 1, name: 1 }).collation({ locale: "en", strength: 2 }).sort({ propertyId: 1, name: 1 }).lean<Lean>(),
    placementNames: async (ids: string[]) => {
      if (!ids.length) return {} as Record<string, string>
      const rows = await Placement.find({ _id: trusted({ $in: ids }) }, { name: 1 }).lean<Lean[]>()
      return Object.fromEntries(rows.map((r) => [r._id, r.name])) as Record<string, string>
    },
    /** request_samples Q1: latest N for a property in the last 24 h (automatic meta+time index), analytics connection. */
    samples: (propertyId: string, since: Date, limit: number) =>
      RequestSampleRO.find({ "k.p": propertyId, at: trusted({ $gte: since }) }).sort({ at: -1 }).limit(limit).maxTimeMS(5_000).lean<Lean[]>(),
  }
}
export type PropertiesRepo = ReturnType<typeof propertiesRepo>
