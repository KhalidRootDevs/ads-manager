import type { endpoints } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"
import { ctxOf, p } from "../../lib/http"
import type { alertsService } from "./service"

type E = typeof endpoints

export function alertsController(svc: ReturnType<typeof alertsService>) {
  return {
    list: (() => svc.list()) satisfies Handler<E["listAlerts"]>,
    ack: (({ req }) => svc.ack(ctxOf(req), p(req, "id"))) satisfies Handler<E["ackAlert"]>,
  }
}
