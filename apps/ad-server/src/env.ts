import { commonEnv, parseEnv } from "@orbit/server-kit"
import { z } from "zod"

export const adServerEnvShape = {
  ...commonEnv,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("warn"),
  AD_SERVER_PORT: z.coerce.number().int().default(4100),
  KAFKA_BROKERS: z.string().default("localhost:19092"),
  TRACKING_URL: z.string().default("http://localhost:4200"),
  TRACKING_SECRETS: z.string().min(10),
  TRACKING_ACTIVE_KID: z.string().min(1),
  KEY_PEPPER: z.string().min(16),
  UID_PEPPER: z.string().min(16),
  INTERNAL_TOKEN: z.string().min(16),
  REQUEST_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.01),
  DEV_DEFAULT_COUNTRY: z.string().regex(/^[A-Z]{2}$/).default("BD"),
  GEOIP_DB_PATH: z.string().default(""),
  SDK_MIN_VERSION: z.string().default("2.0.0"),
  SDK_WEB_DIST: z.string().default(""),
  /** pacing multiplier for even-paced campaigns while Redis is unreachable (§10 degraded mode) */
  DEGRADED_PACING_FACTOR: z.coerce.number().min(0).max(1).default(0.5),
}
export type AdServerEnv = ReturnType<typeof loadEnv>
export const loadEnv = () => parseEnv(adServerEnvShape)
