import { endpoints } from "@orbit/domain"
import type { Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import type { Reg } from "../../lib/registry"
import { settingsController } from "./controller"
import { settingsRepo } from "./repo"
import { settingsService } from "./service"

export function settingsRoutes(reg: Reg, deps: Deps, audit: AuditWriter) {
  const c = settingsController(settingsService(deps, settingsRepo(deps.db), audit))
  reg(endpoints.getSettings, c.get)
  reg(endpoints.putSettings, c.put)
  reg(endpoints.listCountries, c.countries)
  reg(endpoints.patchCountry, c.patchCountry)
}
