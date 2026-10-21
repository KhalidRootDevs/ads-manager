import type { endpoints } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"
import { ctxOf, p } from "../../lib/http"
import type { SettingsService } from "./service"

type E = typeof endpoints

export function settingsController(svc: SettingsService) {
  return {
    get: (() => svc.get()) satisfies Handler<E["getSettings"]>,
    put: (({ req, body }) => svc.put(ctxOf(req), body)) satisfies Handler<E["putSettings"]>,
    countries: (() => svc.countries()) satisfies Handler<E["listCountries"]>,
    patchCountry: (({ req, body }) => svc.setCountry(ctxOf(req), p(req, "code").toUpperCase(), body.enabled)) satisfies Handler<E["patchCountry"]>,
  }
}
