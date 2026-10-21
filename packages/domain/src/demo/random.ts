import { ulid } from "ulid"
import { ID_PREFIX, type IdKind } from "../ids"

/** mulberry32: the prototype's small deterministic PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hex(r: () => number, n: number) {
  let s = ""
  for (let i = 0; i < n; i++) s += "0123456789abcdef"[Math.floor(r() * 16)]
  return s
}

/**
 * Deterministic prefixed ULIDs: the time part is the entity's creation instant, the random part comes from a seeded PRNG,
 * so the same `seed` and `today` always produce the same ids (no crypto, browser-safe).
 */
export function idFactory(r: () => number) {
  return (kind: IdKind, at: number) => `${ID_PREFIX[kind]}_${ulid(Math.max(0, Math.floor(at)), r)}`
}
