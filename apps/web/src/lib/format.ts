import { fromMicros, METRIC_DEFS, type MetricKey } from "@orbit/domain"

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Display formatting. Dates are "YYYY-MM-DD" calendar keys or ISO instants. */
export const fmt = {
  int: (x: number | null | undefined) => Math.round(x || 0).toLocaleString("en-US"),
  compact: (x: number | null | undefined) => {
    x = x || 0
    if (x >= 1e6) return (x / 1e6).toFixed(x >= 1e7 ? 1 : 2) + "M"
    if (x >= 1e4) return Math.round(x / 1e3) + "K"
    if (x >= 1e3) return (x / 1e3).toFixed(1) + "K"
    return String(Math.round(x))
  },
  pct: (x: number | null | undefined, d = 2) => (x == null ? "—" : (x * 100).toFixed(d) + "%"),
  usd: (x: number | null | undefined) => "$" + Math.round(x || 0).toLocaleString("en-US"),
  usd2: (x: number | null | undefined) => "$" + (x || 0).toFixed(2),
  /** micros → "$1,234" */
  money: (micros: number | null | undefined) => "$" + Math.round(fromMicros(micros ?? 0)).toLocaleString("en-US"),
  money2: (micros: number | null | undefined) => "$" + fromMicros(micros ?? 0).toFixed(2),
  /** "2026-10-19" → "Oct 19, 2026" (or "Oct 19" when short) */
  date: (s?: string | null, short = false) => {
    if (!s) return "—"
    const [y, m, d] = s.slice(0, 10).split("-").map(Number)
    return MON[m - 1] + " " + d + (short ? "" : ", " + y)
  },
  range: (a: string, b: string) => (a.slice(0, 4) === b.slice(0, 4) ? fmt.date(a, true) + " – " + fmt.date(b) : fmt.date(a) + " – " + fmt.date(b)),
  /** ISO instant → "Oct 19, 2026 14:05" in the viewer's time zone */
  dateTime: (iso?: string | null) => {
    if (!iso) return "—"
    const d = new Date(iso)
    return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  },
  /** ISO instant → "Just now", "5 min ago", "3 h ago", "Yesterday", "Oct 2" */
  ago: (iso?: string | null, now = Date.now()) => {
    if (!iso) return "Never"
    const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
    if (s < 60) return "Just now"
    if (s < 3600) return `${Math.floor(s / 60)} min ago`
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`
    if (s < 172800) return "Yesterday"
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`
    return fmt.date(new Date(iso).toISOString())
  },
  /** "2026-10-19" → "Oct 19" for chart axes */
  day: (key: string) => fmt.date(key, true),
  initials: (name: string) => name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
}

/** Format a metric value by its kind in METRIC_DEFS. */
export function metricFmt(m: MetricKey, v: number | null | undefined) {
  if (v == null) return "—"
  const k = METRIC_DEFS[m].kind
  if (k === "pct") return fmt.pct(v, m === "fill" || m === "vcr" || m === "viewRate" ? 1 : 2)
  if (k === "usd") return fmt.usd(v)
  if (k === "usd2") return fmt.usd2(v)
  return fmt.compact(v)
}
