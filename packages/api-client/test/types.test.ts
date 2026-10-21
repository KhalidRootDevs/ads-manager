import { describe, expect, it } from "vitest"
import { createClient, type PathParams } from "../src"

describe("client typing and requests", () => {
  it("builds urls, bodies and idempotency headers from the contract", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
    }) as unknown as typeof fetch
    const api = createClient({ baseUrl: "http://api.test", fetch: fake })
    await api.call("listCampaigns", { query: { status: ["active", "paused"], limit: 10 } })
    await api.call("getCampaign", { params: { id: "cmp_01J9Z8ABCDEFGHJKMNPQRSTVWX" } })
    await api.call("publishCampaign", { params: { id: "cmp_x" }, body: { rev: 3 } })
    await api.call("rotateKey", { params: { id: "prp_x", keyId: "key_y" } })
    expect(calls[0].url).toBe("http://api.test/v1/campaigns?status=active&status=paused&limit=10")
    expect(calls[1].url).toBe("http://api.test/v1/campaigns/cmp_01J9Z8ABCDEFGHJKMNPQRSTVWX")
    expect(calls[2].init.method).toBe("POST")
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ rev: 3 })
    expect((calls[2].init.headers as Record<string, string>)["idempotency-key"]).toBeTruthy()
    expect(calls[3].url).toBe("http://api.test/v1/properties/prp_x/keys/key_y/rotate")
    // compile-time checks
    const p: PathParams<"/v1/properties/:id/keys/:keyId/rotate"> = { id: "a", keyId: "b" }
    expect(p.keyId).toBe("b")
    // @ts-expect-error params are required for :id paths
    void (() => api.call("getCampaign", {}))
  })

  it("throws ApiError with the problem body", async () => {
    const fake = (async () => new Response(JSON.stringify({ type: "x", title: "Conflict", status: 409, code: "conflict", detail: "Stale", current: { rev: 4 } }), { status: 409, headers: { "content-type": "application/problem+json" } })) as unknown as typeof fetch
    const api = createClient({ baseUrl: "http://api.test", fetch: fake })
    await expect(api.call("pauseCampaign", { params: { id: "cmp_x" }, body: { rev: 1 } })).rejects.toMatchObject({ status: 409, current: { rev: 4 } })
  })
})
