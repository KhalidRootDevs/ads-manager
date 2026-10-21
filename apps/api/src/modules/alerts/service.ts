import type { Alert } from "@orbit/domain"
import { conflict, notFound } from "@orbit/server-kit"
import type { ClientSession } from "mongoose"
import type { Ctx, Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import { alertDto } from "../../lib/dto"
import type { alertsRepo } from "./repo"

export function alertsService(deps: Pick<Deps, "db">, repo: ReturnType<typeof alertsRepo>, audit: AuditWriter) {
  const tx = <T>(fn: (s: ClientSession) => Promise<T>) => deps.db.primary.transaction(fn)
  return {
    list: async (): Promise<{ items: Alert[] }> => ({ items: (await repo.listOpen()).map(alertDto) }),
    async ack(ctx: Ctx, id: string): Promise<Alert> {
      const a = await repo.byId(id)
      if (!a) throw notFound("Alert")
      if (a.status === "acked") return alertDto(a)
      if (a.status !== "open") throw conflict("This alert is already resolved.", alertDto(a))
      return tx(async (s) => {
        const updated = await repo.ack(id, ctx.actor.id, s)
        if (!updated) throw conflict("This alert changed meanwhile. Reload and try again.")
        await audit(ctx, { action: "alert.acked", target: { type: "alert", id, name: a.title }, detail: a.message.slice(0, 160) }, s)
        return alertDto(updated)
      })
    },
  }
}
