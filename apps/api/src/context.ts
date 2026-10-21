/** Process-wide dependencies and the per-request context handed to services. */
import type { Db } from "@orbit/db"
import type { Role } from "@orbit/domain"
import type { Logger, Redis } from "@orbit/server-kit"
import type { Env } from "./env"

export interface Deps {
  env: Env
  db: Db
  redis: Redis
  log: Logger
  /** Injected for tests (ad-server test request). */
  fetch: typeof fetch
  now: () => Date
}

export interface Actor {
  id: string
  name: string
  email: string
  role: Role
}

/** What a service needs to know about the caller: who, from where, which request (for audit). */
export interface Ctx {
  actor: Actor
  ip: string | null
  requestId: string
}

export interface SessionInfo {
  id: string
  userId: string
  expiresAt: Date
  absoluteExpiresAt: Date
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor
      session?: SessionInfo
    }
  }
}
