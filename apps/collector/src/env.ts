import { commonEnv, parseEnv } from "@orbit/server-kit"
import { z } from "zod"

export const collectorEnvShape = {
  ...commonEnv,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("warn"),
  COLLECTOR_PORT: z.coerce.number().int().default(4200),
  KAFKA_BROKERS: z.string().default("localhost:19092"),
  TRACKING_SECRETS: z.string().min(10),
  TRACKING_ACTIVE_KID: z.string().min(1),
  KEY_PEPPER: z.string().min(16),
}
export const loadEnv = () => parseEnv(collectorEnvShape)
