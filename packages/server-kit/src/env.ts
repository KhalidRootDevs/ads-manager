/** Environment parsed once at boot with Zod; the process exits if anything is missing or invalid (§3.5). */
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { config } from "dotenv"
import { z } from "zod"

/** In development, load the repo-root .env (walks up from cwd). Production gets env from the runtime. */
export function loadDotenv() {
  if (process.env.NODE_ENV === "production") return
  let dir = process.cwd()
  for (let i = 0; i < 5; i++) {
    const p = join(dir, ".env")
    if (existsSync(p) && existsSync(join(dir, "pnpm-workspace.yaml"))) {
      config({ path: p, quiet: true })
      return
    }
    dir = dirname(dir)
  }
}

export function parseEnv<T extends z.ZodRawShape>(shape: T, source: NodeJS.ProcessEnv = process.env): z.infer<z.ZodObject<T>> {
  loadDotenv()
  const r = z.object(shape).safeParse(source)
  if (!r.success) {
    console.error("Invalid environment:\n" + r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"))
    process.exit(1)
  }
  return r.data
}

export const zBool = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1")

/** Common variables shared by services. */
export const commonEnv = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
}
