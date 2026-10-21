import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@orbit/domain", "@orbit/api-client"],
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // The admin is rendered in the browser behind the auth gate, so routes aren't structured for
    // instant server navigation. Validate only segments that opt in with `export const instant`.
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    // Monorepo root, so workspace packages resolve from one place.
    root: fileURLToPath(new URL("../..", import.meta.url)),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
