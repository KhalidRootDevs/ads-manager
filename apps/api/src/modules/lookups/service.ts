import type { Lookups } from "@orbit/domain"
import type { lookupsRepo } from "./repo"

export function lookupsService(repo: ReturnType<typeof lookupsRepo>) {
  return {
    async get(): Promise<Lookups> {
      const [properties, placements, creatives, campaigns, users] = await Promise.all([repo.properties(), repo.placements(), repo.creatives(), repo.campaigns(), repo.users()])
      return {
        properties: properties.map((p) => ({ id: p._id, name: p.name, platform: p.platform, identifier: p.identifier })),
        placements: placements.map((p) => ({ id: p._id, name: p.name, propertyId: p.propertyId, format: p.format })),
        creatives: creatives.map((c) => ({ id: c._id, name: c.name, format: c.format, status: c.status })),
        campaigns: campaigns.sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ id: c._id, name: c.name, status: c.status })),
        users: users.map((u) => ({ id: u._id, name: u.name, email: u.email })),
      }
    },
  }
}
