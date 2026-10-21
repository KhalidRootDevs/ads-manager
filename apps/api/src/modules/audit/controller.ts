import type { endpoints } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"
import type { auditService } from "./service"

export function auditController(svc: ReturnType<typeof auditService>) {
  return {
    list: (({ query }) => svc.list(query)) satisfies Handler<(typeof endpoints)["listAudit"]>,
  }
}
