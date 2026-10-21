import type { Db } from "@orbit/db"
import { ADMIN_MAX_MS } from "../../lib/mongo"
import { opt, type Session } from "../../lib/rev"
import { models, type Lean } from "../../lib/types"

export function eventsRepo(db: Db) {
  const { EventDefinition } = models(db)
  return {
    list: () => EventDefinition.find({}).sort({ createdAt: 1 }).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),
    byKey: (key: string) => EventDefinition.findById(key).lean<Lean>(),
    insert: async (doc: Lean, session?: Session) => {
      await EventDefinition.create([doc], opt(session))
      return EventDefinition.findById(doc._id, null, opt(session)).lean<Lean>()
    },
    update: (key: string, set: Lean, session?: Session) =>
      EventDefinition.findOneAndUpdate({ _id: key }, { $set: set }, { returnDocument: "after", runValidators: true, ...opt(session) }).lean<Lean>(),
  }
}
export type EventsRepo = ReturnType<typeof eventsRepo>
