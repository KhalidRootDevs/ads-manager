import { describe, expect, it, vi } from "vitest"
import { BACKOFF_MAX_MS, backoffMs, MAX_EVENT_AGE_MS } from "../src/backoff"
import { BeaconQueue } from "../src/queue"
import { memStorage } from "./helpers"

const EP = "http://localhost:4200"

describe("backoff", () => {
  it("doubles from 2 s and caps at 5 min", () => {
    expect([0, 1, 2, 3, 4].map(backoffMs)).toEqual([0, 2000, 4000, 8000, 16000])
    expect(backoffMs(9)).toBe(BACKOFF_MAX_MS)
    expect(backoffMs(100)).toBe(BACKOFF_MAX_MS)
  })
})

describe("BeaconQueue", () => {
  it("persists to storage and restores on reload", () => {
    const storage = memStorage()
    const q = new BeaconQueue({ storage, send: async () => 204 })
    q.push("imp", "tok-1", EP, 1000)
    q.push("view", "tok-1", EP, 1000)
    expect(JSON.parse(storage.data.get("orbit.q")!)).toHaveLength(2)
    const q2 = new BeaconQueue({ storage, send: async () => 204, now: () => 2000 })
    expect(q2.size).toBe(2)
  })

  it("dedupes by type + token", () => {
    const q = new BeaconQueue({ storage: memStorage(), send: async () => 204 })
    expect(q.push("imp", "a", EP)).toBe(true)
    expect(q.push("imp", "a", EP)).toBe(false)
    expect(q.push("view", "a", EP)).toBe(true)
    expect(q.size).toBe(2)
  })

  it("flushes automatically at 20 events with the wire format", async () => {
    const send = vi.fn(async () => 204)
    const q = new BeaconQueue({ storage: memStorage(), send, now: () => 5 })
    for (let i = 0; i < 19; i++) q.push("imp", `t${i}`, EP)
    expect(send).not.toHaveBeenCalled()
    q.push("imp", "t19", EP)
    await vi.waitFor(() => expect(q.size).toBe(0))
    expect(send).toHaveBeenCalledTimes(1)
    const [url, body] = send.mock.calls[0] as unknown as [string, string]
    expect(url).toBe(`${EP}/v1/e`)
    const parsed = JSON.parse(body)
    expect(parsed.events).toHaveLength(20)
    expect(parsed.events[0]).toEqual({ type: "imp", token: "t0", at: 5 })
  })

  it("sends at most 50 events per request", async () => {
    const send = vi.fn(async () => 204)
    const q = new BeaconQueue({ storage: memStorage(), send, flushAt: 1000 })
    for (let i = 0; i < 120; i++) q.push("imp", `t${i}`, EP)
    await q.flush()
    expect(send.mock.calls.map((c) => JSON.parse((c as unknown as [string, string])[1]).events.length)).toEqual([50, 50, 20])
  })

  it("backs off exponentially on failure and retries after the delay", async () => {
    let now = 0
    const send = vi.fn(async () => 503)
    const q = new BeaconQueue({ storage: memStorage(), send, now: () => now, flushAt: 1000 })
    q.push("imp", "a", EP)
    await q.flush()
    expect(q.retryAt).toBe(2000)
    await q.tick() // still backing off
    expect(send).toHaveBeenCalledTimes(1)
    now = 2000
    await q.tick()
    expect(send).toHaveBeenCalledTimes(2)
    expect(q.retryAt).toBe(2000 + 4000)
    send.mockImplementation(async () => 204)
    now = 6000
    await q.tick()
    expect(q.size).toBe(0)
    expect(q.retryAt).toBe(0)
  })

  it("treats network errors and 429 as retryable, other 4xx as final", async () => {
    const q = new BeaconQueue({ storage: memStorage(), send: async () => { throw new Error("offline") }, flushAt: 1000 })
    q.push("imp", "a", EP)
    await q.flush()
    expect(q.size).toBe(1)
    const q429 = new BeaconQueue({ storage: memStorage(), send: async () => 429, flushAt: 1000 })
    q429.push("imp", "a", EP)
    await q429.flush()
    expect(q429.size).toBe(1)
    const q400 = new BeaconQueue({ storage: memStorage(), send: async () => 400, flushAt: 1000 })
    q400.push("imp", "a", EP)
    await q400.flush()
    expect(q400.size).toBe(0)
  })

  it("drops events older than 24 h", async () => {
    let now = 0
    const storage = memStorage()
    const send = vi.fn(async () => 503)
    const q = new BeaconQueue({ storage, send, now: () => now, flushAt: 1000 })
    q.push("imp", "old", EP, 0)
    now = MAX_EVENT_AGE_MS - 1000
    q.push("imp", "fresh", EP, now)
    now = MAX_EVENT_AGE_MS + 10
    await q.flush(true)
    expect(q.pending.map((x) => x.token)).toEqual(["fresh"])
    expect(new BeaconQueue({ storage, send, now: () => 3 * MAX_EVENT_AGE_MS }).size).toBe(0)
  })

  it("hands everything to sendBeacon on page hide and keeps refused batches", () => {
    const q = new BeaconQueue({ storage: memStorage(), send: async () => 204, flushAt: 1000 })
    for (let i = 0; i < 60; i++) q.push("imp", `t${i}`, EP)
    const calls: string[] = []
    let n = 0
    q.flushBeacon((url, body) => {
      calls.push(url)
      return n++ === 0 // the browser accepts the first batch only
    })
    expect(calls).toEqual([`${EP}/v1/e`, `${EP}/v1/e`])
    expect(q.size).toBe(10)
  })
})
