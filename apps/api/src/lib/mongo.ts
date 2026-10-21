import { conflict } from "@orbit/server-kit"

/** Mongo duplicate-key error (unique index violation). */
export function isDuplicate(e: unknown): boolean {
  const err = e as { code?: number; cause?: { code?: number }; errorResponse?: { code?: number } } | null
  return err?.code === 11000 || err?.cause?.code === 11000 || err?.errorResponse?.code === 11000
}

/** Run `fn`; map a unique violation to a 409 with a helpful message. */
export async function uniqueOr409<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (isDuplicate(e)) throw conflict(message, undefined, "duplicate")
    throw e
  }
}

/** Admin queries are bounded (§6.13): 2 s for CRUD, 5 s for analytics. */
export const ADMIN_MAX_MS = 2_000
export const ANALYTICS_MAX_MS = 5_000
