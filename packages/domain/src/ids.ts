import { monotonicFactory, ulid as plainUlid } from "ulid"

/** Prefixed, time-sortable ULID ids (guideline §6.2, ADR 9). */
export const ID_PREFIX = {
  user: "usr",
  property: "prp",
  key: "key",
  placement: "plc",
  creative: "crv",
  campaign: "cmp",
  audience: "aud",
  auditLog: "log",
  alert: "alr",
  click: "clk",
  request: "req",
  upload: "upl",
} as const
export type IdKind = keyof typeof ID_PREFIX

const ulid = monotonicFactory()
let lastAt = 0

/**
 * New id for `kind`, time-ordered by `at` (default now). Monotonic within a millisecond. A monotonic factory clamps
 * earlier seed times to its last time, so ids for past instants (backfills, imports) use a plain ULID instead.
 */
export function newId(kind: IdKind, at?: number): string {
  const t = at ?? Date.now()
  if (t < lastAt) return `${ID_PREFIX[kind]}_${plainUlid(t)}`
  lastAt = t
  return `${ID_PREFIX[kind]}_${ulid(t)}`
}

const ULID = "[0-9A-HJKMNP-TV-Z]{26}"
export const ID_PATTERN: Record<IdKind, RegExp> = Object.fromEntries(
  Object.entries(ID_PREFIX).map(([k, p]) => [k, new RegExp(`^${p}_${ULID}$`)]),
) as Record<IdKind, RegExp>

export function isId(kind: IdKind, s: unknown): s is string {
  return typeof s === "string" && ID_PATTERN[kind].test(s)
}

/** Millisecond timestamp encoded in a ULID-based id. */
export function idTime(id: string): number {
  const u = id.slice(id.indexOf("_") + 1, id.indexOf("_") + 11)
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let t = 0
  for (const ch of u) t = t * 32 + alphabet.indexOf(ch)
  return t
}
