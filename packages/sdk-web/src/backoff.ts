/** Exponential back-off for beacon retries: 2 s, 4 s, 8 s … capped at 5 min. */
export const BACKOFF_BASE_MS = 2_000
export const BACKOFF_MAX_MS = 300_000
/** Queued events older than this are dropped (§8: max 24 h). */
export const MAX_EVENT_AGE_MS = 24 * 3_600_000

export function backoffMs(failures: number): number {
  if (failures <= 0) return 0
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 20))
}

export function expired(at: number, now: number): boolean {
  return now - at > MAX_EVENT_AGE_MS
}
