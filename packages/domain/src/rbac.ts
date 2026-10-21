import type { Role } from "./enums"

/**
 * Permission matrix (Settings → Team). The API enforces it on every route; the UI only hides what the API forbids.
 * Every authenticated role can read everything.
 */
export const PERMISSIONS = {
  "campaigns.write": "Create and edit campaign drafts",
  "campaigns.publish": "Publish, pause, resume and archive campaigns",
  "campaigns.targeting": "Edit country targeting",
  "creatives.write": "Create and edit creatives",
  "creatives.approve": "Approve creatives",
  "properties.write": "Manage properties & placements",
  "keys.manage": "Rotate / revoke SDK keys",
  "reports.export": "Export reports",
  "team.manage": "Manage team & roles",
  "budgets.write": "Edit budgets",
  "settings.write": "Edit global settings and countries",
  "events.write": "Manage conversion events",
  "audiences.write": "Manage audiences",
  "alerts.ack": "Acknowledge alerts",
} as const
export type Permission = keyof typeof PERMISSIONS

const O = "owner", A = "admin", CM = "campaign_manager", AN = "analyst", DEV = "developer"
const MATRIX: Record<Permission, Role[]> = {
  "campaigns.write": [O, A, CM],
  "campaigns.publish": [O, A, CM],
  "campaigns.targeting": [O, A, CM],
  "creatives.write": [O, A, CM],
  "creatives.approve": [O, A],
  "properties.write": [O, A, DEV],
  "keys.manage": [O, A, DEV],
  "reports.export": [O, A, CM, AN],
  "team.manage": [O, A],
  "budgets.write": [O, A],
  "settings.write": [O, A],
  "events.write": [O, A, DEV],
  "audiences.write": [O, A, CM],
  "alerts.ack": [O, A, CM, DEV],
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && MATRIX[permission].includes(role)
}

export function permissionsOf(role: Role): Permission[] {
  return (Object.keys(MATRIX) as Permission[]).filter((p) => MATRIX[p].includes(role))
}

/** Rows shown in the Settings → Team permission table. */
export const PERMISSION_TABLE: { permission: Permission; label: string; roles: Role[] }[] = (Object.keys(MATRIX) as Permission[]).map((p) => ({
  permission: p, label: PERMISSIONS[p], roles: MATRIX[p],
}))

/** Only an owner can grant or remove the owner role. */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (target === "owner") return actor === "owner"
  return can(actor, "team.manage")
}
