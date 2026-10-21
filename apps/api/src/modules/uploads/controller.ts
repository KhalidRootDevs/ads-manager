import type { endpoints } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"
import type { RequestHandler } from "express"
import { ctxOf, p } from "../../lib/http"
import type { UploadsService } from "./service"

type E = typeof endpoints

export function uploadsController(svc: UploadsService) {
  return {
    create: (({ req, body }) => svc.createTicket(ctxOf(req), body)) satisfies Handler<E["createUpload"]>,
    /** PUT /v1/uploads/:id?exp&sig (local driver; outside the contract: raw body, signed URL instead of a session). */
    receive: (async (req, res) => {
      const out = await svc.receiveLocal(p(req, "id"), req.query as { exp?: string; sig?: string }, req.header("content-type"), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0))
      res.json(out)
    }) satisfies RequestHandler,
  }
}
