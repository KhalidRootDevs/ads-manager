/**
 * MRC viewability (§8): ≥ 50 % of pixels in view for ≥ 1 s (display) or 2 s (video), fired once.
 * `createViewTimer` is the pure state machine (injectable timers, unit-tested); `observeViewable` wires it to
 * IntersectionObserver and pauses while the page is hidden.
 */
export const VIEW_THRESHOLD = 0.5
export const DISPLAY_VIEW_MS = 1_000
export const VIDEO_VIEW_MS = 2_000

export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }

export interface ViewTimer {
  /** latest visible ratio (0..1) and whether the page itself is visible */
  update(ratio: number, pageVisible?: boolean): void
  readonly fired: boolean
  stop(): void
}

export function createViewTimer(durationMs: number, onViewable: () => void, timers: Timers = realTimers): ViewTimer {
  let handle: unknown = null
  let fired = false
  let stopped = false
  const cancel = () => {
    if (handle != null) timers.clear(handle)
    handle = null
  }
  return {
    update(ratio, pageVisible = true) {
      if (fired || stopped) return
      if (ratio >= VIEW_THRESHOLD && pageVisible) {
        if (handle == null)
          handle = timers.set(() => {
            handle = null
            if (fired || stopped) return
            fired = true
            onViewable()
          }, durationMs)
      } else cancel()
    },
    get fired() {
      return fired
    },
    stop() {
      stopped = true
      cancel()
    },
  }
}

/** Observe an element; returns a disposer. Without IntersectionObserver, viewability is not reported. */
export function observeViewable(el: Element, durationMs: number, onViewable: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {}
  let ratio = 0
  const t = createViewTimer(durationMs, () => {
    onViewable()
    dispose()
  })
  const visible = () => document.visibilityState !== "hidden"
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) ratio = e.isIntersecting ? e.intersectionRatio : 0
      t.update(ratio, visible())
    },
    { threshold: [0, VIEW_THRESHOLD, 1] },
  )
  const onVis = () => t.update(ratio, visible())
  io.observe(el)
  document.addEventListener("visibilitychange", onVis)
  function dispose() {
    t.stop()
    io.disconnect()
    document.removeEventListener("visibilitychange", onVis)
  }
  return dispose
}
