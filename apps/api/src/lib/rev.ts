/** Optimistic concurrency (§6.2, §6.13): `{ _id, rev }` filter, `$inc: { rev: 1 }`, validators on. Used by repos only. */
import type { ClientSession, Model, UpdateQuery } from "mongoose"
import { ADMIN_MAX_MS } from "./mongo"
import type { Lean } from "./types"

export async function revUpdate(model: Model<any>, id: string, rev: number, update: UpdateQuery<any>, session?: ClientSession | null): Promise<Lean | null> {
  const u = { ...update, $inc: { ...((update.$inc as object) ?? {}), rev: 1 } }
  return model
    .findOneAndUpdate({ _id: id, rev }, u, { returnDocument: "after", runValidators: true, session: session ?? undefined })
    .maxTimeMS(ADMIN_MAX_MS)
    .lean<Lean>()
    .exec()
}

export type Session = ClientSession | null | undefined
export const opt = (session: Session) => (session ? { session } : {})
