/**
 * Mongoose connections (guideline §6.13). Two connections per service, never the global default:
 * - primary: CRUD, transactions, change streams
 * - analytics: read-only rollup models on the analytics node (falls back to any secondary)
 */
import mongoose, { type Connection, type InferSchemaType, type Model } from "mongoose"
import * as op from "./schemas/operational"
import * as ru from "./schemas/rollups"

mongoose.set("strictQuery", true)
mongoose.set("sanitizeFilter", true)
mongoose.set("autoIndex", false)
mongoose.set("autoCreate", false)

/** Operators in query filters must be wrapped: `{ status: trusted({ $in: [...] }) }` (sanitizeFilter is on). */
export const trusted = mongoose.trusted

export type ServiceName = "api" | "workers" | "jobs" | "migrate" | "seed" | "test"

export interface DbConfig {
  uri: string
  dbName: string
  service: ServiceName
  maxPoolSize?: number
  /** Analytics read preference; "secondaryPreferred" in dev so a single-node replica set works. */
  analyticsReadPreference?: "secondary" | "secondaryPreferred" | "primary"
}

const POOL: Record<ServiceName, number> = { api: 50, workers: 20, jobs: 10, migrate: 5, seed: 10, test: 10 }

/** Orbit only ever works inside its own databases on a shared cluster. */
export function assertOrbitDb(dbName: string) {
  if (!/^orbit[a-z0-9_-]*$/i.test(dbName)) throw new Error(`Refusing to use database "${dbName}": Orbit databases must be named orbit*`)
}

function registerOperational(conn: Connection) {
  return {
    User: conn.model("User", op.userSchema),
    Session: conn.model("Session", op.sessionSchema),
    Property: conn.model("Property", op.propertySchema),
    PropertyKey: conn.model("PropertyKey", op.propertyKeySchema),
    Placement: conn.model("Placement", op.placementSchema),
    Creative: conn.model("Creative", op.creativeSchema),
    CreativeVersion: conn.model("CreativeVersion", op.creativeVersionSchema),
    Campaign: conn.model("Campaign", op.campaignSchema),
    CampaignRevision: conn.model("CampaignRevision", op.campaignRevisionSchema),
    CampaignStats: conn.model("CampaignStats", op.campaignStatsSchema),
    Country: conn.model("Country", op.countrySchema),
    EventDefinition: conn.model("EventDefinition", op.eventDefinitionSchema),
    Settings: conn.model("Settings", op.settingsSchema),
    Budget: conn.model("Budget", op.budgetSchema),
    Audience: conn.model("Audience", op.audienceSchema),
    AuditLog: conn.model("AuditLog", op.auditLogSchema),
    Alert: conn.model("Alert", op.alertSchema),
    DeliveryDaily: conn.model("DeliveryDaily", ru.deliveryDailySchema),
    SupplyDaily: conn.model("SupplyDaily", ru.supplyDailySchema),
    Click: conn.model("Click", ru.clickSchema),
    Conversion: conn.model("Conversion", ru.conversionSchema),
    RequestSample: conn.model("RequestSample", ru.requestSampleSchema),
    RollupOffset: conn.model("RollupOffset", ru.rollupOffsetSchema),
  }
}

function registerReadOnly(conn: Connection) {
  return {
    DeliveryDailyRO: conn.model("DeliveryDaily", ru.deliveryDailySchema),
    SupplyDailyRO: conn.model("SupplyDaily", ru.supplyDailySchema),
    RequestSampleRO: conn.model("RequestSample", ru.requestSampleSchema),
  }
}

export type Models = ReturnType<typeof registerOperational>
export type ReadModels = ReturnType<typeof registerReadOnly>

export interface Db {
  primary: Connection
  analytics: Connection
  models: Models
  ro: ReadModels
  close(): Promise<void>
}

export async function connect(cfg: DbConfig): Promise<Db> {
  assertOrbitDb(cfg.dbName)
  const common = {
    dbName: cfg.dbName,
    maxPoolSize: cfg.maxPoolSize ?? POOL[cfg.service],
    serverSelectionTimeoutMS: 5_000,
    bufferCommands: false,
    retryWrites: true,
    retryReads: true,
    appName: `orbit-${cfg.service}`,
    autoIndex: false,
    autoCreate: false,
  }
  const primary = mongoose.createConnection(cfg.uri, { ...common, readPreference: "primary", writeConcern: { w: "majority", journal: true } })
  const rp = cfg.analyticsReadPreference ?? "secondaryPreferred"
  const analytics = mongoose.createConnection(cfg.uri, {
    ...common,
    maxPoolSize: Math.max(5, Math.floor((cfg.maxPoolSize ?? POOL[cfg.service]) / 2)),
    readPreference: rp,
    ...(rp === "primary" ? {} : { readPreferenceTags: [{ nodeType: "ANALYTICS" }, {}], maxStalenessSeconds: 90 }),
    readConcern: { level: "local" },
  })
  await Promise.all([primary.asPromise(), analytics.asPromise()])
  const models = registerOperational(primary)
  const ro = registerReadOnly(analytics)
  return {
    primary,
    analytics,
    models,
    ro,
    async close() {
      await Promise.all([primary.close(), analytics.close()])
    },
  }
}

/** Config from environment (MONGODB_URI, MONGODB_DB). */
export function dbConfigFromEnv(service: ServiceName, env: NodeJS.ProcessEnv = process.env): DbConfig {
  const uri = env.MONGODB_URI
  const dbName = env.MONGODB_DB
  if (!uri) throw new Error("MONGODB_URI is not set")
  if (!dbName) throw new Error("MONGODB_DB is not set")
  return { uri, dbName, service, analyticsReadPreference: (env.MONGODB_ANALYTICS_READ_PREF as DbConfig["analyticsReadPreference"]) ?? "secondaryPreferred" }
}

// ---------- persisted document types ----------
type Doc<M> = M extends Model<infer T> ? T : never
export type UserDoc = InferSchemaType<typeof op.userSchema> & { _id: string }
export type PropertyDoc = InferSchemaType<typeof op.propertySchema> & { _id: string }
export type PropertyKeyDoc = InferSchemaType<typeof op.propertyKeySchema> & { _id: string }
export type PlacementDoc = InferSchemaType<typeof op.placementSchema> & { _id: string }
export type CreativeDoc = InferSchemaType<typeof op.creativeSchema> & { _id: string }
export type CampaignDoc = InferSchemaType<typeof op.campaignSchema> & { _id: string }
export type CampaignStatsDoc = InferSchemaType<typeof op.campaignStatsSchema> & { _id: string }
export type AuditLogDoc = InferSchemaType<typeof op.auditLogSchema> & { _id: string }
export type AlertDoc = InferSchemaType<typeof op.alertSchema> & { _id: string }
export type DeliveryDailyDoc = InferSchemaType<typeof ru.deliveryDailySchema> & { _id: string }
export type SupplyDailyDoc = InferSchemaType<typeof ru.supplyDailySchema> & { _id: string }
export type { Doc }
