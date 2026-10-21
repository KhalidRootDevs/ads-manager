import { endpoints } from "@orbit/domain"
import type { Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import type { Reg } from "../../lib/registry"
import { audiencesController } from "./controller"
import { audiencesRepo } from "./repo"
import { audiencesService } from "./service"

export function audiencesRoutes(reg: Reg, deps: Deps, audit: AuditWriter) {
  const c = audiencesController(audiencesService(deps, audiencesRepo(deps.db), audit))
  reg(endpoints.listAudiences, c.list)
  reg(endpoints.createAudience, c.create)
  reg(endpoints.deleteAudience, c.remove)
}
