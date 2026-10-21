import { EVENT_SOURCE_LABEL, type EventDefinition, type EventSource } from "@orbit/domain"
import { notFound } from "@orbit/server-kit"
import type { ClientSession } from "mongoose"
import type { Ctx, Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import { eventDto } from "../../lib/dto"
import { uniqueOr409 } from "../../lib/mongo"
import type { EventsRepo } from "./repo"

export function eventsService(deps: Pick<Deps, "db">, repo: EventsRepo, audit: AuditWriter) {
  const tx = <T>(fn: (s: ClientSession) => Promise<T>) => deps.db.primary.transaction(fn)
  return {
    list: async (): Promise<{ items: EventDefinition[] }> => ({ items: (await repo.list()).map(eventDto) }),
    create: (ctx: Ctx, input: { key: string; name: string; source: EventSource }): Promise<EventDefinition> =>
      uniqueOr409(
        () =>
          tx(async (s) => {
            const e = await repo.insert({ _id: input.key, name: input.name, source: input.source, active: true, lastSeenAt: null }, s)
            await audit(ctx, { action: "event.created", target: { type: "event", id: input.key, name: input.name }, detail: `Source: ${EVENT_SOURCE_LABEL[input.source]}` }, s)
            return eventDto(e!)
          }),
        "An event with this key already exists.",
      ),
    async patch(ctx: Ctx, key: string, input: { active?: boolean; name?: string }): Promise<EventDefinition> {
      const e = await repo.byKey(key)
      if (!e) throw notFound("Event")
      const set: Record<string, unknown> = {}
      if (input.active !== undefined && input.active !== e.active) set.active = input.active
      if (input.name !== undefined && input.name !== e.name) set.name = input.name
      if (!Object.keys(set).length) return eventDto(e)
      return tx(async (s) => {
        const updated = await repo.update(key, set, s)
        const action = set.active === undefined ? "event.renamed" : set.active ? "event.activated" : "event.deactivated"
        await audit(ctx, { action, target: { type: "event", id: key, name: updated!.name }, detail: set.name ? `${e.name} → ${String(set.name)}` : "" }, s)
        return eventDto(updated!)
      })
    },
  }
}
