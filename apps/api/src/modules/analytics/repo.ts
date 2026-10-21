/**
 * Analytics reads (§6.5, §6.7): aggregations over the read-only rollup models on the analytics connection,
 * always date-bounded, with an explicit index hint and maxTimeMS. Entity names for row labels come from the primary.
 */
import type { Db } from "@orbit/db"
import { trusted } from "@orbit/db"
import type { PipelineStage } from "mongoose"
import { ANALYTICS_MAX_MS } from "../../lib/mongo"
import { models, roModels, type Lean } from "../../lib/types"

export type Hint = Record<string, 1>

export function analyticsRepo(db: Db) {
  const { DeliveryDailyRO, SupplyDailyRO } = roModels(db)
  const { Campaign, Property, Placement, Creative, Country } = models(db)
  const names = async (model: import("mongoose").Model<any>, ids: string[], proj: Record<string, 1>) =>
    ids.length ? model.find({ _id: trusted({ $in: ids }) }, proj).lean<Lean[]>() : ([] as Lean[])
  return {
    delivery: <T>(pipeline: PipelineStage[], hint: Hint) => DeliveryDailyRO.aggregate<T>(pipeline).option({ hint, maxTimeMS: ANALYTICS_MAX_MS }),
    supply: <T>(pipeline: PipelineStage[], hint: Hint) => SupplyDailyRO.aggregate<T>(pipeline).option({ hint, maxTimeMS: ANALYTICS_MAX_MS }),
    countries: () => Country.find({}, { name: 1, region: 1, enabled: 1 }).lean<Lean[]>(),
    campaignNames: (ids: string[]) => names(Campaign, ids, { name: 1, status: 1 }),
    propertyNames: (ids: string[]) => names(Property, ids, { name: 1, platform: 1 }),
    placementNames: (ids: string[]) => names(Placement, ids, { name: 1, propertyId: 1 }),
    creativeNames: (ids: string[]) => names(Creative, ids, { name: 1, format: 1 }),
  }
}
export type AnalyticsRepo = ReturnType<typeof analyticsRepo>
