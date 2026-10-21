import { endpoints } from "@orbit/domain"
import type { Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import type { Reg } from "../../lib/registry"
import { placementsController } from "./controller"
import { placementsRepo } from "./repo"
import { placementsService } from "./service"

export function placementsRoutes(reg: Reg, deps: Deps, audit: AuditWriter) {
  const c = placementsController(placementsService(deps, placementsRepo(deps.db), audit))
  reg(endpoints.listPlacements, c.list)
  reg(endpoints.createPlacement, c.create)
  reg(endpoints.getPlacement, c.get)
  reg(endpoints.patchPlacement, c.patch)
}
