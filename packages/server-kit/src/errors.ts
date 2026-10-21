/** HTTP errors rendered as RFC 9457 problem+json (guideline §7.1). */
import type { ErrorRequestHandler, RequestHandler } from "express"
import { ZodError } from "zod"
import type { Logger } from "pino"

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: { errors?: { path: string; message: string }[]; current?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message)
  }
}

export const badRequest = (message: string, errors?: { path: string; message: string }[]) => new HttpError(400, "bad_request", message, { errors })
export const unauthorized = (message = "Sign in to continue.") => new HttpError(401, "unauthorized", message)
export const forbidden = (message = "Your role doesn’t allow this action.") => new HttpError(403, "forbidden", message)
export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found.`)
/** Optimistic concurrency or uniqueness conflict. `current` is the latest document when known. */
export const conflict = (message: string, current?: unknown, code = "conflict") => new HttpError(409, code, message, { current })
export const unprocessable = (message: string, errors?: { path: string; message: string }[]) => new HttpError(422, "unprocessable", message, { errors })
export const tooMany = (message = "Too many requests.") => new HttpError(429, "rate_limited", message)
export const unavailable = (message = "Service temporarily unavailable.") => new HttpError(503, "unavailable", message)

const TITLES: Record<number, string> = { 400: "Bad request", 401: "Unauthorized", 403: "Forbidden", 404: "Not found", 409: "Conflict", 413: "Payload too large", 422: "Unprocessable", 429: "Too many requests", 500: "Internal error", 503: "Unavailable" }

export function zodIssues(e: ZodError) {
  return e.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
}

export const notFoundHandler: RequestHandler = (req, _res, next) => next(new HttpError(404, "not_found", `No route for ${req.method} ${req.path}`))

export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let e: HttpError
    if (err instanceof HttpError) e = err
    else if (err instanceof ZodError) e = badRequest("The request is invalid.", zodIssues(err))
    else if (err?.code === 11000) e = conflict("Something with the same unique value already exists.", undefined, "duplicate")
    else if (err?.name === "CastError" || err?.name === "ValidationError") e = badRequest(err.message)
    else if (err?.type === "entity.parse.failed") e = badRequest("Malformed JSON body.")
    else if (err?.type === "entity.too.large") e = new HttpError(413, "too_large", "The request body is too large.")
    else {
      log.error({ err, requestId: req.id }, "unhandled error")
      e = new HttpError(500, "internal", "Something went wrong. Try again, and contact the platform team if it keeps happening.")
    }
    if (e.status >= 500 && !(err instanceof HttpError)) {
      /* already logged */
    } else if (e.status >= 500) log.error({ err, requestId: req.id }, e.message)
    if (res.headersSent) return
    for (const [k, v] of Object.entries(e.extra.headers ?? {})) res.setHeader(k, v)
    res.status(e.status).type("application/problem+json").json({
      type: `https://orbit.internal/problems/${e.code}`,
      title: TITLES[e.status] ?? "Error",
      status: e.status,
      code: e.code,
      detail: e.message,
      ...(e.extra.errors ? { errors: e.extra.errors } : {}),
      ...(e.extra.current !== undefined ? { current: e.extra.current } : {}),
      requestId: String(req.id ?? ""),
    })
  }
}
