import { endpoints } from "@orbit/domain"
import type { Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import type { Reg } from "../../lib/registry"
import { eventsController } from "./controller"
import { eventsRepo } from "./repo"
import { eventsService } from "./service"

export function eventsRoutes(reg: Reg, deps: Deps, audit: AuditWriter) {
  const c = eventsController(eventsService(deps, eventsRepo(deps.db), audit))
  reg(endpoints.listEvents, c.list)
  reg(endpoints.createEvent, c.create)
  reg(endpoints.patchEvent, c.patch)
}
