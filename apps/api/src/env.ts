/** API environment, parsed once at boot (§3.5). The process exits when anything is missing or invalid. */
import { commonEnv, parseEnv, zBool } from "@orbit/server-kit"
import { z } from "zod"

export const envShape = {
  ...commonEnv,
  API_PORT: z.coerce.number().int().default(4000),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().regex(/^orbit[a-z0-9_-]*$/i, "Orbit databases must be named orbit*"),
  MONGODB_ANALYTICS_READ_PREF: z.enum(["secondary", "secondaryPreferred", "primary"]).default("secondaryPreferred"),
  SESSION_SECRET: z.string().min(32),
  KEY_PEPPER: z.string().min(32),
  WEB_ORIGIN: z.string().url(),
  API_URL: z.string().url(),
  AD_SERVER_URL: z.string().url().default("http://localhost:4100"),
  INTERNAL_TOKEN: z.string().min(16),
  AUTH_DEV_LOGIN: zBool,
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  CDN_BASE_URL: z.string().url(),
  /** Local storage root (default: <repo>/.data/uploads). */
  UPLOAD_DIR: z.string().optional(),
  S3_BUCKET_CREATIVES: z.string().optional(),
  AWS_REGION: z.string().optional(),
  OIDC_ISSUER: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URI: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  /** Optional Google Workspace domain restriction (the `hd` claim). */
  OIDC_ALLOWED_DOMAIN: z.string().optional(),
  RATE_LIMIT_ADMIN_PER_MIN: z.coerce.number().int().default(600),
  RATE_LIMIT_ANALYTICS_PER_MIN: z.coerce.number().int().default(60),
  RATE_LIMIT_LOGIN_PER_MIN: z.coerce.number().int().default(20),
  /** Prefix for every Redis key this process writes (tests isolate themselves with it). */
  REDIS_PREFIX: z.string().default(""),
}

const zEnv = z.object(envShape)
export type Env = z.infer<typeof zEnv>

export function loadEnv(): Env {
  return parseEnv(envShape)
}

/** For tests: parse a plain object without exiting the process. */
export function envFrom(source: Record<string, string | undefined>): Env {
  return zEnv.parse(source)
}
