import { createHash } from "node:crypto"

/** JSON with sorted object keys: equal values give equal strings (cache and idempotency hashing). */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")
