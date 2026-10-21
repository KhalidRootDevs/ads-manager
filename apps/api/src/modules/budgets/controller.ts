import type { endpoints } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"
import { ctxOf, p } from "../../lib/http"
import type { budgetsService } from "./service"

type E = typeof endpoints

export function budgetsController(svc: ReturnType<typeof budgetsService>) {
  return {
    list: (({ query }) => svc.list(query.quarter)) satisfies Handler<E["listBudgets"]>,
    put: (({ req, body }) => svc.put(ctxOf(req), p(req, "team"), p(req, "quarter"), body)) satisfies Handler<E["putBudget"]>,
  }
}
