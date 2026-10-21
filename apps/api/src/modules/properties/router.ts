import { endpoints } from "@orbit/domain"
import type { Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import type { Reg } from "../../lib/registry"
import { propertiesController } from "./controller"
import { propertiesRepo } from "./repo"
import { propertiesService } from "./service"

export function propertiesRoutes(reg: Reg, deps: Deps, audit: AuditWriter) {
  const c = propertiesController(propertiesService(deps, propertiesRepo(deps.db), audit))
  reg(endpoints.listProperties, c.list)
  reg(endpoints.createProperty, c.create)
  reg(endpoints.getProperty, c.get)
  reg(endpoints.patchProperty, c.patch)
  reg(endpoints.pauseProperty, c.pause)
  reg(endpoints.activateProperty, c.activate)
  reg(endpoints.listKeys, c.keys)
  reg(endpoints.createKey, c.createKey)
  reg(endpoints.rotateKey, c.rotateKey)
  reg(endpoints.revokeKey, c.revokeKey)
  reg(endpoints.testRequest, c.testRequest)
  reg(endpoints.diagnostics, c.diagnostics)
}
