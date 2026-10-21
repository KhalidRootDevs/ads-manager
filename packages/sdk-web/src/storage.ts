import type { KV } from "./types"

/** localStorage when usable (it can throw in private mode / sandboxed frames), else an in-memory map. */
export function safeStorage(): KV {
  try {
    const ls = window.localStorage
    const k = "orbit.t"
    ls.setItem(k, "1")
    ls.removeItem(k)
    return ls
  } catch {
    const m = new Map<string, string>()
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
  }
}

export function readJson<T>(s: KV, key: string, fallback: T): T {
  try {
    const v = s.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeJson(s: KV, key: string, v: unknown) {
  try {
    s.setItem(key, JSON.stringify(v))
  } catch {
    /* quota or disabled storage: the queue keeps working in memory */
  }
}
