import { endpoints } from "@orbit/domain"
import type { Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import type { Reg } from "../../lib/registry"
import { alertsController } from "./controller"
import { alertsRepo } from "./repo"
import { alertsService } from "./service"

export function alertsRoutes(reg: Reg, deps: Deps, audit: AuditWriter) {
  const c = alertsController(alertsService(deps, alertsRepo(deps.db), audit))
  reg(endpoints.listAlerts, c.list)
  reg(endpoints.ackAlert, c.ack)
}
