import type { Db } from "@orbit/db"
import { ADMIN_MAX_MS } from "../../lib/mongo"
import { opt, revUpdate, type Session } from "../../lib/rev"
import { models, type Lean } from "../../lib/types"

/** `budgets._id = "<team>:<quarter>"`; read in full (≈ 30 docs/year), no secondary index. */
export function budgetsRepo(db: Db) {
  const { Budget } = models(db)
  return {
    forQuarter: (quarter: string) => Budget.find({ quarter }).sort({ team: 1 }).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),
    byId: (id: string, session?: Session) => Budget.findById(id, null, opt(session)).lean<Lean>(),
    insert: async (doc: Lean, session?: Session) => {
      await Budget.create([doc], opt(session))
      return Budget.findById(doc._id, null, opt(session)).lean<Lean>()
    },
    update: (id: string, rev: number, set: Lean, session?: Session) => revUpdate(Budget, id, rev, { $set: set }, session),
  }
}
export type BudgetsRepo = ReturnType<typeof budgetsRepo>
