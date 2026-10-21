import type { Db } from "@orbit/db"
import { opt, type Session } from "../lib/rev"
import { models, type Lean } from "../lib/types"

/** `sessions` (§6.4): `_id = sha256(token)`, TTL on `expiresAt`. */
export function sessionsRepo(db: Db) {
  const { Session: S } = models(db)
  return {
    insert: (doc: { _id: string; userId: string; expiresAt: Date; absoluteExpiresAt: Date; ip: string | null; ua: string | null }) => S.create(doc),
    byId: (id: string) => S.findById(id).maxTimeMS(2_000).lean<Lean>(),
    slide: (id: string, expiresAt: Date) => S.updateOne({ _id: id }, { $set: { expiresAt } }),
    remove: (id: string) => S.deleteOne({ _id: id }),
    /** "Sign out everywhere" (Q2): rare, < 500 live documents, no index on purpose. */
    removeForUser: (userId: string, session?: Session) => S.deleteMany({ userId }, opt(session)),
  }
}
export type SessionsRepo = ReturnType<typeof sessionsRepo>
