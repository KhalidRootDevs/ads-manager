import { endpoints } from "@orbit/domain"
import type { Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import type { Reg } from "../../lib/registry"
import { campaignsController } from "./controller"
import { campaignsRepo } from "./repo"
import { campaignsService } from "./service"

/** Registration order matters: `/v1/campaigns/counts` and `/v1/campaigns/validate` before `/:id`. */
export function campaignsRoutes(reg: Reg, deps: Deps, audit: AuditWriter) {
  const c = campaignsController(campaignsService(deps, campaignsRepo(deps.db), audit))
  reg(endpoints.listCampaigns, c.list)
  reg(endpoints.campaignCounts, c.counts)
  reg(endpoints.validateDraft, c.validateDraft)
  reg(endpoints.createCampaign, c.create)
  reg(endpoints.getCampaign, c.get)
  reg(endpoints.patchCampaign, c.patch)
  reg(endpoints.validateCampaign, c.validate)
  reg(endpoints.publishCampaign, c.publish)
  reg(endpoints.pauseCampaign, c.pause)
  reg(endpoints.resumeCampaign, c.resume)
  reg(endpoints.archiveCampaign, c.archive)
  reg(endpoints.restoreCampaign, c.restore)
  reg(endpoints.duplicateCampaign, c.duplicate)
  reg(endpoints.campaignRevisions, c.revisions)
  reg(endpoints.targetingMatrix, c.matrix)
}
