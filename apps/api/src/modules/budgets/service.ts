import { quarterOf, todayKey, type TeamBudget } from "@orbit/domain"
import { badRequest, conflict } from "@orbit/server-kit"
import type { ClientSession } from "mongoose"
import type { Ctx, Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import { budgetDto } from "../../lib/dto"
import { usd } from "../../lib/format"
import { isDuplicate } from "../../lib/mongo"
import type { BudgetsRepo } from "./repo"

const QUARTER = /^\d{4}-Q[1-4]$/

export function budgetsService(deps: Pick<Deps, "db" | "now">, repo: BudgetsRepo, audit: AuditWriter) {
  const tx = <T>(fn: (s: ClientSession) => Promise<T>) => deps.db.primary.transaction(fn)
  const currentQuarter = () => quarterOf(todayKey(undefined, deps.now()))
  return {
    currentQuarter,
    list: async (quarter?: string): Promise<{ items: TeamBudget[] }> => ({ items: (await repo.forQuarter(quarter ?? currentQuarter())).map(budgetDto) }),
    /** Upsert: `rev: null` creates (409 if it exists), a number updates with the rev check. */
    async put(ctx: Ctx, team: string, quarter: string, input: { amountMicros: number; rev: number | null }): Promise<TeamBudget> {
      if (!QUARTER.test(quarter)) throw badRequest("Quarter must look like 2026-Q4.")
      if (!team.trim() || team.length > 60) throw badRequest("Team name is invalid.")
      const id = `${team}:${quarter}`
      const before = await repo.byId(id)
      return tx(async (s) => {
        let doc
        if (input.rev == null) {
          if (before) throw conflict("A budget for this team and quarter already exists.", budgetDto(before))
          try {
            doc = await repo.insert({ _id: id, team, quarter, amountMicros: BigInt(input.amountMicros), updatedBy: ctx.actor.id, rev: 0 }, s)
          } catch (e) {
            if (isDuplicate(e)) throw conflict("A budget for this team and quarter already exists.")
            throw e
          }
        } else {
          doc = await repo.update(id, input.rev, { amountMicros: BigInt(input.amountMicros), updatedBy: ctx.actor.id }, s)
          if (!doc) {
            const cur = await repo.byId(id, s)
            throw conflict(cur ? "This budget was changed by someone else. Review the latest amount." : "This budget doesn’t exist yet; send rev: null to create it.", cur ? budgetDto(cur) : undefined)
          }
        }
        const prev = before ? Number(before.amountMicros) : 0
        await audit(ctx, { action: "budget.changed", target: { type: "budget", id, name: `${team} team ${quarter}` }, detail: `${usd(prev)} → ${usd(input.amountMicros)}` }, s)
        return budgetDto(doc!)
      })
    },
  }
}
