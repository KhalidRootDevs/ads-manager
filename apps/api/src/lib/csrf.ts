/**
 * CSRF defence (§9): SameSite=Lax cookies plus an Origin check on state-changing requests.
 * The Origin (or the Referer's origin) must equal WEB_ORIGIN. A request with neither header is a
 * non-browser client; that is only accepted in the test environment.
 */
import { forbidden } from "@orbit/server-kit"
import type { RequestHandler } from "express"
import type { Env } from "../env"

const SAFE = new Set(["GET", "HEAD", "OPTIONS"])

function refererOrigin(ref: string | undefined): string | null {
  if (!ref) return null
  try {
    return new URL(ref).origin
  } catch {
    return null
  }
}

export function csrfGuard(env: Pick<Env, "WEB_ORIGIN" | "NODE_ENV">): RequestHandler {
  const allowed = new URL(env.WEB_ORIGIN).origin
  return (req, _res, next) => {
    if (SAFE.has(req.method)) return next()
    const origin = req.header("origin") ?? refererOrigin(req.header("referer"))
    if (!origin) {
      if (env.NODE_ENV === "test" && !req.header("sec-fetch-site")) return next()
      return next(forbidden("Cross-site request blocked: the request has no Origin header."))
    }
    if (origin !== allowed) return next(forbidden("Cross-site request blocked: this origin may not change data."))
    next()
  }
}
