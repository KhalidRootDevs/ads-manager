import { endpoints } from "@orbit/domain"
import type { Deps } from "../../context"
import type { Reg } from "../../lib/registry"
import { lookupsController } from "./controller"
import { lookupsRepo } from "./repo"
import { lookupsService } from "./service"

export function lookupsRoutes(reg: Reg, deps: Deps) {
  reg(endpoints.lookups, lookupsController(lookupsService(lookupsRepo(deps.db))).get)
}
