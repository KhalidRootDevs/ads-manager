import { defineConfig } from "tsup"
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  noExternal: [/^@orbit\//],
  // CJS deps bundled from workspace packages (pino, dotenv…) call require(); give the ESM bundle one
  banner: { js: "import { createRequire as __orbitCreateRequire } from 'node:module'; const require = __orbitCreateRequire(import.meta.url);" },
})
