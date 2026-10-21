import type { Db } from "@orbit/db"
import type { Model } from "mongoose"

/**
 * Lean MongoDB documents as returned by `.lean()`. They are untyped on purpose: the contract types live in
 * `@orbit/domain`, and DTO mappers (lib/dto.ts) are the single place that turns documents into contract shapes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Lean = any

/** Models with loose filter typing: filters are built from Zod-parsed values and wrapped with `trusted()` where needed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const models = (db: Db) => db.models as unknown as Record<keyof Db["models"], Model<any>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const roModels = (db: Db) => db.ro as unknown as Record<keyof Db["ro"], Model<any>>
