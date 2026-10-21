import { defineConfig } from "tsup"

/** The web tag: one dependency-free IIFE, served by the ad server at /tag/orbit.js (§8, < 12 KB gzipped). */
export default defineConfig({
  entry: { orbit: "src/index.ts" },
  format: ["iife"],
  platform: "browser",
  target: "es2019",
  minify: true,
  sourcemap: false,
  clean: true,
  dts: false,
  outExtension: () => ({ js: ".js" }),
})
