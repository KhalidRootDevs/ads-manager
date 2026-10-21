import type { Db } from "@orbit/db"
import { trusted } from "@orbit/db"
import { ADMIN_MAX_MS } from "../../lib/mongo"
import { opt, type Session } from "../../lib/rev"
import { models, type Lean } from "../../lib/types"

export interface AuditFilter {
  targetId?: string
  action?: string
  actorId?: string
  /** `_id` bounds: ULIDs are time-ordered, so an id range is a time range (§6.4 audit_log Q3). */
  idGte?: string
  idLt?: string
}

export function auditRepo(db: Db) {
  const { AuditLog } = models(db)
  return {
    insert: async (doc: Lean, session?: Session) => {
      await AuditLog.create([doc], opt(session))
    },
    /**
     * Q1 global feed: `_id` desc on the built-in index. Q2 per entity: `{ "target.id": 1, _id: -1 }`.
     * Action / actor filters are residual (rare, admin-only).
     */
    async list(f: AuditFilter, limit: number) {
      const idRange: Record<string, string> = {}
      if (f.idLt) idRange.$lt = f.idLt
      if (f.idGte) idRange.$gte = f.idGte
      const filter: Lean = {}
      if (f.targetId) filter["target.id"] = f.targetId
      if (Object.keys(idRange).length) filter._id = trusted(idRange)
      if (f.action) filter.action = f.action
      if (f.actorId) filter["actor.id"] = f.actorId
      const q = AuditLog.find(filter, { _id: 1, at: 1, actor: 1, action: 1, target: 1, detail: 1 }).sort({ _id: -1 }).limit(limit).maxTimeMS(ADMIN_MAX_MS)
      if (f.targetId) q.hint({ "target.id": 1, _id: -1 })
      return q.lean<Lean[]>()
    },
  }
}
export type AuditRepo = ReturnType<typeof auditRepo>
