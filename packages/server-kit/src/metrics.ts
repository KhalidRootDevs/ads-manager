/**
 * Minimal Prometheus registry (counters, gauges, histograms) plus the event-loop-lag gauge used as an
 * autoscaling signal for the ad server (§4.4). Exported at GET /metrics; the OTel collector scrapes it.
 */
import { monitorEventLoopDelay } from "node:perf_hooks"

type Labels = Record<string, string>
const BUCKETS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]

const key = (name: string, labels: Labels) => name + JSON.stringify(Object.entries(labels).sort())
const fmtLabels = (labels: Labels, extra: Labels = {}) => {
  const all = { ...labels, ...extra }
  const parts = Object.entries(all).map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, "_")}"`)
  return parts.length ? `{${parts.join(",")}}` : ""
}

class Registry {
  private counters = new Map<string, { name: string; labels: Labels; value: number }>()
  private gauges = new Map<string, { name: string; labels: Labels; value: number }>()
  private hist = new Map<string, { name: string; labels: Labels; buckets: number[]; sum: number; count: number }>()

  inc(name: string, labels: Labels = {}, by = 1) {
    const k = key(name, labels)
    const c = this.counters.get(k) ?? { name, labels, value: 0 }
    c.value += by
    this.counters.set(k, c)
  }

  set(name: string, value: number, labels: Labels = {}) {
    this.gauges.set(key(name, labels), { name, labels, value })
  }

  observe(name: string, seconds: number, labels: Labels = {}) {
    const k = key(name, labels)
    const h = this.hist.get(k) ?? { name, labels, buckets: BUCKETS.map(() => 0), sum: 0, count: 0 }
    BUCKETS.forEach((b, i) => {
      if (seconds <= b) h.buckets[i]++
    })
    h.sum += seconds
    h.count++
    this.hist.set(k, h)
  }

  render(): string {
    const lines: string[] = []
    for (const c of this.counters.values()) lines.push(`${c.name}_total${fmtLabels(c.labels)} ${c.value}`)
    for (const g of this.gauges.values()) lines.push(`${g.name}${fmtLabels(g.labels)} ${g.value}`)
    for (const h of this.hist.values()) {
      BUCKETS.forEach((b, i) => lines.push(`${h.name}_bucket${fmtLabels(h.labels, { le: String(b) })} ${h.buckets[i]}`))
      lines.push(`${h.name}_bucket${fmtLabels(h.labels, { le: "+Inf" })} ${h.count}`)
      lines.push(`${h.name}_sum${fmtLabels(h.labels)} ${h.sum}`)
      lines.push(`${h.name}_count${fmtLabels(h.labels)} ${h.count}`)
    }
    return lines.join("\n") + "\n"
  }
}

export const metrics = new Registry()

let started = false
/** Publishes event-loop delay p50/p99 (ms) and heap usage every 5 s. */
export function startEventLoopMonitor(service: string) {
  if (started) return
  started = true
  const h = monitorEventLoopDelay({ resolution: 10 })
  h.enable()
  setInterval(() => {
    metrics.set("nodejs_eventloop_lag_p50_ms", h.percentile(50) / 1e6, { service })
    metrics.set("nodejs_eventloop_lag_p99_ms", h.percentile(99) / 1e6, { service })
    metrics.set("nodejs_heap_used_bytes", process.memoryUsage().heapUsed, { service })
    h.reset()
  }, 5_000).unref()
}
