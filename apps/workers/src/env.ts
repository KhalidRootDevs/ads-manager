import { commonEnv, parseEnv } from "@orbit/server-kit"
import { z } from "zod"

export const workersEnvShape = {
  ...commonEnv,
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().regex(/^orbit/i, "Orbit databases must be named orbit*"),
  KAFKA_BROKERS: z.string().default("localhost:19092"),
  WORKERS_PORT: z.coerce.number().int().default(4300),
  /** local | s3 */
  LAKE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LAKE_DIR: z.string().default(""),
  S3_BUCKET_LAKE: z.string().default(""),
  /** compile interval for time-based transitions */
  COMPILE_INTERVAL_MS: z.coerce.number().int().default(60_000),
  COMPILE_DEBOUNCE_MS: z.coerce.number().int().default(2_000),
}

export type WorkersEnv = ReturnType<typeof loadEnv>
export const loadEnv = () => parseEnv(workersEnvShape)
