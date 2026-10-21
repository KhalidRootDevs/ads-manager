import type { endpoints } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"
import { ctxOf, p, sent } from "../../lib/http"
import type { placementsService } from "./service"

type E = typeof endpoints

export function placementsController(svc: ReturnType<typeof placementsService>) {
  return {
    list: (({ query }) => svc.list(query.propertyId)) satisfies Handler<E["listPlacements"]>,
    create: (({ req, body }) => svc.create(ctxOf(req), body)) satisfies Handler<E["createPlacement"]>,
    get: (({ req }) => svc.get(p(req, "id"))) satisfies Handler<E["getPlacement"]>,
    patch: (({ req, body }) => svc.patch(ctxOf(req), p(req, "id"), sent(req, body))) satisfies Handler<E["patchPlacement"]>,
  }
}
