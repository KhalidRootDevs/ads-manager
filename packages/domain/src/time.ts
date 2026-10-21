import { WEEKDAYS, type Weekday } from "./enums"

/** One reporting time zone for daily buckets (ADR 7). Asia/Dhaka is UTC+6 with no DST. */
export const REPORTING_TZ = "Asia/Dhaka"

const DAY_MS = 86_400_000
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

const dtfCache = new Map<string, Intl.DateTimeFormat>()
function dtf(tz: string) {
  let f = dtfCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" })
    dtfCache.set(tz, f)
  }
  return f
}

interface Parts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: Weekday
}

export function partsInTz(instant: Date | number, tz: string): Parts {
  const out: Record<string, string> = {}
  for (const p of dtf(tz).formatToParts(new Date(instant))) out[p.type] = p.value
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day), hour: Number(out.hour), minute: Number(out.minute), second: Number(out.second),
    weekday: out.weekday.slice(0, 3).toLowerCase() as Weekday,
  }
}

/** Offset of `tz` from UTC at `instant`, in minutes (Asia/Dhaka → 360). */
export function tzOffsetMinutes(tz: string, instant: Date | number): number {
  const p = partsInTz(instant, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(new Date(instant).getTime() / 1000) * 1000) / 60000)
}

export function isDateKey(s: unknown): s is string {
  return typeof s === "string" && DATE_KEY.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"))
}

/** Calendar date ("YYYY-MM-DD") of an instant in a time zone. */
export function dateKeyInTz(instant: Date | number, tz: string = REPORTING_TZ): string {
  const p = partsInTz(instant, tz)
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

/** UTC instant of local midnight for a calendar date in `tz`. */
export function dayStart(dateKey: string, tz: string = REPORTING_TZ): Date {
  const guess = Date.parse(dateKey + "T00:00:00Z")
  // Two passes handle DST transitions; Asia/Dhaka needs one.
  let t = guess - tzOffsetMinutes(tz, guess) * 60000
  t = guess - tzOffsetMinutes(tz, t) * 60000
  return new Date(t)
}

export function addDays(dateKey: string, n: number): string {
  return new Date(Date.parse(dateKey + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10)
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY_MS)
}

export function hourInTz(instant: Date | number, tz: string = REPORTING_TZ): number {
  return partsInTz(instant, tz).hour
}

export function weekdayInTz(instant: Date | number, tz: string = REPORTING_TZ): Weekday {
  return partsInTz(instant, tz).weekday
}

/** Weekday of a calendar date, independent of time zone. */
export function weekdayOfKey(dateKey: string): Weekday {
  const d = new Date(dateKey + "T00:00:00Z").getUTCDay() // 0 = Sunday
  return WEEKDAYS[(d + 6) % 7]
}

/** Reporting day (local midnight in REPORTING_TZ) containing `instant`: the `d` field of rollups. */
export function reportingDay(instant: Date | number = Date.now()): Date {
  return dayStart(dateKeyInTz(instant, REPORTING_TZ), REPORTING_TZ)
}

export function todayKey(tz: string = REPORTING_TZ, now: Date | number = Date.now()): string {
  return dateKeyInTz(now, tz)
}

/** "2026-10-19" → "20261019" (rollup `_id` prefix). */
export function compactKey(dateKey: string): string {
  return dateKey.replaceAll("-", "")
}

/** Calendar quarter label, e.g. "2026-Q4". */
export function quarterOf(dateKey: string): string {
  const [y, m] = dateKey.split("-").map(Number)
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
}

/** Inclusive date-key range of a quarter label. */
export function quarterRange(quarter: string): { from: string; to: string } {
  const [y, q] = quarter.split("-Q").map(Number)
  const m0 = (q - 1) * 3 + 1
  const from = `${y}-${String(m0).padStart(2, "0")}-01`
  const next = q === 4 ? `${y + 1}-01-01` : `${y}-${String(m0 + 3).padStart(2, "0")}-01`
  return { from, to: addDays(next, -1) }
}

/** Inclusive list of date keys. */
export function dateKeys(from: string, to: string): string[] {
  const n = daysBetween(from, to)
  return Array.from({ length: Math.max(0, n + 1) }, (_, i) => addDays(from, i))
}
