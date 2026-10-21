import type { endpoints } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"
import { ctxOf, p } from "../../lib/http"
import type { audiencesService } from "./service"

type E = typeof endpoints

export function audiencesController(svc: ReturnType<typeof audiencesService>) {
  return {
    list: (() => svc.list()) satisfies Handler<E["listAudiences"]>,
    create: (({ req, body }) => svc.create(ctxOf(req), body)) satisfies Handler<E["createAudience"]>,
    remove: (({ req }) => svc.remove(ctxOf(req), p(req, "id"))) satisfies Handler<E["deleteAudience"]>,
  }
}
