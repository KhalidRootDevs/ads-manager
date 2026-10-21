import type { Db } from "@orbit/db"
import { trusted } from "@orbit/db"
import { ADMIN_MAX_MS } from "../../lib/mongo"
import { opt, revUpdate, type Session } from "../../lib/rev"
import { models, type Lean } from "../../lib/types"

const CI = { locale: "en", strength: 2 }
const PROJ = { sso: 0 }

export function usersRepo(db: Db) {
  const { User } = models(db)
  return {
    /** Team list: < 100 documents, no index needed (§6.4 users Q2). */
    listVisible: () => User.find({ status: trusted({ $ne: "disabled" }) }, PROJ).sort({ createdAt: 1 }).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),
    listAll: () => User.find({}, { name: 1, email: 1, status: 1 }).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),
    byId: (id: string, session?: Session) => User.findById(id, PROJ, opt(session)).maxTimeMS(ADMIN_MAX_MS).lean<Lean>(),
    /** Login / SSO callback (§6.4 users Q1): case-insensitive via the unique email index's collation. */
    byEmail: (email: string) => User.findOne({ email: email.toLowerCase() }, PROJ).collation(CI).maxTimeMS(ADMIN_MAX_MS).lean<Lean>(),
    insert: async (doc: Lean, session?: Session) => {
      await User.create([doc], opt(session))
      return User.findById(doc._id, PROJ, opt(session)).lean<Lean>()
    },
    update: (id: string, rev: number, update: Lean, session?: Session) => revUpdate(User, id, rev, update, session),
    countActiveOwners: (session?: Session) => User.countDocuments({ role: "owner", status: "active" }, opt(session)).maxTimeMS(ADMIN_MAX_MS),
    /** Activity heartbeat: not a business edit, so no rev bump and no updatedAt change. */
    touch: (id: string, at: Date) => User.updateOne({ _id: id }, { $set: { lastActiveAt: at } }, { timestamps: false }),
    setSso: (id: string, sso: { provider: string; subject: string }) => User.updateOne({ _id: id }, { $set: { sso } }, { timestamps: false }),
  }
}
export type UsersRepo = ReturnType<typeof usersRepo>
