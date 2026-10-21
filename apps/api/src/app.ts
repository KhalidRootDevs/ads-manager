/**
 * Express app for the admin API. `buildApp(deps)` is used by `index.ts` and by the integration tests.
 * Middleware order (§3.5): requestId → logs → helmet → CORS (WEB_ORIGIN, credentials) → JSON → cookies →
 * [health, OpenAPI, media] → CSRF origin check → session → rate limits → routes → 404 → problem+json.
 */
import { endpoints, type Endpoint } from "@orbit/domain"
import { createApp, finalizeApp, route, type Handler } from "@orbit/server-kit"
import cookieParser from "cookie-parser"
import express, { type Express, type RequestHandler } from "express"
import { requireAuth, requirePermission, loadSession } from "./auth/middleware"
import { oidcRouter } from "./auth/oidc"
import { sessionsRepo } from "./auth/repo"
import { authRoutes } from "./auth/router"
import { authService } from "./auth/service"
import { sessionService } from "./auth/sessions"
import type { Deps } from "./context"
import { auditWriter } from "./lib/audit"
import { csrfGuard } from "./lib/csrf"
import { idempotency } from "./lib/idempotency"
import { openApiDocument } from "./lib/openapi"
import { limiter } from "./lib/rate-limit"
import type { Reg } from "./lib/registry"
import { alertsRoutes } from "./modules/alerts/router"
import { analyticsRoutes } from "./modules/analytics/router"
import { audiencesRoutes } from "./modules/audiences/router"
import { auditRepo } from "./modules/audit/repo"
import { auditRoutes } from "./modules/audit/router"
import { budgetsRoutes } from "./modules/budgets/router"
import { campaignsRoutes } from "./modules/campaigns/router"
import { creativesRoutes } from "./modules/creatives/router"
import { eventsRoutes } from "./modules/events/router"
import { lookupsRoutes } from "./modules/lookups/router"
import { placementsRoutes } from "./modules/placements/router"
import { propertiesRoutes } from "./modules/properties/router"
import { settingsRoutes } from "./modules/settings/router"
import { usersRepo } from "./modules/team/repo"
import { teamRoutes } from "./modules/team/router"
import { mountLocalStorage, storageDriver, uploadRoutes } from "./modules/uploads/router"

const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms).unref())])

export async function buildApp(deps: Deps): Promise<Express> {
  const { env, log } = deps
  const app = createApp({
    name: "api", log,
    cors: { origin: [new URL(env.WEB_ORIGIN).origin], credentials: true, maxAge: 600, exposedHeaders: ["x-request-id", "Idempotent-Replayed", "RateLimit", "RateLimit-Policy", "Retry-After", "Content-Disposition"] },
  })
  // Nested query objects (`?status[$ne]=x`) reach Zod, which rejects them with a 400.
  app.set("query parser", "extended")
  app.use(cookieParser(env.SESSION_SECRET))

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true })
  })
  app.get("/readyz", async (_req, res) => {
    const checks = await Promise.allSettled([withTimeout(deps.db.primary.db!.admin().ping(), 2_000), withTimeout(deps.redis.ping(), 2_000)])
    const [mongo, redis] = checks.map((c) => (c.status === "fulfilled" ? "ok" : "down"))
    res.status(mongo === "ok" && redis === "ok" ? 200 : 503).json({ ok: mongo === "ok" && redis === "ok", mongo, redis })
  })
  let doc: unknown
  app.get("/v1/openapi.json", (_req, res) => {
    doc ??= openApiDocument(env.API_URL)
    res.json(doc)
  })

  const driver = await storageDriver(env)
  const router = express.Router()
  const idem = idempotency(deps)
  const guards = (ep: Endpoint): RequestHandler[] => {
    if (ep.permission === "public") return []
    return [ep.permission ? requirePermission(ep.permission) : requireAuth, ...(ep.idempotent ? [idem] : [])]
  }
  const registered = new Set<Endpoint>()
  const reg: Reg = <E extends Endpoint>(ep: E, handler: Handler<E>) => {
    route(router, ep, guards(ep), handler)
    registered.add(ep)
  }

  const audit = auditWriter(auditRepo(deps.db), deps.now)
  const users = usersRepo(deps.db)
  const sessions = sessionService(deps, sessionsRepo(deps.db))
  const auth = authService(deps, users, sessions, audit)

  authRoutes(reg, auth, sessions)
  lookupsRoutes(reg, deps)
  teamRoutes(reg, deps, audit)
  settingsRoutes(reg, deps, audit)
  eventsRoutes(reg, deps, audit)
  audiencesRoutes(reg, deps, audit)
  budgetsRoutes(reg, deps, audit)
  propertiesRoutes(reg, deps, audit)
  placementsRoutes(reg, deps, audit)
  creativesRoutes(reg, deps, audit)
  const uploads = uploadRoutes(reg, deps, driver)
  campaignsRoutes(reg, deps, audit)
  analyticsRoutes(reg, deps)
  alertsRoutes(reg, deps, audit)
  auditRoutes(reg, deps)

  const missing = Object.entries(endpoints).filter(([, ep]) => !registered.has(ep as Endpoint)).map(([name]) => name)
  if (missing.length) throw new Error(`Contract endpoints without a route: ${missing.join(", ")}`)

  // Signed upload target + media (local driver): authenticated by URL signature, not by cookie.
  if (driver.kind === "local") mountLocalStorage(app, deps, uploads)

  app.use(csrfGuard(env))
  app.use(loadSession(deps, sessions, users))
  app.use("/v1/auth/dev-login", limiter(deps, "login", env.RATE_LIMIT_LOGIN_PER_MIN, "ip"))
  app.use("/v1/analytics", limiter(deps, "analytics", env.RATE_LIMIT_ANALYTICS_PER_MIN, "user"))
  app.use("/v1", limiter(deps, "admin", env.RATE_LIMIT_ADMIN_PER_MIN, "user"))
  app.use(oidcRouter(deps, auth, sessions))
  app.use(router)
  finalizeApp(app, log)
  return app
}
