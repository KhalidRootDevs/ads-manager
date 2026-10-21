import { FORMAT_LABEL, newId, placementSizes, sizeLabel, type AdFormat, type Placement, type PlacementCreate, type PlacementPatch } from "@orbit/domain"
import { conflict, notFound, unprocessable } from "@orbit/server-kit"
import type { ClientSession } from "mongoose"
import type { Ctx, Deps } from "../../context"
import type { AuditWriter } from "../../lib/audit"
import { placementDto } from "../../lib/dto"
import { isDuplicate } from "../../lib/mongo"
import type { Lean } from "../../lib/types"
import type { PlacementsRepo } from "./repo"

const DUP = "A placement with this name already exists on this property."

/** The property must offer the format, and the size must be one the format supports (`placementSizes`). */
function checkFormat(property: Lean, format: AdFormat, size: string) {
  if (!(property.formats ?? []).includes(format)) throw unprocessable(`${property.name} doesn’t have ${FORMAT_LABEL[format]} enabled. Enable the format on the property first.`, [{ path: "format", message: "Format not enabled on this property" }])
  const sizes = placementSizes(format)
  if (!sizes.includes(size)) throw unprocessable(`${FORMAT_LABEL[format]} placements use ${sizes.map(sizeLabel).join(", ")}.`, [{ path: "size", message: `Choose one of ${sizes.join(", ")}` }])
}

const detail = (p: { format: AdFormat; size: string; status: string }) => `${FORMAT_LABEL[p.format]} · ${sizeLabel(p.size)} · ${p.status}`

export function placementsService(deps: Pick<Deps, "db">, repo: PlacementsRepo, audit: AuditWriter) {
  const tx = <T>(fn: (s: ClientSession) => Promise<T>) => deps.db.primary.transaction(fn)
  return {
    list: async (propertyId?: string): Promise<{ items: Placement[] }> => ({ items: (await repo.list(propertyId)).map(placementDto) }),
    async get(id: string): Promise<Placement> {
      const pl = await repo.byId(id)
      if (!pl) throw notFound("Placement")
      return placementDto(pl)
    },
    async create(ctx: Ctx, input: PlacementCreate): Promise<Placement> {
      const prop = await repo.property(input.propertyId)
      if (!prop) throw unprocessable("The property doesn’t exist.", [{ path: "propertyId", message: "Unknown property" }])
      checkFormat(prop, input.format, input.size)
      try {
        return await tx(async (s) => {
          const pl = await repo.insert({ _id: newId("placement"), ...input, rev: 0 }, s)
          await audit(ctx, { action: "placement.created", target: { type: "placement", id: pl!._id, name: `${input.name} (${prop.name})` }, detail: detail(input) }, s)
          return placementDto(pl!)
        })
      } catch (e) {
        if (isDuplicate(e)) throw conflict(DUP, undefined, "duplicate")
        throw e
      }
    },
    async patch(ctx: Ctx, id: string, input: PlacementPatch): Promise<Placement> {
      const before = await repo.byId(id)
      if (!before) throw notFound("Placement")
      const { rev, ...fields } = input
      if (fields.format !== undefined || fields.size !== undefined) {
        const prop = await repo.property(before.propertyId)
        checkFormat(prop ?? { name: "The property", formats: [] }, fields.format ?? before.format, fields.size ?? before.size)
      }
      try {
        return await tx(async (s) => {
          const updated = await repo.update(id, rev, fields, s)
          if (!updated) {
            const cur = await repo.byId(id, s)
            throw conflict("This placement was changed by someone else. Review the latest version.", cur ? placementDto(cur) : undefined)
          }
          const action = fields.status && fields.status !== before.status ? (fields.status === "paused" ? "placement.paused" : "placement.activated") : "placement.updated"
          await audit(ctx, { action, target: { type: "placement", id, name: updated.name }, detail: detail(updated as never) }, s)
          return placementDto(updated)
        })
      } catch (e) {
        if (isDuplicate(e)) throw conflict(DUP, undefined, "duplicate")
        throw e
      }
    },
  }
}
