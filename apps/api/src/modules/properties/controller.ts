import type { endpoints } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"
import { ctxOf, p } from "../../lib/http"
import type { PropertiesService } from "./service"

type E = typeof endpoints

export function propertiesController(svc: PropertiesService) {
  return {
    list: (() => svc.list()) satisfies Handler<E["listProperties"]>,
    create: (({ req, body }) => svc.create(ctxOf(req), body)) satisfies Handler<E["createProperty"]>,
    get: (({ req }) => svc.get(p(req, "id"))) satisfies Handler<E["getProperty"]>,
    patch: (({ req, body }) => svc.patch(ctxOf(req), p(req, "id"), body)) satisfies Handler<E["patchProperty"]>,
    pause: (({ req, body }) => svc.pause(ctxOf(req), p(req, "id"), body.rev)) satisfies Handler<E["pauseProperty"]>,
    activate: (({ req, body }) => svc.activate(ctxOf(req), p(req, "id"), body.rev)) satisfies Handler<E["activateProperty"]>,
    keys: (({ req }) => svc.keys(p(req, "id"))) satisfies Handler<E["listKeys"]>,
    createKey: (({ req, body }) => svc.createKey(ctxOf(req), p(req, "id"), body)) satisfies Handler<E["createKey"]>,
    rotateKey: (({ req }) => svc.rotateKey(ctxOf(req), p(req, "id"), p(req, "keyId"))) satisfies Handler<E["rotateKey"]>,
    revokeKey: (({ req }) => svc.revokeKey(ctxOf(req), p(req, "id"), p(req, "keyId"))) satisfies Handler<E["revokeKey"]>,
    testRequest: (({ req }) => svc.testRequest(ctxOf(req), p(req, "id"))) satisfies Handler<E["testRequest"]>,
    diagnostics: (({ req }) => svc.diagnostics(p(req, "id"))) satisfies Handler<E["diagnostics"]>,
  }
}
