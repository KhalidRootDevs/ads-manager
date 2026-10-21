import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createViewTimer, DISPLAY_VIEW_MS, VIDEO_VIEW_MS } from "../src/viewability"

const timers = { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) }

describe("viewability timer", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("fires once after ≥ 50 % for 1 s", () => {
    const cb = vi.fn()
    const t = createViewTimer(DISPLAY_VIEW_MS, cb, timers)
    t.update(0.6)
    vi.advanceTimersByTime(999)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(cb).toHaveBeenCalledTimes(1)
    t.update(1)
    vi.advanceTimersByTime(5000)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(t.fired).toBe(true)
  })

  it("does not count below 50 %", () => {
    const cb = vi.fn()
    const t = createViewTimer(DISPLAY_VIEW_MS, cb, timers)
    t.update(0.49)
    vi.advanceTimersByTime(5000)
    expect(cb).not.toHaveBeenCalled()
  })

  it("resets when visibility is interrupted", () => {
    const cb = vi.fn()
    const t = createViewTimer(DISPLAY_VIEW_MS, cb, timers)
    t.update(0.8)
    vi.advanceTimersByTime(600)
    t.update(0.2)
    t.update(0.8)
    vi.advanceTimersByTime(600)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it("pauses while the page is hidden", () => {
    const cb = vi.fn()
    const t = createViewTimer(DISPLAY_VIEW_MS, cb, timers)
    t.update(1)
    vi.advanceTimersByTime(500)
    t.update(1, false)
    vi.advanceTimersByTime(2000)
    expect(cb).not.toHaveBeenCalled()
  })

  it("needs 2 s for video", () => {
    const cb = vi.fn()
    const t = createViewTimer(VIDEO_VIEW_MS, cb, timers)
    t.update(0.5)
    vi.advanceTimersByTime(1999)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it("stop() cancels a pending timer", () => {
    const cb = vi.fn()
    const t = createViewTimer(DISPLAY_VIEW_MS, cb, timers)
    t.update(1)
    t.stop()
    vi.advanceTimersByTime(5000)
    expect(cb).not.toHaveBeenCalled()
  })
})
