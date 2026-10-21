import { endpoints } from "@orbit/domain"
import type { Deps } from "../../context"
import type { Reg } from "../../lib/registry"
import { auditController } from "./controller"
import { auditRepo } from "./repo"
import { auditService } from "./service"

export function auditRoutes(reg: Reg, deps: Deps) {
  const c = auditController(auditService(auditRepo(deps.db)))
  reg(endpoints.listAudit, c.list)
}
