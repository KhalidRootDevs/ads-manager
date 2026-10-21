import type { Country, Settings } from "@orbit/domain"
import { conflict, notFound } from "@orbit/server-kit"
import type { ClientSession } from "mongoose"
import type { Ctx, Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import { countryDto, settingsDto } from "../../lib/dto"
import { arrow, capText } from "../../lib/format"
import type { SettingsRepo } from "./repo"

type SettingsInput = Omit<Settings, "updatedAt" | "currency" | "reportingTz">

/** "Frequency cap 4/day → 6/day; Refresh 60 s → 30 s" */
function settingsDiff(a: Settings, b: SettingsInput): string {
  const out: string[] = []
  if (capText(a.defaults.freqCap) !== capText(b.defaults.freqCap)) out.push(`Frequency cap ${arrow(capText(a.defaults.freqCap), capText(b.defaults.freqCap))}`)
  if (a.defaults.refreshSec !== b.defaults.refreshSec) out.push(`Refresh ${arrow(a.defaults.refreshSec ? `${a.defaults.refreshSec} s` : "off", b.defaults.refreshSec ? `${b.defaults.refreshSec} s` : "off")}`)
  for (const k of ["clicks", "viewability", "ipTruncation"] as const) if (a.tracking[k] !== b.tracking[k]) out.push(`${k === "ipTruncation" ? "IP truncation" : k[0].toUpperCase() + k.slice(1)} tracking ${b.tracking[k] ? "on" : "off"}`)
  if (a.autoPauseOnBudget !== b.autoPauseOnBudget) out.push(`Auto-pause on budget ${b.autoPauseOnBudget ? "on" : "off"}`)
  return out.join("; ") || "No changes"
}

export function settingsService(deps: Pick<Deps, "db">, repo: SettingsRepo, audit: AuditWriter) {
  const tx = <T>(fn: (s: ClientSession) => Promise<T>) => deps.db.primary.transaction(fn)
  return {
    get: async (): Promise<Settings> => settingsDto(await repo.get()),
    async put(ctx: Ctx, input: SettingsInput): Promise<Settings> {
      const before = settingsDto(await repo.get())
      return tx(async (s) => {
        const { rev, ...fields } = input
        const updated = await repo.update(rev, { $set: fields }, s)
        if (!updated) throw conflict("Settings were changed by someone else. Review the latest values.", settingsDto(await repo.get()))
        await audit(ctx, { action: "settings.changed", target: { type: "settings", id: "global", name: "Workspace" }, detail: settingsDiff(before, input) }, s)
        return settingsDto(updated)
      })
    },
    countries: async (): Promise<{ items: Country[] }> => ({ items: (await repo.countries()).map(countryDto) }),
    async setCountry(ctx: Ctx, code: string, enabled: boolean): Promise<Country> {
      const c = await repo.country(code)
      if (!c) throw notFound("Country")
      if (c.enabled === enabled) return countryDto(c)
      return tx(async (s) => {
        const updated = await repo.setCountry(code, enabled, s)
        await audit(ctx, { action: enabled ? "country.enabled" : "country.disabled", target: { type: "country", id: code, name: c.name }, detail: c.region }, s)
        return countryDto(updated!)
      })
    },
  }
}
export type SettingsService = ReturnType<typeof settingsService>
