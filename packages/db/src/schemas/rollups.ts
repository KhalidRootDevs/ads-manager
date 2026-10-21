/**
 * Analytics rollups and attribution collections (guideline §6.5). Short field names on purpose (§6.2).
 * Writes go through the native driver (`Model.collection.bulkWrite`) built in `rollups.ts`; these schemas
 * document the shape, declare the indexes and type the read path.
 */
import { Schema } from "mongoose"

const sub = { _id: false, id: false, versionKey: false as const, minimize: false }
const ro = { versionKey: false as const, strict: true, timestamps: false, minimize: false, id: false, autoCreate: false }

// ---------- delivery_daily: day × campaign × property × placement × creative × country × device ----------
export const deliveryDailySchema = new Schema(
  {
    _id: { type: String, required: true }, // "20261019|cmp_…|prp_…|plc_…|crv_…|BD|ph"
    d: { type: Date, required: true },
    c: { type: String, required: true },
    p: { type: String, required: true },
    pl: { type: String, required: true },
    cr: { type: String, required: true },
    cc: { type: String, required: true },
    dv: { type: String, required: true },
    pf: { type: String, required: true },
    f: { type: String, required: true },
    m: {
      type: new Schema(
        { imp: Number, view: Number, clk: Number, vs: Number, vc: Number, rw: Number, conv: Number, costMicros: Schema.Types.BigInt },
        sub,
      ),
    },
    h: { type: new Schema({ imp: [Number], clk: [Number] }, sub) },
  },
  { ...ro, collection: "delivery_daily" },
)
deliveryDailySchema.index({ c: 1, d: 1 }, { name: "c_1_d_1" })
deliveryDailySchema.index({ p: 1, d: 1 }, { name: "p_1_d_1" })
deliveryDailySchema.index({ cr: 1, d: 1 }, { name: "cr_1_d_1" })
deliveryDailySchema.index({ d: 1 }, { name: "d_1" })

// ---------- supply_daily: day × property × placement × country × device ----------
export const supplyDailySchema = new Schema(
  {
    _id: { type: String, required: true }, // "20261019|prp_…|plc_…|BD|ph"
    d: { type: Date, required: true },
    p: { type: String, required: true },
    pl: { type: String, required: true },
    cc: { type: String, required: true },
    dv: { type: String, required: true },
    pf: { type: String, required: true },
    m: { type: new Schema({ req: Number, elig: Number, fill: Number, err: Number, nf: Schema.Types.Mixed, latP50: Number, latP99: Number }, sub) },
    h: { type: new Schema({ req: [Number] }, sub) },
  },
  { ...ro, collection: "supply_daily" },
)
supplyDailySchema.index({ p: 1, d: 1 }, { name: "p_1_d_1" })
supplyDailySchema.index({ d: 1 }, { name: "d_1" })

// ---------- clicks (attribution window, TTL 8 days) ----------
export const clickSchema = new Schema(
  {
    _id: { type: String, required: true }, // clickId
    c: String, cr: String, p: String, pl: String, cc: String, dv: String, pf: String, f: String,
    uid: { type: String, default: null },
    at: { type: Date, required: true },
  },
  { ...ro, collection: "clicks" },
)
clickSchema.index({ at: 1 }, { expireAfterSeconds: 691_200, name: "at_ttl_8d" })

// ---------- conversions (_id = clickId:event → natural dedupe, TTL 90 days) ----------
export const conversionSchema = new Schema(
  {
    _id: { type: String, required: true },
    event: { type: String, required: true },
    valueMicros: { type: Schema.Types.BigInt, default: null },
    c: String, cr: String, p: String, pl: String, cc: String, dv: String,
    source: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { ...ro, collection: "conversions" },
)
conversionSchema.index({ at: 1 }, { expireAfterSeconds: 7_776_000, name: "at_ttl_90d" })

// ---------- request_samples (time-series, native TTL 7 days; the meta+time index is automatic) ----------
export const requestSampleSchema = new Schema(
  {
    at: { type: Date, required: true },
    k: { type: new Schema({ p: String, pl: String }, sub), required: true },
    cc: String,
    result: String,
    latencyMs: Number,
    sdk: { type: String, default: null },
  },
  { ...ro, collection: "request_samples", timeseries: { timeField: "at", metaField: "k", granularity: "seconds" }, expireAfterSeconds: 604_800 },
)

// ---------- rollup_offsets (exactly-once watermark per stream partition) ----------
export const rollupOffsetSchema = new Schema(
  { _id: { type: String, required: true }, offset: { type: String, required: true }, updatedAt: { type: Date, required: true } }, // `${topic}:${partition}`
  { ...ro, collection: "rollup_offsets" },
)
