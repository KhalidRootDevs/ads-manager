import "./env"
import { connect, dbConfigFromEnv, runMigrations } from "../src"

const db = await connect(dbConfigFromEnv("migrate"))
console.log(`Migrating database "${db.primary.name}"`)
try {
  await runMigrations(db)
} finally {
  await db.close()
}
