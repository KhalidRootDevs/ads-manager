import type { endpoints } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"
import type { lookupsService } from "./service"

export function lookupsController(svc: ReturnType<typeof lookupsService>) {
  return { get: (() => svc.get()) satisfies Handler<(typeof endpoints)["lookups"]> }
}
