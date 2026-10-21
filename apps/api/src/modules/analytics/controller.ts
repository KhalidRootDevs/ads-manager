import type { endpoints } from "@orbit/domain"
import { RawResponse, type Handler } from "@orbit/server-kit"
import type { AnalyticsService } from "./service"

type E = typeof endpoints

export function analyticsController(svc: AnalyticsService) {
  return {
    delivery: (({ body }) => svc.delivery(body)) satisfies Handler<E["analyticsDelivery"]>,
    heatmap: (({ body }) => svc.heatmap(body)) satisfies Handler<E["analyticsHeatmap"]>,
    noFill: (({ body }) => svc.noFill(body)) satisfies Handler<E["analyticsNoFill"]>,
    /** Streams `text/csv` row by row, honouring back-pressure. */
    exportCsv: (async ({ req, body }) => {
      const { filename, lines } = await svc.csv(body)
      const res = req.res!
      res.status(200)
      res.setHeader("Content-Type", "text/csv; charset=utf-8")
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
      res.setHeader("Cache-Control", "no-store")
      for (const line of lines) {
        if (!res.write(line + "\r\n")) await new Promise<void>((resolve) => res.once("drain", () => resolve()))
      }
      res.end()
      return new RawResponse()
    }) satisfies Handler<E["analyticsExport"]>,
  }
}
