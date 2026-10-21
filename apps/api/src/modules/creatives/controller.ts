import type { endpoints } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"
import { ctxOf, p, sent } from "../../lib/http"
import type { CreativesService } from "./service"

type E = typeof endpoints

export function creativesController(svc: CreativesService) {
  return {
    list: (({ query }) => svc.list(query)) satisfies Handler<E["listCreatives"]>,
    create: (({ req, body }) => svc.create(ctxOf(req), body)) satisfies Handler<E["createCreative"]>,
    get: (({ req }) => svc.get(p(req, "id"))) satisfies Handler<E["getCreative"]>,
    patch: (({ req, body }) => svc.patch(ctxOf(req), p(req, "id"), sent(req, body))) satisfies Handler<E["patchCreative"]>,
    submit: (({ req, body }) => svc.submit(ctxOf(req), p(req, "id"), body.rev)) satisfies Handler<E["submitCreative"]>,
    approve: (({ req, body }) => svc.approve(ctxOf(req), p(req, "id"), body.rev)) satisfies Handler<E["approveCreative"]>,
    reject: (({ req, body }) => svc.reject(ctxOf(req), p(req, "id"), body)) satisfies Handler<E["rejectCreative"]>,
    archive: (({ req, body }) => svc.archive(ctxOf(req), p(req, "id"), body.rev)) satisfies Handler<E["archiveCreative"]>,
    restore: (({ req, body }) => svc.restore(ctxOf(req), p(req, "id"), body.rev)) satisfies Handler<E["restoreCreative"]>,
    duplicate: (({ req }) => svc.duplicate(ctxOf(req), p(req, "id"))) satisfies Handler<E["duplicateCreative"]>,
    versions: (({ req }) => svc.versions(p(req, "id"))) satisfies Handler<E["creativeVersions"]>,
  }
}
