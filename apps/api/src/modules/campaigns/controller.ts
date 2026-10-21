import type { endpoints } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"
import { ctxOf, p, sent } from "../../lib/http"
import type { CampaignsService } from "./service"

type E = typeof endpoints

export function campaignsController(svc: CampaignsService) {
  return {
    list: (({ query }) => svc.list(query)) satisfies Handler<E["listCampaigns"]>,
    counts: (() => svc.counts()) satisfies Handler<E["campaignCounts"]>,
    create: (({ req, body }) => svc.create(ctxOf(req), body)) satisfies Handler<E["createCampaign"]>,
    get: (({ req }) => svc.get(p(req, "id"))) satisfies Handler<E["getCampaign"]>,
    patch: (({ req, body }) => svc.patch(ctxOf(req), p(req, "id"), sent(req, body))) satisfies Handler<E["patchCampaign"]>,
    validate: (({ req }) => svc.validate(p(req, "id"))) satisfies Handler<E["validateCampaign"]>,
    validateDraft: (({ body }) => svc.validateDraft(body)) satisfies Handler<E["validateDraft"]>,
    publish: (({ req, body }) => svc.publish(ctxOf(req), p(req, "id"), body.rev)) satisfies Handler<E["publishCampaign"]>,
    pause: (({ req, body }) => svc.pause(ctxOf(req), p(req, "id"), body.rev)) satisfies Handler<E["pauseCampaign"]>,
    resume: (({ req, body }) => svc.resume(ctxOf(req), p(req, "id"), body.rev)) satisfies Handler<E["resumeCampaign"]>,
    archive: (({ req, body }) => svc.archive(ctxOf(req), p(req, "id"), body.rev)) satisfies Handler<E["archiveCampaign"]>,
    restore: (({ req, body }) => svc.restore(ctxOf(req), p(req, "id"), body.rev)) satisfies Handler<E["restoreCampaign"]>,
    duplicate: (({ req }) => svc.duplicate(ctxOf(req), p(req, "id"))) satisfies Handler<E["duplicateCampaign"]>,
    revisions: (({ req }) => svc.revisions(p(req, "id"))) satisfies Handler<E["campaignRevisions"]>,
    matrix: (({ req }) => svc.targetingMatrix(p(req, "id"))) satisfies Handler<E["targetingMatrix"]>,
  }
}
