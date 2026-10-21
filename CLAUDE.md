# Orbit Ads — instructions for Claude

Read `docs/02-production-build-guideline.md` before architectural changes and follow its ADRs. Propose an ADR in `docs/adr/` before deviating.

## Stack (fixed)
- web = Next.js 16 + shadcn/ui + TanStack Query + TanStack Table + Zustand + Zod (`apps/web`). Next.js 16 has breaking changes: read `apps/web/node_modules/next/dist/docs` before using new APIs.
- backend = Express 5 + Zod + Mongoose 9 (`apps/api`, `apps/workers`), Express 5 without Mongoose for the hot path (`apps/ad-server`, `apps/collector`).
- No new frameworks without an ADR. No new dependencies without saying why in the PR.

## Rules
- Business rules live ONLY in `packages/domain` (`@orbit/domain`). Never duplicate targeting, validation or metric logic in apps.
- API contract = `packages/domain/src/contracts.ts`. Routers register endpoints with `route()` from `@orbit/server-kit`; the client in `@orbit/api-client` is derived from the same contract. Change the contract first.
- Server data lives in TanStack Query only; Zustand holds UI state only.
- Express modules: router → controller → service → repo. Only repos import Mongoose models. Validate every input with the shared Zod schemas.
- Mongoose: autoIndex/autoCreate off, `.lean()` + projection on reads, rev-guarded `updateOne`, no field-level `index`/`unique` options, native `bulkWrite` only in `packages/db/src/rollups.ts`.
- `sanitizeFilter` is on globally: operators inside query filters must be wrapped with `trusted()` from `@orbit/db`, e.g. `{ status: trusted({ $in: statuses }) }`. Never pass request input into a filter without parsing it with Zod first.
- MongoDB: only the 22 indexes declared in `packages/db/src/schemas/*` (inventory §6.6). Adding one requires the named query, `explain()` before/after and an ADR line. `pnpm db:drift` must pass.
- Never query MongoDB from the ad-server request path (it has no Mongoose dependency). Never write raw events to MongoDB.
- Money = integer micros. IDs = prefixed ULIDs (`newId("campaign")`). Instants = UTC; reporting day = Asia/Dhaka (`reportingDay()`); campaign flights are calendar dates in the campaign time zone.
- Audit actions are dotted lowercase verbs: `campaign.published`, `key.rotated`, `role.changed`.

## Shared development database (IMPORTANT)
- `MONGODB_URI` in `.env` points at a shared Atlas cluster that also holds other projects' databases.
- Orbit uses ONLY the database named in `MONGODB_DB` (`orbit_ads_dev`). `connect()` refuses database names that don't start with `orbit`.
- Never drop or rename collections or databases on that cluster, and never touch databases other than `MONGODB_DB`. Never run `syncIndexes()`, `dropDatabase` or `drop()`. The only code allowed to empty documents is `pnpm db:seed --reset`, and only in Orbit's own collections inside the Orbit database. Tests use `mongodb-memory-server`.
- Never print or commit the connection string.

## Commands
- `pnpm infra:up` (Redis, Redpanda, MailHog) · `pnpm db:migrate` · `pnpm db:drift` · `pnpm db:seed`
- `pnpm dev` runs everything; per app: `pnpm --filter @orbit/api dev`, etc.
- `pnpm typecheck` · `pnpm test` · `pnpm build`

## Quality
- Tests are required: unit for domain, integration for db/api (memory server), Playwright for UI flows (1440/834/390).
- Small, focused changes. Explain trade-offs. Run typecheck and tests before saying something is done, and paste the results.
