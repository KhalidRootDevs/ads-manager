import type { endpoints } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"
import { ctxOf, p } from "../../lib/http"
import type { eventsService } from "./service"

type E = typeof endpoints

export function eventsController(svc: ReturnType<typeof eventsService>) {
  return {
    list: (() => svc.list()) satisfies Handler<E["listEvents"]>,
    create: (({ req, body }) => svc.create(ctxOf(req), body)) satisfies Handler<E["createEvent"]>,
    patch: (({ req, body }) => svc.patch(ctxOf(req), p(req, "key"), body)) satisfies Handler<E["patchEvent"]>,
  }
}
