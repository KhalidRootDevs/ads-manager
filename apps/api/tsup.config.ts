import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
  // Workspace packages ship TypeScript sources, so they are bundled; npm dependencies stay external.
  noExternal: [/^@orbit\//],
  // Transitive CJS deps of the workspace packages (pino, helmet, …) get bundled; give them a real `require`.
  banner: { js: 'import { createRequire as __orbitCreateRequire } from "node:module"; const require = __orbitCreateRequire(import.meta.url);' },
})
