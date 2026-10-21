/** OpenAPI 3.1 document generated from the contract (§7.1) with zod-openapi. */
import { endpoints, zProblem, type Endpoint } from "@orbit/domain"
import { z } from "zod"
import { createDocument, type ZodOpenApiOperationObject, type ZodOpenApiPathsObject } from "zod-openapi"

const ERRORS: Record<string, string> = { "400": "Invalid input", "401": "Not signed in", "403": "Not allowed for your role", "404": "Not found", "409": "Conflict (stale rev or duplicate)", "422": "Unprocessable", "429": "Rate limited" }

export function openApiDocument(serverUrl?: string) {
  const paths: ZodOpenApiPathsObject = {}
  for (const [name, raw] of Object.entries(endpoints)) {
    const ep = raw as Endpoint
    const path = ep.path.replace(/:([A-Za-z]+)/g, "{$1}")
    const params = [...ep.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1])
    const status = String(ep.status ?? 200)
    const isCsv = ep.path.endsWith(".csv")
    const op: ZodOpenApiOperationObject = {
      operationId: name,
      summary: ep.summary,
      tags: [ep.path.split("/")[2] ?? "misc"],
      ...(ep.permission === "public" ? { security: [] } : {}),
      ...(ep.permission && ep.permission !== "public" ? { description: `Requires the \`${ep.permission}\` permission.` } : {}),
      requestParams: {
        ...(params.length ? { path: z.object(Object.fromEntries(params.map((p) => [p, z.string()]))) } : {}),
        ...(ep.query ? { query: ep.query as z.ZodObject } : {}),
        ...(ep.idempotent ? { header: z.object({ "idempotency-key": z.string().min(8).max(128).optional().meta({ description: "Retry-safe key; the first response is replayed for 24 h." }) }) } : {}),
      },
      ...(ep.body ? { requestBody: { content: { "application/json": { schema: ep.body } } } } : {}),
      responses: {
        [status]: { description: "Success", content: isCsv ? { "text/csv": { schema: z.string() } } : { "application/json": { schema: ep.response } } },
        ...Object.fromEntries(Object.entries(ERRORS).map(([code, description]) => [code, { description, content: { "application/problem+json": { schema: zProblem } } }])),
      },
    }
    const method = ep.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete"
    paths[path] = { ...(paths[path] ?? {}), [method]: op }
  }
  return createDocument(
    {
    openapi: "3.1.0",
    info: { title: "Orbit Ads admin API", version: "1.0.0", description: "Generated from packages/domain/src/contracts.ts. Errors are RFC 9457 problem+json." },
    servers: serverUrl ? [{ url: serverUrl }] : [],
    security: [{ session: [] }],
    components: { securitySchemes: { session: { type: "apiKey", in: "cookie", name: "orbit_sid" } } },
    paths,
    },
    // Shared schemas become components instead of being inlined everywhere.
    { reused: "ref" },
  )
}
