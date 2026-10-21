/**
 * Audit writer (§9): every state change → one `audit_log` entry, inside the caller's transaction when there is one.
 * Actions are dotted lowercase verbs (`campaign.published`, `key.rotated`, `role.changed`).
 */
import { newId } from "@orbit/domain"
import type { ClientSession } from "mongoose"
import type { Ctx } from "../context"
import type { AuditRepo } from "../modules/audit/repo"

export interface AuditInput {
  action: string
  target: { type: string; id: string; name: string }
  detail?: string
  diff?: unknown
}

export type AuditWriter = (ctx: Ctx, e: AuditInput, session?: ClientSession | null) => Promise<void>

export function auditWriter(repo: AuditRepo, now: () => Date): AuditWriter {
  return async (ctx, e, session) => {
    await repo.insert(
      {
        _id: newId("auditLog"), at: now(), actor: { id: ctx.actor.id, name: ctx.actor.name }, action: e.action, target: e.target, detail: e.detail ?? "",
        diff: e.diff ?? null, ip: ctx.ip, requestId: ctx.requestId || null,
      },
      session,
    )
  }
}
