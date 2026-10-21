/** Money is stored and moved as integer micros (1 USD = 1,000,000). Guideline §6.2, ADR 8. */
export const MICROS = 1_000_000

export function toMicros(usd: number): number {
  return Math.round(usd * MICROS)
}

export function fromMicros(micros: number | bigint | null | undefined): number {
  if (micros == null) return 0
  return Number(micros) / MICROS
}

/** Internal cost of `impressions` at a CPM given in USD, in micros. */
export function costMicros(impressions: number, ecpmUsd: number): number {
  return Math.round(impressions * ecpmUsd * 1000)
}
