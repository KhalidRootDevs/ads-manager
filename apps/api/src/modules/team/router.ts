import { endpoints } from "@orbit/domain"
import { sessionsRepo } from "../../auth/repo"
import type { Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import type { Reg } from "../../lib/registry"
import { teamController } from "./controller"
import { usersRepo } from "./repo"
import { teamService } from "./service"

export function teamRoutes(reg: Reg, deps: Deps, audit: AuditWriter) {
  const c = teamController(teamService(deps, usersRepo(deps.db), sessionsRepo(deps.db), audit))
  reg(endpoints.listTeam, c.list)
  reg(endpoints.inviteMember, c.invite)
  reg(endpoints.changeRole, c.changeRole)
  reg(endpoints.removeMember, c.remove)
}
