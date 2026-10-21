import { endpoints } from "@orbit/domain"
import type { Deps } from "../../context"
import type { Reg } from "../../lib/registry"
import { analyticsController } from "./controller"
import { analyticsRepo } from "./repo"
import { analyticsService } from "./service"

export function analyticsRoutes(reg: Reg, deps: Deps) {
  const c = analyticsController(analyticsService(deps, analyticsRepo(deps.db)))
  reg(endpoints.analyticsDelivery, c.delivery)
  reg(endpoints.analyticsHeatmap, c.heatmap)
  reg(endpoints.analyticsNoFill, c.noFill)
  reg(endpoints.analyticsExport, c.exportCsv)
}
