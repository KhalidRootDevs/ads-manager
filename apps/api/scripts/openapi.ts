/** Writes docs/openapi.json from the contract: `pnpm --filter @orbit/api openapi`. */
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { openApiDocument } from "../src/lib/openapi"

const out = fileURLToPath(new URL("../../../docs/openapi.json", import.meta.url))
const doc = openApiDocument()
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n")
console.log(`Wrote ${out} (${Object.keys(doc.paths ?? {}).length} paths)`)
