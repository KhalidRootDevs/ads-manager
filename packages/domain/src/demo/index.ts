/**
 * Demo workspace (`@orbit/domain/demo`): the prototype's seed data in production shapes plus a delivery generator.
 * Used by `pnpm db:seed` and by tests. Browser-safe: no node imports and no secrets (the db seed creates SDK keys).
 */
export { buildDemo, refreshHealth, type Demo, type DemoAlert, type DemoCampaignRevision, type DemoCreativeVersion, type DemoKey, type DemoOptions, type DemoSim } from "./build"
export {
  DEVICE_MIX, deviceSplit, distribute, generateDelivery, HOUR_PROFILE, spentByCampaign,
  type DeliveryDailyRow, type DeliveryOptions, type DeliveryOutput, type SupplyDailyRow,
} from "./delivery"
export { DEMO_EMAIL_DOMAIN, emailOf, PROTO_TODAY, TEAM } from "./data"
export { rng } from "./random"
