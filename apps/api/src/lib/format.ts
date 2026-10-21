/** Human sentence fragments for audit details and revision diffs. */
import { fromMicros } from "@orbit/domain"

export const usd = (micros: number) => `$${fromMicros(micros).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
export const capText = (f: { count: number; per: string } | null | undefined) => (f ? `${f.count}/${f.per}` : "no cap")
export const arrow = (a: unknown, b: unknown) => `${String(a)} → ${String(b)}`
