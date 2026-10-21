// Prints the gzipped size of the built tag and fails the build above the 12 KB budget (§8).
import { readFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
const buf = readFileSync(new URL("../dist/orbit.js", import.meta.url))
const gz = gzipSync(buf, { level: 9 }).length
const kb = (n) => (n / 1024).toFixed(2) + " KB"
console.log(`dist/orbit.js: ${kb(buf.length)} raw, ${kb(gz)} gzipped (budget 12 KB)`)
if (gz > 12 * 1024) {
  console.error("Web tag exceeds the 12 KB gzipped budget")
  process.exit(1)
}
