import { addDays, dayStart, type AuditEntry } from "@orbit/domain"
import { auditDto } from "../../lib/dto"
import { decodeCursor, encodeCursor, idAtTime } from "../../lib/cursor"
import type { AuditRepo } from "./repo"

export function auditService(repo: AuditRepo) {
  return {
    async list(q: { cursor?: string; limit: number; targetId?: string; action?: string; actorId?: string; from?: string; to?: string }): Promise<{ items: AuditEntry[]; nextCursor: string | null }> {
      const cur = decodeCursor(q.cursor, 1)
      let idLt = cur?.[0]
      if (q.to) {
        const end = idAtTime("log", dayStart(addDays(q.to, 1)).getTime())
        if (!idLt || end < idLt) idLt = end
      }
      const idGte = q.from ? idAtTime("log", dayStart(q.from).getTime()) : undefined
      const rows = await repo.list({ targetId: q.targetId, action: q.action, actorId: q.actorId, idLt, idGte }, q.limit + 1)
      const more = rows.length > q.limit
      const page = rows.slice(0, q.limit)
      return { items: page.map(auditDto), nextCursor: more ? encodeCursor([page[page.length - 1]._id]) : null }
    },
  }
}
