/**
 * Development helper: report what's in the Orbit dev database and, with `--create`, add the owner
 * `arif.hossain@orbit.example` ONLY if no user with that email exists (used before `pnpm db:seed` has run).
 * Never deletes or overwrites anything. Usage: `tsx --env-file=../../.env scripts/dev-owner.ts [--create]`
 */
import { connect, dbConfigFromEnv } from "@orbit/db"
import { newId } from "@orbit/domain"

const EMAIL = "arif.hossain@orbit.example"
const db = await connect(dbConfigFromEnv("api"))
try {
  const m = db.models
  const owner = await m.User.findOne({ email: EMAIL }, { email: 1, role: 1, status: 1 }).collation({ locale: "en", strength: 2 }).lean()
  console.log(`database ${db.primary.name}:`, {
    users: await m.User.countDocuments({}), properties: await m.Property.countDocuments({}), campaigns: await m.Campaign.countDocuments({}),
    creatives: await m.Creative.countDocuments({}), countries: await m.Country.countDocuments({}), deliveryDaily: await m.DeliveryDaily.estimatedDocumentCount(),
    owner: owner ? `${owner.email} (${owner.role}, ${owner.status})` : null,
  })
  if (process.argv.includes("--create") && !owner) {
    await m.User.create({ _id: newId("user"), email: EMAIL, name: "Arif Hossain", role: "owner", status: "active" })
    console.log(`created ${EMAIL} (owner)`)
  }
} finally {
  await db.close()
}
