import type { Db } from "@orbit/db"
import { ADMIN_MAX_MS } from "../../lib/mongo"
import { opt, revUpdate, type Session } from "../../lib/rev"
import { models, type Lean } from "../../lib/types"

export const DEFAULT_SETTINGS = {
  reportingTz: "Asia/Dhaka", currency: "USD", defaults: { freqCap: { count: 6, per: "day" }, refreshSec: 60 },
  tracking: { clicks: true, viewability: true, ipTruncation: true }, autoPauseOnBudget: true, killSwitch: false,
}

export function settingsRepo(db: Db) {
  const { Settings, Country } = models(db)
  return {
    /** Singleton `_id: "global"`, created with defaults on first read. */
    async get(): Promise<Lean> {
      const s = await Settings.findById("global").maxTimeMS(ADMIN_MAX_MS).lean<Lean>()
      if (s) return s
      return Settings.findOneAndUpdate({ _id: "global" }, { $setOnInsert: { ...DEFAULT_SETTINGS, rev: 0 } }, { upsert: true, returnDocument: "after" }).lean<Lean>() as Promise<Lean>
    },
    update: (rev: number, update: Lean, session?: Session) => revUpdate(Settings, "global", rev, update, session),
    countries: () => Country.find({}).sort({ name: 1 }).maxTimeMS(ADMIN_MAX_MS).lean<Lean[]>(),
    country: (code: string, session?: Session) => Country.findById(code, null, opt(session)).lean<Lean>(),
    setCountry: (code: string, enabled: boolean, session?: Session) =>
      Country.findOneAndUpdate({ _id: code }, { $set: { enabled } }, { returnDocument: "after", runValidators: true, ...opt(session) }).lean<Lean>(),
  }
}
export type SettingsRepo = ReturnType<typeof settingsRepo>
