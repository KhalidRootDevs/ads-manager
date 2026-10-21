import { endpoints } from "@orbit/domain"
import type { Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import type { Reg } from "../../lib/registry"
import { budgetsController } from "./controller"
import { budgetsRepo } from "./repo"
import { budgetsService } from "./service"

export function budgetsRoutes(reg: Reg, deps: Deps, audit: AuditWriter) {
  const c = budgetsController(budgetsService(deps, budgetsRepo(deps.db), audit))
  reg(endpoints.listBudgets, c.list)
  reg(endpoints.putBudget, c.put)
}
