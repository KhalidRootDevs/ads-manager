import type { Db } from "@orbit/db"
import { trusted } from "@orbit/db"
import { ADMIN_MAX_MS } from "../../lib/mongo"
import { models, type Lean } from "../../lib/types"

export function lookupsRepo(db: Db) {
  const { Property, Placement, Creative, Campaign, User } = models(db)
  const t = ADMIN_MAX_MS
  return {
    properties: () => Property.find({}, { name: 1, platform: 1, identifier: 1 }).sort({ name: 1 }).maxTimeMS(t).lean<Lean[]>(),
    placements: () => Placement.find({}, { name: 1, propertyId: 1, format: 1 }).sort({ name: 1 }).maxTimeMS(t).lean<Lean[]>(),
    creatives: () => Creative.find({ status: trusted({ $ne: "archived" }) }, { name: 1, format: 1, status: 1 }).sort({ name: 1 }).maxTimeMS(t).lean<Lean[]>(),
    /** Non-archived campaigns via I1 (status prefix). */
    campaigns: () => Campaign.find({ status: trusted({ $in: ["draft", "scheduled", "active", "paused", "completed"] }) }, { name: 1, status: 1 }).maxTimeMS(t).lean<Lean[]>(),
    users: () => User.find({}, { name: 1, email: 1 }).sort({ name: 1 }).maxTimeMS(t).lean<Lean[]>(),
  }
}
