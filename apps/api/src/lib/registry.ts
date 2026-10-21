import type { Endpoint } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"

/** Registers one contract endpoint with its guards (session, permission, idempotency) and handler. */
export type Reg = <E extends Endpoint>(ep: E, handler: Handler<E>) => void
