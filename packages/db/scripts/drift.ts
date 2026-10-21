/** CI index-drift check: declared (schema.index) vs actual. Exits 1 on any difference. Never drops anything. */
import "./env"
import { connect, dbConfigFromEnv, declaredIndexes, EXPECTED_INDEX_COUNT, indexDrift } from "../src"

const db = await connect(dbConfigFromEnv("migrate"))
try {
  const declared = declaredIndexes(db.models)
  let failed = false
  if (declared.length !== EXPECTED_INDEX_COUNT) {
    console.error(`✗ ${declared.length} indexes declared, the guideline inventory (§6.6) has ${EXPECTED_INDEX_COUNT}`)
    failed = true
  }
  const drift = await indexDrift(db)
  for (const d of drift) console.error(`✗ ${d.collection}: create ${d.toCreate.join(", ") || "—"}; undeclared on cluster ${d.toDrop.join(", ") || "—"}`)
  if (drift.length) failed = true
  if (!failed) console.log(`✓ ${declared.length} declared indexes match database "${db.primary.name}"`)
  process.exitCode = failed ? 1 : 0
} finally {
  await db.close()
}
