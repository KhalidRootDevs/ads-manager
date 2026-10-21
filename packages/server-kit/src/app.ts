/**
 * Express 5 app factory with the standard middleware order (guideline §3.5):
 * requestId → pino-http → helmet → cors → json → [service middleware] → routes → 404 → problem+json.
 */
import { randomUUID } from "node:crypto"
import type { Server } from "node:http"
import cors, { type CorsOptions } from "cors"
import express, { type Express, type RequestHandler } from "express"
import helmet from "helmet"
import type { Logger } from "pino"
import { pinoHttp } from "pino-http"
import { errorHandler, notFoundHandler } from "./errors"
import { metrics, startEventLoopMonitor } from "./metrics"

export interface AppOptions {
  name: string
  log: Logger
  /** CORS: allowed origins, or a function deciding per origin. Omit to disable CORS. */
  cors?: CorsOptions
  jsonLimit?: string
  /** Hot-path services log only warnings and sample info (§4.4). */
  quietHttpLog?: boolean
  /** Skip helmet (pixel/redirect endpoints set their own headers). */
  helmet?: boolean
}

export function createApp(o: AppOptions): Express {
  const app = express()
  app.disable("x-powered-by")
  app.set("trust proxy", 1)
  app.set("etag", false)
  const requestId: RequestHandler = (req, res, next) => {
    const incoming = req.header("x-request-id")
    req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID()
    res.setHeader("x-request-id", String(req.id))
    next()
  }
  app.use(requestId)
  app.use(
    pinoHttp({
      logger: o.log,
      genReqId: (req) => req.id as string,
      autoLogging: o.quietHttpLog ? { ignore: (req) => Math.random() > 0.01 && !String(req.url).startsWith("/admin") } : { ignore: (req) => req.url === "/healthz" || req.url === "/readyz" || req.url === "/metrics" },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : o.quietHttpLog ? "debug" : "info"),
      serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url }), res: (r) => ({ statusCode: r.statusCode }) },
    }),
  )
  if (o.helmet !== false) app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }))
  if (o.cors) app.use(cors(o.cors))
  app.use(express.json({ limit: o.jsonLimit ?? "100kb" }))
  app.use((req, res, next) => {
    const t0 = process.hrtime.bigint()
    res.on("finish", () => {
      const route = (req.route?.path as string | undefined) ?? "unmatched"
      metrics.observe("http_request_duration_seconds", Number(process.hrtime.bigint() - t0) / 1e9, { service: o.name, method: req.method, route, status: String(res.statusCode) })
    })
    next()
  })
  app.get("/metrics", (_req, res) => {
    res.type("text/plain; version=0.0.4").send(metrics.render())
  })
  startEventLoopMonitor(o.name)
  return app
}

/** Add the 404 and error handlers. Call after all routes. */
export function finalizeApp(app: Express, log: Logger) {
  app.use(notFoundHandler)
  app.use(errorHandler(log))
}

export interface ServeOptions {
  port: number
  log: Logger
  /** Close databases, consumers, etc. Runs after the HTTP server stops accepting. */
  onShutdown?: () => Promise<void>
  /** Max time to drain in-flight requests. */
  drainMs?: number
}

/** Listen with load-balancer-friendly keep-alive and graceful SIGTERM/SIGINT shutdown. */
export function serve(app: Express, o: ServeOptions): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(o.port, () => {
      o.log.info({ port: o.port }, "listening")
      resolve(server)
    })
    server.keepAliveTimeout = 65_000 // above the ALB's 60 s idle timeout
    server.headersTimeout = 66_000
    let stopping = false
    const stop = async (signal: string) => {
      if (stopping) return
      stopping = true
      o.log.info({ signal }, "shutting down")
      const force = setTimeout(() => process.exit(1), (o.drainMs ?? 10_000) + 5_000).unref()
      server.close(async () => {
        try {
          await o.onShutdown?.()
        } catch (err) {
          o.log.error({ err }, "shutdown hook failed")
        }
        clearTimeout(force)
        process.exit(0)
      })
      setTimeout(() => server.closeAllConnections(), o.drainMs ?? 10_000).unref()
      server.closeIdleConnections()
    }
    process.once("SIGTERM", () => void stop("SIGTERM"))
    process.once("SIGINT", () => void stop("SIGINT"))
  })
}

declare module "http" {
  interface IncomingMessage {
    id: string | number | object
  }
}
