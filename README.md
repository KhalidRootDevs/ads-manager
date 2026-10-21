# Orbit Ads

First-party ad platform for our own apps and websites, built to `docs/02-production-build-guideline.md`.

| Part | Path | Stack | Port |
|---|---|---|---|
| Admin UI | `apps/web` | Next.js 16, shadcn/ui, TanStack Query, TanStack Table, Zustand, Zod | 3000 |
| Admin API | `apps/api` | Express 5, Zod, Mongoose 9 | 4000 |
| Ad server (`/v1/serve`) | `apps/ad-server` | Express 5, in-memory serving index, Redis (no MongoDB) | 4100 |
| Event collector (beacons, clicks, conversions) | `apps/collector` | Express 5, Kafka (Redpanda), Redis | 4200 |
| Workers (compiler, aggregator, attribution, jobs, lake) | `apps/workers` | Mongoose 9, KafkaJS, Redis | 4300 |
| Domain rules, schemas, API contract | `packages/domain` | TypeScript, Zod | — |
| MongoDB models, 22 indexes, migrations, seed | `packages/db` | Mongoose 9 | — |
| Shared Express middleware | `packages/server-kit` | Express 5, pino | — |
| Typed API client + Query hooks | `packages/api-client` | TanStack Query | — |
| Web tag | `packages/sdk-web` | TypeScript, no dependencies (≈ 5 KB gzipped) | — |

## Run it locally

Requirements: Node 22+, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env          # then set MONGODB_URI (and secrets for anything beyond local dev)
pnpm infra:up                 # Redis, Redpanda (+ topics), MailHog
pnpm db:migrate               # collections, validators, the 22 indexes, search index
pnpm db:drift                 # declared indexes == cluster
pnpm db:seed                  # demo data: 38 properties, campaigns, 60 days of rollups
pnpm dev                      # every app in watch mode
```

Open http://localhost:3000 and sign in with a demo user (development sign-in): `arif.hossain@orbit.example` (owner), `nadia.rahman@orbit.example` (admin), `priya.menon@orbit.example` (campaign manager), `mei.tanaka@orbit.example` (analyst), `imran.qureshi@orbit.example` (developer), `fatima.noor@orbit.example` (read-only).

Demo SDK keys for calling the ad server are written to `.data/demo-keys.json` (git-ignored) by the seed.

```bash
# request an ad as an app would
curl -s localhost:4100/v1/serve -H 'content-type: application/json' \
  -H "x-orbit-app: <propertyId>" -H "x-orbit-key: <test key>" \
  -d '{"placementId":"<placementId>","device":{"type":"phone","appVersion":"6.2.1"},"test":true}'
pnpm --filter @orbit/workers e2e   # serve → beacons → rollups, with replay/dedupe checks
```

The web tag demo page is `packages/sdk-web/demo/index.html`.

## Development database

`MONGODB_URI` may point at a shared Atlas cluster. Orbit only uses the database named in `MONGODB_DB` (it must start with `orbit`), never drops or renames collections, and `pnpm db:seed --reset` only empties Orbit's own collections in that database. See `CLAUDE.md`.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | All apps in watch mode (or `pnpm --filter @orbit/<app> dev`) |
| `pnpm typecheck` · `pnpm test` · `pnpm build` | Across the monorepo (Turborepo) |
| `pnpm db:migrate` · `pnpm db:drift` · `pnpm db:seed [--reset]` | Database lifecycle |
| `pnpm --filter @orbit/api openapi` | Regenerate `docs/openapi.json` (also served at `/v1/openapi.json`) |
| `pnpm --filter @orbit/ad-server bench` | Decision-path benchmark |
| `pnpm --filter @orbit/workers jobs:run reconcile` | Run a job on demand (reconcile, retention, alerts, …) |

## Architecture in one paragraph

Admins work in the Next.js UI, which only talks to the Express API. The API stores operational data in MongoDB (Mongoose, exactly the 22 indexes of guideline §6.6). The config compiler watches change streams, compiles active campaigns into a versioned serving index in Redis, and the stateless ad servers keep it in memory — the request path never touches MongoDB. Ad responses carry HMAC-signed tracking URLs; the collector verifies them, dedupes, and writes events to Kafka. The rollup aggregator turns events into `delivery_daily` / `supply_daily` upserts (exactly-once via a transactional offset watermark), attribution matches conversions to clicks, the lake sink archives raw events, and the jobs worker maintains statuses, alerts, health and reconciliation. Dashboards read rollups through the analytics connection.

## Docs

- `docs/02-production-build-guideline.md` — architecture, MongoDB design, security, operations, build plan
- `docs/03-technical-guide.md` — how the parts connect, configuration, and hosting on a VPS or managed services
- `docs/04-product-guide.md` — the product explained for non-technical readers
- `docs/DATA_MODEL.md` — entities, rollups and metrics
- `docs/openapi.json` — admin API
- `CLAUDE.md` — rules for working on this repo with Claude
