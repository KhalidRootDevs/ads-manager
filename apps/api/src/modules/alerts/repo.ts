import type { Db } from "@orbit/db"
import { trusted } from "@orbit/db"
import { ADMIN_MAX_MS } from "../../lib/mongo"
import { opt, type Session } from "../../lib/rev"
import { models, type Lean } from "../../lib/types"

export function alertsRepo(db: Db) {
  const { Alert } = models(db)
  return {
    /** Q1 open (and acknowledged) alerts: < 100 docs thanks to the TTL, newest first by ULID `_id`. */
    listOpen: () => Alert.find({ status: trusted({ $in: ["open", "acked"] }) }).sort({ _id: -1 }).limit(500).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),
    byId: (id: string) => Alert.findById(id).lean<Lean>(),
    ack: (id: string, by: string, session?: Session) =>
      Alert.findOneAndUpdate({ _id: id, status: "open" }, { $set: { status: "acked", ackedBy: by } }, { returnDocument: "after", runValidators: true, ...opt(session) }).lean<Lean>(),
  }
}
