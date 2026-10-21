import { endpoints } from "@orbit/domain"
import type { Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import type { Reg } from "../../lib/registry"
import { creativesController } from "./controller"
import { creativesRepo } from "./repo"
import { creativesService } from "./service"

export function creativesRoutes(reg: Reg, deps: Deps, audit: AuditWriter) {
  const c = creativesController(creativesService(deps, creativesRepo(deps.db, deps.log), audit))
  reg(endpoints.listCreatives, c.list)
  reg(endpoints.createCreative, c.create)
  reg(endpoints.getCreative, c.get)
  reg(endpoints.patchCreative, c.patch)
  reg(endpoints.submitCreative, c.submit)
  reg(endpoints.approveCreative, c.approve)
  reg(endpoints.rejectCreative, c.reject)
  reg(endpoints.archiveCreative, c.archive)
  reg(endpoints.restoreCreative, c.restore)
  reg(endpoints.duplicateCreative, c.duplicate)
  reg(endpoints.creativeVersions, c.versions)
}
