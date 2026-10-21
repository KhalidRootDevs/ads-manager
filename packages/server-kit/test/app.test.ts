import { endpoints } from "@orbit/domain"
import { Router } from "express"
import pino from "pino"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { conflict, createApp, finalizeApp, route } from "../src"

const log = pino({ level: "silent" })

function app() {
  const a = createApp({ name: "test", log })
  const r = Router()
  route(r, endpoints.patchCountry, [], ({ params, body }) => {
    if (params.code === "XX") throw conflict("Stale", { code: "XX" })
    return { code: params.code, name: "Bangladesh", region: "South Asia", enabled: body.enabled }
  })
  a.use(r)
  finalizeApp(a, log)
  return a
}

describe("server-kit", () => {
  it("validates bodies with the contract and returns typed responses", async () => {
    const res = await request(app()).patch("/v1/countries/BD").send({ enabled: false })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ code: "BD", name: "Bangladesh", region: "South Asia", enabled: false })
    expect(res.headers["x-request-id"]).toBeTruthy()
  })

  it("renders problem+json for invalid input, conflicts and unknown routes", async () => {
    const bad = await request(app()).patch("/v1/countries/BD").send({ enabled: "nope" })
    expect(bad.status).toBe(400)
    expect(bad.headers["content-type"]).toContain("application/problem+json")
    expect(bad.body.errors[0].path).toBe("enabled")
    const strict = await request(app()).patch("/v1/countries/BD").send({ enabled: true, extra: 1 })
    expect(strict.status).toBe(400)
    const c = await request(app()).patch("/v1/countries/XX").send({ enabled: true })
    expect(c.status).toBe(409)
    expect(c.body.current).toEqual({ code: "XX" })
    const nf = await request(app()).get("/nope")
    expect(nf.status).toBe(404)
    expect(nf.body.code).toBe("not_found")
  })

  it("fails loudly when a response drifts from the contract", async () => {
    const a = createApp({ name: "test", log })
    const r = Router()
    route(r, endpoints.patchCountry, [], () => ({ code: "BD" }) as never)
    a.use(r)
    finalizeApp(a, log)
    const res = await request(a).patch("/v1/countries/BD").send({ enabled: true })
    expect(res.status).toBe(500)
  })

  it("exposes Prometheus metrics", async () => {
    const res = await request(app()).get("/metrics")
    expect(res.status).toBe(200)
    expect(res.text).toContain("http_request_duration_seconds")
  })
})
