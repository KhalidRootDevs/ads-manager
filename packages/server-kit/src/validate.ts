/**
 * Zod request validation (guideline §3.5). Parsed values are stored on `req.input` (Express 5's `req.query`
 * is a read-only getter), so handlers only ever read typed, validated input.
 */
import type { Request, RequestHandler, Router } from "express"
import { buildPath, type Endpoint } from "@orbit/domain"
import { z } from "zod"
import { badRequest, zodIssues } from "./errors"

export interface Input {
  params: Record<string, string>
  query: unknown
  body: unknown
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      input: Input
    }
  }
}

export function validate(schemas: { query?: z.ZodType; body?: z.ZodType; params?: z.ZodType }): RequestHandler {
  return (req, _res, next) => {
    const query = schemas.query ? schemas.query.safeParse(req.query) : { success: true as const, data: req.query }
    if (!query.success) return next(badRequest("Invalid query parameters.", zodIssues(query.error)))
    const body = schemas.body ? schemas.body.safeParse(req.body ?? {}) : { success: true as const, data: undefined }
    if (!body.success) return next(badRequest("The request body is invalid.", zodIssues(body.error)))
    const params = schemas.params ? schemas.params.safeParse(req.params) : { success: true as const, data: req.params }
    if (!params.success) return next(badRequest("Invalid path parameters.", zodIssues(params.error)))
    req.input = { params: params.data as Record<string, string>, query: query.data, body: body.data }
    next()
  }
}

export interface HandlerCtx<E extends Endpoint> {
  req: Request
  params: Record<string, string>
  query: E extends { query: infer Q extends z.ZodType } ? z.output<Q> : undefined
  body: E extends { body: infer B extends z.ZodType } ? z.output<B> : undefined
}

export type Handler<E extends Endpoint> = (ctx: HandlerCtx<E>) => Promise<z.input<E["response"]> | RawResponse> | z.input<E["response"]> | RawResponse

/** Return this from a handler that writes the response itself (streams, redirects). */
export class RawResponse {
  readonly raw = true
}

/**
 * Register one contract endpoint: method + path from the contract, Zod validation of query/body,
 * then `before` middleware (auth, RBAC), then the handler. In non-production the response is
 * checked against the contract so drift fails loudly.
 */
export function route<E extends Endpoint>(router: Router, ep: E, before: RequestHandler[], handler: Handler<E>) {
  const checkResponse = process.env.NODE_ENV !== "production"
  const method = ep.method.toLowerCase() as "get" | "post" | "patch" | "put" | "delete"
  router[method](ep.path, ...before, validate({ query: ep.query, body: ep.body }), async (req, res) => {
    const out = await handler({ req, params: req.input.params, query: req.input.query, body: req.input.body } as HandlerCtx<E>)
    if (out instanceof RawResponse || res.headersSent) return
    if (checkResponse) {
      const r = ep.response.safeParse(out)
      if (!r.success) {
        req.log?.error({ issues: r.error.issues.slice(0, 5), path: ep.path }, "response does not match contract")
        throw new Error(`Response for ${ep.method} ${ep.path} does not match its contract: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`)
      }
    }
    res.status(ep.status ?? 200).json(out)
  })
}

export { buildPath }
