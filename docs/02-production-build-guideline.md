# 02 — Orbit Ads: Production Build Guideline

> **Purpose.** This is the step-by-step plan for turning the clickable prototype in `orbit-ads/` into a production-grade, first-party ad platform. It also covers how to build it with Claude.
> **Audience.** Engineers (and Claude) building the product, plus whoever reviews architecture and database design.
> **Inputs.** `01-claude-design-prompt.md` (product spec), `orbit-ads/` (Next.js prototype: UI, domain logic, data model), `orbit-ads/docs/DATA_MODEL.md` (entity and analytics model).
> **Scale target.** 4–10 million monthly users across ~40 owned apps and websites, with spiky live-sports traffic.
> **Stack (fixed).** Frontend: **Next.js, shadcn/ui, TanStack Query, TanStack Table, Zustand, Zod**. Backend: **Express.js, Zod, MongoDB with Mongoose**. All services are TypeScript on Node.js 22 LTS.

---

## Table of contents

1. [Product scope recap](#1-product-scope-recap)
2. [Traffic model and capacity planning](#2-traffic-model-and-capacity-planning)
3. [System architecture](#3-system-architecture)
4. [The ad decision path (hot path)](#4-the-ad-decision-path-hot-path)
5. [Event pipeline and analytics](#5-event-pipeline-and-analytics)
6. [MongoDB design (production)](#6-mongodb-design-production)
7. [API design](#7-api-design)
8. [SDKs and web tag](#8-sdks-and-web-tag)
9. [Security, privacy and compliance](#9-security-privacy-and-compliance)
10. [Reliability, observability and operations](#10-reliability-observability-and-operations)
11. [Testing strategy](#11-testing-strategy)
12. [Infrastructure, CI/CD and environments](#12-infrastructure-cicd-and-environments)
13. [Step-by-step build plan with Claude](#13-step-by-step-build-plan-with-claude)
14. [Working effectively with Claude](#14-working-effectively-with-claude)
15. [Launch checklist](#15-launch-checklist)
16. [Appendix: decisions, glossary and open questions](#16-appendix)

---

## 1. Product scope recap

Orbit Ads is an **internal, first-party** ad platform. One company runs ads on its own apps and websites. There is no auction, no external advertisers, no billing and no ad-network demand. That shapes everything below. Correctness, low latency and reporting trust matter more than marketplace features.

| Area | What production needs | Prototype reference |
|---|---|---|
| Creatives | Reusable assets, 9 formats, per-format validation, review workflow (Draft → In Review → Ready / Rejected → Archived), version history, CDN-hosted files | `src/app/(app)/creatives`, `components/creatives/creative-checks.ts` |
| Apps & websites ("properties") | Register Android, iOS and Web properties; SDK keys (shown once, hashed at rest, rotate with grace period, revoke); default country availability; allowed formats; test mode; diagnostics | `src/app/(app)/properties`, `components/properties` |
| Placements | Named slots per property with format, size, minimum app version, frequency cap and refresh | `src/app/(app)/placements`, `components/domain/placement-dialog.tsx` |
| Campaigns | 8-step wizard. Multiple creatives; **country rules per property** (all / include / exclude) checked against property defaults; compatible placements only; schedule, dayparting, devices, frequency caps, audiences (future); budget, goal, pacing, per-property allocation; review + publish; pause, resume, duplicate, archive | `components/campaigns/*`, `lib/sim.ts` (`compat`, `finalCountries`, `conflictsFor`) |
| Delivery | Ad decision API used by SDKs and the web tag | (new) |
| Analytics | Requests vs impressions, clicks, CTR, conversions, spend, eCPM, fill rate, video completion; by day, country, region, property, placement, creative, format, platform, device and hour; geo map; funnel; insights | `src/app/(app)/analytics`, `lib/analytics.ts`, `docs/DATA_MODEL.md` |
| Operations | Team and roles (6 roles), audit log, countries and regions, conversion events, internal budgets, alerts | `src/app/(app)/settings`, `billing`, `audiences` |

**Non-goals for v1:** real-time bidding, external demand, invoicing, advertiser self-serve, user-level behavioural targeting (audiences stay "future-ready").

---

## 2. Traffic model and capacity planning

"4–10 million monthly traffic" is read as **up to 10 M monthly active users and sessions** across all properties. Ads multiply that. Plan for the high end and for live-match spikes.

### 2.1 Planning numbers (design for the right-hand column)

| Metric | Expected | **Design target** | Notes |
|---|---|---|---|
| Monthly active users | 4–10 M | **10 M** | Sports apps dominate |
| Ad requests / month | 300–600 M | **1 B** | ~30–100 per user per month (banners refresh every 30–60 s) |
| Average request rate | 115–230 rps | **~385 rps** | 1 B ÷ 2.6 M s |
| Peak request rate | 1–2 k rps | **5 k rps** | Live cricket and football produce 10–15× spikes within seconds |
| Impressions / month | ~80 % of requests | **800 M** | Fill rate ~80 % |
| Tracking events (impression + click + video + viewability) | — | **~1.2 B / month**, peak **6 k/s** | All go through the collector, never straight to MongoDB |
| Clicks / month | ~0.6–1 % of impressions | **8 M** | Stored for attribution, 8-day TTL |
| Conversions / month | — | **≤ 1 M** | Deduplicated per click and event |
| Admin console users | 10–50 | 50 | Low traffic, high data value |
| Dashboard query rate | — | ≤ 20 qps peak | Cached 60 s |

### 2.2 What this means

1. **The ad decision path must not touch MongoDB.** 5 k rps of synchronous database reads is possible but fragile and expensive. The ad server works from an **in-memory serving index**, kept fresh from MongoDB change streams.
2. **Raw events must not land in MongoDB.** 1.2 B rows per month would make MongoDB the bottleneck and the largest cost. Raw events go to a durable stream, then to an object-store data lake. MongoDB stores **pre-aggregated rollups** only, about 3–10 k documents per day.
3. **Frequency caps and pacing live in Redis.** They are atomic counters with TTLs and need sub-millisecond writes.
4. **Horizontal scaling is stateless.** Ad servers and collectors are stateless containers behind a load balancer and autoscale on CPU and request rate.

### 2.3 Latency and availability targets (SLOs)

| Service | SLO |
|---|---|
| `POST /v1/serve` (ad decision) | p50 < 15 ms, **p99 < 50 ms** at the load balancer; 99.95 % monthly availability |
| Beacon collector | p99 < 30 ms; 99.95 %; **zero data loss after a 2xx** |
| Rollup freshness | Dashboards ≤ **2 min** behind real time |
| Admin API | p95 < 300 ms; 99.9 % |
| Analytics queries | p95 < 800 ms over 30 days, all campaigns |
| Data durability | RPO ≤ 5 min (MongoDB PITR); RTO ≤ 1 h |

---

## 3. System architecture

### 3.1 Components

```
                         ┌──────────────────────── Admin (internal) ───────────────────────┐
  Staff browser ──HTTPS──► CDN/WAF ─► web (Next.js admin UI) ─► api (Admin REST API, TS) ──┐ │
                         └──────────────────────────────────────────────────────────────────┘ │
                                                                                            │
                                         MongoDB Atlas (replica set) ◄──────────────────────┤
                                           ▲          │ change streams                      │
                                           │          ▼                                     │
                                           │   config-compiler ──► Redis (serving index blob + pub/sub)
                                           │                                 │
  Apps / Web ─SDK/tag─► Global LB ─► ad-server (Express, stateless) ◄────────┘ (in-memory index)
        │                                   │  ▲  frequency caps / pacing (Redis)
        │                                   ▼  │
        └── beacons (imp/click/video) ─► collector (stateless) ─► Event stream (Kafka/Redpanda/Kinesis)
                                                                       │
                     ┌─────────────────────────────────────────────────┼─────────────────────────┐
                     ▼                                                 ▼                         ▼
           rollup-aggregator                                   raw-sink (Parquet)         attribution
     ($inc upserts every 15 s into                           → S3 data lake (13 mo)   (clicks TTL, conversion
      delivery_daily / supply_daily,                         → Athena/BigQuery for     dedupe, writes into
      campaign_stats; spend → Redis)                          ad-hoc + reprocessing    rollups)
                     │
                     ▼
        MongoDB rollups ─► api /v1/analytics/* (Redis cache 60 s) ─► Analytics & Reports UI

  Creative uploads: web ─► api issues pre-signed URL ─► S3 (private) ─► image/video processing (Lambda) ─► CloudFront
  Jobs (scheduler): campaign status transitions, health/alerts, pacing reconciliation, nightly data-quality checks
```

### 3.2 Services and responsibilities

| Service | Tech (recommended) | Responsibility | Scales on |
|---|---|---|---|
| `web` | Next.js 16 (existing prototype), React 19, Tailwind, shadcn/ui, **TanStack Query**, TanStack Table, Zustand (UI state only), Zod | Admin UI only, no direct database access | Static plus edge |
| `api` | Node 22 + TypeScript, **Express 5**, Zod, **Mongoose 9** | CRUD, validation, RBAC, publishing, analytics queries, audit | CPU (2–4 pods) |
| `config-compiler` | Node/TS worker, Mongoose change streams (singleton with leader election) | Watches MongoDB change streams; compiles the serving index; publishes versioned blob to Redis | 1 active + 1 standby |
| `ad-server` | Node 22 + **Express 5**, Zod, ioredis. **No Mongoose, no MongoDB connection** | `/v1/serve`: eligibility, frequency caps, pacing, creative rotation, signed tracking URLs | RPS / CPU (3–20 pods) |
| `collector` | Node 22 + **Express 5**, Zod, Kafka client (KafkaJS / `@confluentinc/kafka-javascript`) | `/v1/e` beacons: HMAC verification, dedupe, enrich (geo, user-agent), publish to stream | RPS (3–15 pods) |
| `rollup-aggregator` | Node/TS consumer group, Mongoose connection (native `bulkWrite`, see §6.13) | Windowed aggregation → MongoDB bulk upserts; spend → Redis | Stream partitions |
| `raw-sink` | Kafka Connect S3 sink / Kinesis Firehose | Parquet files partitioned by `dt/hour` | Managed |
| `attribution` | Node/TS consumer + Mongoose | Stores clicks (8-day TTL); matches conversions by `clickId`; dedupes | Partitions |
| `jobs` | Node/TS + Mongoose + BullMQ (Redis) | Status transitions, health flags, alerts, reconciliation, purge | Light |
| `media` | S3 + Lambda (sharp, ffmpeg) + CloudFront | Validate dimensions, size and duration; transcode; generate thumbnails | Managed |

### 3.3 Monorepo layout

```
orbit/
  apps/
    web/                 ← move orbit-ads/ here (Next.js admin UI)
    api/                 ← Express admin + analytics API
    ad-server/           ← Express decision service (no database driver)
    collector/           ← Express beacon intake
    workers/             ← config-compiler, rollup-aggregator, attribution, jobs
  packages/
    domain/              ← PURE TS: types, Zod schemas, targeting rules, compat(), finalCountries(), validation, metric defs
    db/                  ← Mongoose connections, schemas + models, repositories, migrations, index definitions (single source of truth)
    api-client/          ← typed fetch client + TanStack Query hooks/keys, built from the Zod contracts in domain
    server-kit/          ← shared Express middleware: validate(), problem+json errors, auth, request id, logging, shutdown
    sdk-web/             ← web tag (TypeScript → tiny IIFE bundle)
    config/              ← eslint, tsconfig, prettier presets
  sdks/
    android/             ← Kotlin library
    ios/                 ← Swift package
  infra/                 ← Terraform (AWS + Atlas), Helm charts or ECS task definitions
  docs/                  ← ADRs, runbooks, DATA_MODEL.md, API reference
```

Tooling: **pnpm workspaces + Turborepo**, TypeScript `strict`, ESLint, Prettier, Vitest, Supertest, Playwright, k6, Changesets. Services build with `tsup` and run as plain `node dist/index.js` (no `ts-node` in production).

> **Reuse the prototype.** `orbit-ads/src/lib/sim.ts` (`compat`, `availSet`, `finalCountries`, `ruleSummary`, `conflictsFor`, `pacing`), `lib/analytics.ts` (`METRICS`, dimensions) and `components/creatives/creative-checks.ts` hold the real business rules. Move them into `packages/domain` with unit tests **first**, so the UI, API and ad server compiler share the same logic. The simulation (`genFacts`, `rng`) stays in a `packages/domain/demo` module for seeding dev and staging.

### 3.4 Frontend stack and conventions (`apps/web`)

| Concern | Library | Rules |
|---|---|---|
| Framework | **Next.js 16** (App Router) | The admin is behind SSO, so pages are client-rendered shells with Server Components only for layout. No database access and no business secrets in Next.js; everything goes through `api`. Read `node_modules/next/dist/docs` before using new APIs |
| UI | **shadcn/ui** + Tailwind 4 + Lucide | Keep the prototype's tokens (`globals.css`), components and responsive behaviour (1440 / 834 / 390). Add components with the shadcn CLI; don't fork them unless needed |
| Server state | **TanStack Query v5** | *All* data from the API lives here, never in Zustand. One query-key factory per resource in `@orbit/api-client` (`campaignKeys.list(filters)`, `campaignKeys.detail(id)`). Defaults: `staleTime` 30 s for entities, 60 s for analytics (matches the API cache), `refetchOnWindowFocus` on for lists, `retry` 2 except on 4xx. Analytics queries use `placeholderData: keepPreviousData`, so charts don't flash when filters change |
| Mutations | TanStack Query `useMutation` | Optimistic updates only for cheap toggles (pause/resume, archive) with rollback in `onError`. Publish, key rotation and anything with a transaction wait for the server and then `invalidateQueries`. Send `If-Match: rev` and `Idempotency-Key` headers from the client wrapper |
| Tables | **TanStack Table v8** | The prototype's `DataTable` stays. Lists switch to **server-side** mode (`manualPagination`, `manualSorting`, `manualFiltering`) with cursor pagination from §7.1; small reference lists (countries, team) stay client-side |
| UI state | **Zustand** | Only cross-component UI state: sidebar, dirty/leave-guard flag, wizard draft (persisted to `sessionStorage`), table column visibility. The prototype's data store (`lib/store.ts`) is removed in Phase 4 |
| Validation | **Zod** (shared from `@orbit/domain`) | The *same* schemas validate forms and API payloads. Forms use React Hook Form + `zodResolver`. In development the API client also `parse`s responses, so contract drift fails loudly; in production it skips parsing for speed |
| URL state | Next.js search params | Filters, tabs and date ranges stay in the URL, as in the prototype (`/analytics?days=14&country=BD`) and feed query keys directly |

### 3.5 Backend stack and conventions (Express + Zod + Mongoose)

- **Express 5** for every HTTP service (`api`, `ad-server`, `collector`). Express 5 forwards rejected promises from async handlers to the error middleware, so no `express-async-handler` wrappers.
- **Module layout** in `api`: `src/modules/<resource>/{router.ts, controller.ts, service.ts, repo.ts}`. Routers parse input, controllers map HTTP ↔ service, services hold use cases and transactions, and repos are the only code that touches Mongoose models. Business rules come from `@orbit/domain`, never re-implemented.
- **Validation**: a `validate({ params, query, body })` middleware in `@orbit/server-kit` runs Zod `safeParse` and replaces `req.body` / `req.query` with the parsed, typed values. Unknown keys are stripped (`.strip()` default) and `z.strictObject` is used on write payloads so typos fail. Responses are typed by the same contracts.
- **Standard middleware order**: `requestId` → `pino-http` (JSON logs, redaction of auth headers and keys) → `helmet` → `cors` (admin origin allow-list only) → `express.json({ limit: "100kb" })` (1 MB for SDK batches on the collector) → session/auth → rate limit (`express-rate-limit` + `rate-limit-redis`) → routes → 404 → **problem+json error handler** (maps `ZodError` → 400, `ConflictError` → 409, Mongo duplicate key `11000` → 409, unknown → 500 without leaking stack traces).
- **Process settings**: `app.set("trust proxy", 1)` behind the ALB, `app.disable("x-powered-by")`, `server.keepAliveTimeout` above the load balancer idle timeout (e.g. 65 s vs 60 s), graceful shutdown on `SIGTERM` (stop accepting, drain in-flight requests ≤ 10 s, close Mongoose and Redis, exit).
- **Configuration**: environment variables parsed once at boot with a Zod schema (`env.ts`); the process exits if any are missing or invalid.
- **Mongoose** is the ODM for `api` and all workers. Its production rules (no auto-indexing, `lean()` reads, `sanitizeFilter`, native `bulkWrite` for rollups and more) are in **§6.13**.
- **Hot-path services stay lean**: `ad-server` and `collector` don't load Mongoose, sessions or body parsers they don't need; their only dependencies are Express, Zod, ioredis, the stream client and `maxmind`. See §4.4 for Node tuning.

### 3.6 Key architecture decisions (summarised ADRs)

| # | Decision | Why | Rejected alternative |
|---|---|---|---|
| 1 | MongoDB Atlas holds operational data **and** analytics rollups | One operational store; rollups are small (≤ 10 k docs/day); flexible campaign documents with embedded targets | Postgres + ClickHouse (more moving parts for v1; reconsider in §6.12) |
| 2 | Raw events go to a stream + S3, **never** to MongoDB | 1.2 B events/month; replayable; cheap retention | Writing every beacon to MongoDB (cost, write amplification, hot shards) |
| 3 | The ad server never queries MongoDB on the request path | p99 latency and isolation: database incidents can't take ads down | Read-through cache (still couples latency to the database) |
| 4 | The serving index is compiled centrally (`config-compiler`) | Ad servers stay simple; one place validates targeting; atomic version switch | Each ad server watching change streams (N× connections, inconsistent states) |
| 5 | Frequency caps and pacing in Redis (cluster mode, persistence on) | Atomic `INCR` + TTL, sub-millisecond | MongoDB counters (too slow, too many writes) |
| 6 | Signed tracking URLs (HMAC) | Collector verifies without a lookup; blocks forged beacons | Opaque IDs needing a database lookup |
| 7 | One reporting time zone (Asia/Dhaka, UTC+6, no DST) for daily buckets | Internal company; stable "day" boundaries; hourly arrays allow re-bucketing if needed | Per-user time zones in rollups (query complexity) |
| 8 | Money stored as **integer micros** (`Long`) | No float drift in budgets or eCPM | `double` dollars |
| 9 | Prefixed, time-sortable IDs (`cmp_01J…`, ULID) as `_id` | Readable in logs and URLs; sortable; avoids an extra unique "publicId" index | ObjectId + separate public ID (an extra index on every collection) |
| 10 | **One language (TypeScript) end to end**, Express for all HTTP services, including the ad server | The decision function, targeting rules and Zod contracts are shared code, so UI, API, compiler and ad server can't disagree; one hiring and tooling profile | Go ad server (lower p99 per core, but a second language and a cross-language conformance suite) |
| 11 | Mongoose for all MongoDB access, with `autoIndex` off and indexes managed by migrations | Typed models, middleware and casting for operational data; index governance stays explicit | Raw driver everywhere (more boilerplate); Mongoose auto-indexing (creates indexes at boot, uncontrolled) |

---

## 4. The ad decision path (hot path)

### 4.1 Request

```http
POST https://ads.orbit.example/v1/serve
X-Orbit-App: prp_01J9…            # public property id (= properties._id)
X-Orbit-Key: ok_live_…           # SDK key secret over TLS; the server stores only HMAC(secret, pepper) — web uses origin allow-list + site id
{
  "placementId": "plc_01J9…",
  "device": { "type": "phone", "os": "android", "osVersion": "14", "appVersion": "6.2.1", "lang": "bn" },
  "uid": "u_8c1f…",               # first-party install id / cookie id, hashed client-side (no IDFA/GAID)
  "consent": { "gdpr": false, "tcf": null, "att": "authorized" },
  "test": false
}
```

### 4.2 Decision algorithm (all in memory, target < 5 ms CPU)

1. **Authenticate**: check the property exists and is `active`; hash the `X-Orbit-Key` secret with the server pepper and match it against the active or grace key hashes in the serving index (a hash can't verify a signature made with the secret, so the key itself is sent over TLS, like any API key). Test keys force `test` creatives only.
2. **Resolve context**: country from the client IP using **MaxMind GeoIP2 Country** (in-process database, updated weekly; IP truncated before logging). Device type, platform and app version come from the request.
3. **Candidate lookup**: `index.byPlacement[placementId]` holds the pre-compiled candidates. Each is `{campaignId, creatives[], allowedCountries: bitset, schedule, devices, minAppVersion, priority, weight, freqCap, pacing}`. Only campaigns that are `active`, inside their flight and have ≥ 1 `ready` creative compatible with this placement are compiled in.
4. **Filter**: country ∈ `allowedCountries` (already resolves *property availability ∩ enabled countries ∩ campaign rule*; conflicts are excluded at compile time), schedule and dayparting in the **campaign** time zone, device, min app version, audience (future, always pass in v1).
5. **Frequency cap**: Redis `GET fc:{uidHash}:{campaignId}:{period}` (pipelined for all candidates in one round trip). Drop capped candidates.
6. **Pacing**: Redis token bucket `pace:{campaignId}:{hourBucket}`. Even pacing releases `remainingBudget / remainingHours` per hour; ASAP is uncapped until the budget is spent. Drop campaigns with an exhausted budget.
7. **Select**: highest `priority` tier first, then weighted random by remaining-goal share, so campaigns behind pace get a little more weight.
8. **Choose creative**: weighted rotation among the campaign's compatible ready creatives (even by default; optimise-by-CTR later).
9. **Respond**: return the ad payload with **signed tracking URLs**, then fire-and-forget `INCR` on frequency-cap keys with `EXPIRE`. Requests and no-fills are counted via the supply event (below).
10. **No fill**: `204` plus a `supply` event recording the reason (`no_candidates`, `capped`, `paced`, `country`, `paused_property`). This feeds the fill-rate diagnostics.

```json
{
  "requestId": "req_01J9…",
  "ad": {
    "creativeId": "crv_01J9…", "campaignId": "cmp_01J9…", "format": "banner", "size": "320x50",
    "assets": { "image": "https://cdn.orbit.example/c/crv_01J9…/v3/320x50.webp" },
    "copy": { "headline": "Every World Cup goal in 60 seconds", "cta": "Watch now" },
    "click": { "url": "https://t.orbit.example/c/…signed…", "deepLink": "drmsport://highlights/world-cup" },
    "tracking": { "impression": "https://t.orbit.example/i/…signed…", "viewable": "https://t.orbit.example/v/…", "video": { "start": "…", "complete": "…" } },
    "ttlSec": 300, "refreshSec": 60
  }
}
```

**Signed token**: `base64url(payload).HMAC-SHA256(payload, trackingSecret)`. The payload is `{r: requestId, c, cr, p, pl, cc, dv, ts, fmt}`. Secrets rotate via the `kid` field. Tokens expire after 24 h for impressions and 7 days for clicks.

### 4.3 Serving index compilation (`config-compiler`)

- On start, it loads `campaigns {status ∈ [scheduled, active]}`, their creatives, properties, placements, countries and property keys (hashes only).
- It subscribes to **change streams** on those collections (`fullDocument: "updateLookup"`). It debounces 2 s, recompiles, writes `serving:index:{version}` (compressed JSON or MessagePack) to Redis, sets `serving:current = version` and publishes `serving:updated`.
- Ad servers load the current version on boot, swap atomically on the pub/sub message, and keep the last good index if a load fails.
- **Time-based transitions** (scheduled → active at start, active → completed at end) are evaluated by the compiler every minute in each campaign's time zone, so no cron race is needed for serving. `jobs` persists the status change for the UI.
- Compile-time validation: drops conflicts (country included but not available), placements whose format or size no creative matches, and paused properties or placements. It emits **health issues** back to `campaigns.health` (shown as "Needs attention").

### 4.4 Capacity

- An Express ad-server task (1 vCPU, 1 GB, one Node process per vCPU) handles about **1–1.5 k rps at p99 < 25 ms** with this in-memory workload. Run **6 tasks minimum across 3 AZs**, autoscaling to 30 on CPU > 55 % **or event-loop lag p99 > 20 ms** (`perf_hooks.monitorEventLoopDelay`, exported as a metric). Confirm the per-task number with the Phase 5 benchmark before sizing production.
- **Node tuning for the hot path**:
  - Keep the serving index as plain objects, `Map`s and `Uint8Array` country bitsets, built once per version, never re-parsed per request.
  - Run Zod on the request body with a small precompiled schema; skip response validation.
  - Use ioredis with `enableAutoPipelining` and one pipelined round trip per request; MaxMind lookups via the in-memory `maxmind` reader.
  - Don't use compression middleware (responses are < 2 KB), sessions or `cookie-parser` on `/v1/serve`.
  - Log via `pino` at `warn` level on the hot path and sample `info` at 1 %.
  - Set `--max-old-space-size` to ~75 % of the task memory; watch GC pause metrics.
  - Escape hatch (ADR 10): if the benchmark misses p99, swap only the HTTP layer of `ad-server` (e.g. `uWebSockets.js`). The decision package is framework-free, so nothing else changes.
- Redis: ~3 ops per request at peak (pipelined) → ~15 k ops/s. Use a Redis 7 cluster, 3 shards with replicas (ElastiCache / Memorystore / Redis Cloud). Persistence: AOF every second. If frequency-cap data is lost, the impact is at most one over-delivery window.
- **Pre-warm** before scheduled big matches (raise the min replicas through a schedule-aware autoscaler).

---

## 5. Event pipeline and analytics

### 5.1 Event types

| Event | Source | Key fields | Volume |
|---|---|---|---|
| `supply` | ad-server (server-side) | requestId, p, pl, cc, dv, result (`filled` / `no_fill:<reason>` / `error`), latencyMs | = requests (1 B/mo) |
| `imp` | SDK beacon | signed token, ts, viewable? | 800 M/mo |
| `viewable` | SDK (≥ 50 % pixels for ≥ 1 s; video 2 s) | token | ~600 M/mo |
| `click` | redirect endpoint `/c/…` (302 to destination) | token, clickId (ULID) | 8 M/mo |
| `video_start`, `video_complete`, `reward` | SDK | token | ~50 M/mo |
| `conversion` | SDK (`Orbit.trackEvent`), web tag, or server-to-server API | clickId or (uid + campaign within window), event key, value | ≤ 1 M/mo |
| `heartbeat` | SDK every 60 s while active (sampled) | p, sdkVersion, testMode | throttled |

### 5.2 Collector

- `POST /v1/e` accepts a **batch** of up to 50 events (SDKs batch every 10 s or on background). `GET /i/{token}` serves a pixel fallback for web.
- Verify the HMAC token and reject expired or invalid tokens (`invalid_token` metric).
- **Dedupe**: Redis `SET dd:{type}:{requestId} 1 NX EX 86400`. Duplicates are dropped and counted.
- Enrich: server receive time, geo (only if not already in the token), bot filtering (known user agents, data-centre IP ranges, impossible rates per uid).
- Produce to stream topic `events.v1`, partitioned by `campaignId` (supply events by `propertyId`) with `acks=all`. Return `204` only after the broker acknowledges, which is the **no-loss guarantee**.

### 5.3 Rollup aggregator

- A consumer group on `events.v1` aggregates in memory per **15-second window** keyed by rollup dimensions.
- It flushes with **one unordered `bulkWrite`** per window: `updateOne({_id}, {$inc: …, $setOnInsert: dims}, {upsert: true})`. That's a few hundred to a few thousand ops per flush. MongoDB never sees per-event writes.
- **Exactly-once effect**: commit stream offsets only **after** the bulk write succeeds. Retries can re-apply a window, so the aggregator writes a **watermark document per partition** (`rollup_offsets`) inside the same transaction as the bulk write. On restart it skips windows at or below the stored offset. It's a single-partition transaction of ≤ 1,000 ops, which is fine.
- Also updates `campaign_stats` (lifetime and today counters used by lists, pacing and budgets) and the Redis spend counter used by pacing.
- **Late events** (up to 24 h) are applied to the correct day bucket. Older events go to a dead-letter topic and are counted.

### 5.4 Data lake

- The raw stream goes to S3 as Parquet, partitioned `dt=YYYY-MM-DD/hour=HH/type=…`, kept 13 months (lifecycle → Glacier after 90 days).
- Queried with Athena, BigQuery or DuckDB for ad-hoc analysis, audits and **reprocessing**. A rollup bug can be fixed by replaying a day into a fresh collection and swapping it in.

### 5.5 Data quality and reconciliation (nightly job)

- Raw impression count per campaign-day (Athena) must match `delivery_daily` within 0.1 %. Alert otherwise.
- Clicks must be ≤ impressions per creative-day; CTR > 30 % is flagged as suspicious, likely fraud or a bug.
- `campaign_stats` totals must equal the sum of `delivery_daily`. Auto-repair by recompute if not.

---

## 6. MongoDB design (production)

> Written from the perspective of a senior MongoDB engineer. Principles: **model for the queries**, **embed what is read together and bounded**, **reference what grows without bound**, **every index maps to a named query**, **no speculative indexes**, and **raw events stay out of MongoDB**.

### 6.1 Cluster and configuration

| Setting | Value | Reason |
|---|---|---|
| Deployment | **MongoDB Atlas**, MongoDB 8.0, 3-node replica set across 3 AZs, region **ap-south-1 (Mumbai)** (closest to BD, IN and PK users and the admin team) | Managed upgrades, PITR, Online Archive |
| Tier | **M30** to start (8 GB RAM, 2 vCPU), auto-scaling on to M40 | Working set (operational + 3 months of rollups + indexes) is < 3 GB; RAM headroom for aggregations |
| Analytics node | +1 **analytics node** (M30) for dashboard aggregations, via `readPreferenceTags: [{nodeType: "ANALYTICS"}]` | Keeps heavy `$group` queries off the primary and the electable secondaries |
| Storage | 100 GB, auto-expand | Rollups ≈ 1–2 GB/year; audit and samples are small |
| Backups | **Continuous cloud backup with PITR (7 days)** + daily snapshots kept 35 days + monthly kept 12 months | RPO ≤ 5 min |
| Online Archive | `audit_log` older than 400 days | Cheap long-term retention, still queryable |
| Write concern | `w: "majority"`, `j: true` (default) for everything, including rollups | Rollup write rate is low (≤ 300 ops/s), so durability costs nothing noticeable |
| Read concern | `majority` for admin reads after writes; `local` on the analytics node | Avoid reading rolled-back writes in the UI |
| Read preference | Admin CRUD: `primary`. Analytics: analytics node, falling back to `secondaryPreferred`, `maxStalenessSeconds: 90` | Dashboards tolerate ≤ 2 min staleness (same as the freshness SLO) |
| Retryable writes and reads | on | Driver default |
| Connection pools | api: `maxPoolSize 50` per pod; workers: 20; ad server: **0** (no MongoDB connection) | Bounded connections (M30 limit 3,000) |
| Network | Private endpoint (AWS PrivateLink); IP access list empty | No public exposure |
| Auth | SCRAM per service with **least-privilege custom roles** (e.g. `api_rw` on operational collections, `rollup_writer` with `update` only on rollup collections, `analytics_ro`) + Atlas audit logging on | Blast-radius control |
| Encryption | At rest (Atlas default) + **Queryable Encryption / CSFLE not needed**: no PII beyond staff emails; SDK secrets are hashed, never stored | Avoid unnecessary complexity |
| Compression | `zstd` block compressor for rollup collections (`storageEngine.wiredTiger.configString: "block_compressor=zstd"`) | ~30–40 % smaller than snappy on numeric documents |
| Schema validation | `$jsonSchema` on every collection, `validationLevel: "strict"`, `validationAction: "error"` (rollups: `"warn"` in the first month, then `"error"`) | Defence in depth beside Zod |
| Sharding | **Not in v1.** See §6.11 for triggers and the chosen shard key | Data volume is far below sharding thresholds |

### 6.2 Conventions

- **IDs**: `_id` is a prefixed ULID string, e.g. `cmp_01J9Z8…`. Prefixes: `usr_`, `prp_`, `key_`, `plc_`, `crv_`, `cmp_`, `aud_`, `evt_`. Reference collections use natural keys (`countries._id = "BD"`, `event_definitions._id = "trial_start"`). Using these as `_id` means **no separate public-ID unique index** anywhere.
- **Timestamps**: `createdAt`, `updatedAt` as BSON `Date` (UTC).
- **Money**: integer **micros** (`Long`). `$12.34 → 12_340_000`. The currency is fixed to USD for internal accounting (stored once in `settings`).
- **Optimistic concurrency**: mutable documents carry `rev: Int`. Every update uses `{_id, rev}` in its filter and `$inc: {rev: 1}`. Zero matched means the API returns `409 Conflict`. This protects the campaign wizard from two editors overwriting each other.
- **Soft delete**: no hard deletes for business entities. Use status `archived` plus `archivedAt`. Hard deletes happen only via retention jobs.
- **Enums** are stored lowercase snake_case (`needs_attention` is a *derived* health flag, not a status; see campaigns).
- **Field-name length**: normal readable names for operational collections. **Short names for high-volume rollups** (`c`, `p`, `cc`, `m.imp`) to save storage and RAM, documented in the schema.
- **Migrations**: `packages/db/migrations/NNNN_name.ts`, run by a migration runner (e.g. `migrate-mongo`) in CI before deploy. Index definitions live in `packages/db/indexes.ts` and are **declarative**: CI fails on drift between declared indexes and the cluster (`listIndexes` diff). Mongoose never creates indexes or collections by itself (§6.13).

### 6.3 Collections overview

| Collection | Kind | Size estimate (yr 1) | Growth | Retention |
|---|---|---|---|---|
| `users` | operational | < 100 | static | forever |
| `sessions` | auth | < 500 live | churn | TTL 12 h idle / 7 d absolute |
| `properties` | operational | 40 → 200 | slow | forever |
| `property_keys` | secrets (hashes) | < 1,000 | slow | forever (revoked kept for audit) |
| `placements` | operational | 100 → 1,000 | slow | forever |
| `creatives` | operational | 500 → 5,000 | ~100/mo | forever (archived) |
| `creative_versions` | append-only | ~5× creatives | ~500/mo | forever |
| `campaigns` | operational | 300 → 3,000 | ~50–200/mo | forever (archived) |
| `campaign_revisions` | append-only | ~3× campaigns | — | forever |
| `countries` | reference | ~250 | static | forever |
| `event_definitions` | reference | < 100 | static | forever |
| `audiences` | operational | < 200 | slow | forever |
| `budgets` | operational | ~30/yr | quarterly | forever |
| `settings` | singleton | 1 | — | forever |
| `audit_log` | append-only | ~50 k/yr | steady | 400 d hot, then Online Archive |
| `campaign_stats` | derived counters | = campaigns | — | forever |
| `delivery_daily` | **rollup** | ~3–10 k docs/day → **~1–3.5 M/yr** | linear | 25 months, then data lake only |
| `supply_daily` | **rollup** | ~0.5–2 k docs/day | linear | 25 months |
| `clicks` | attribution | ~8 M live max | 8 M/mo | **TTL 8 days** |
| `conversions` | attribution/audit | ≤ 1 M/mo | — | **TTL 90 days** (rollups keep counts) |
| `request_samples` | **time-series** diagnostics | 1 % sample ≈ 10 M/mo | — | **TTL 7 days** |
| `rollup_offsets` | pipeline state | = stream partitions (≤ 48) | — | forever |
| `alerts` | operational | < 10 k | churn | TTL 90 d after resolved |

### 6.4 Operational collections: documents and indexes

> Format per collection: **document shape → queries (Q) → indexes (I) with the query each one serves → indexes intentionally NOT created**. The `_id` index exists on every collection and is not repeated.

#### `users`
```js
{ _id: "usr_01J…", email: "priya.menon@company.com", name: "Priya Menon",
  role: "campaign_manager",            // owner | admin | campaign_manager | analyst | developer | read_only
  status: "active",                    // active | invited | disabled
  sso: { provider: "google", subject: "1093…" },
  lastActiveAt: ISODate(), invitedBy: "usr_…", createdAt, updatedAt, rev: 3 }
```
- Q1 login / SSO callback: find by email. Q2 team list: all users (< 100).
- **I1** `{ email: 1 }` **unique**, collation `{ locale: "en", strength: 2 }` → Q1 plus case-insensitive uniqueness.
- Not created: `{role}`, `{status}`. The team list scans < 100 documents; an index would never be chosen and would only cost writes.

#### `sessions` (only if not using stateless JWT; recommended: database sessions so revocation works)
```js
{ _id: "<sha256(sessionToken)>", userId: "usr_…", expiresAt: ISODate(), createdAt, ip, ua }
```
- Q1 validate session: by `_id` (the token hash). Q2 "sign out everywhere": delete by `userId` (rare).
- **I1** `{ expiresAt: 1 }`, `expireAfterSeconds: 0` → TTL cleanup.
- Not created: `{userId}`. Q2 is a rare admin action over < 500 live documents.

#### `properties`
```js
{ _id: "prp_01J…",                     // also the public App ID sent by SDKs
  name: "DRM Sport Android", platform: "android",      // android | ios | web
  identifier: "com.drmsport.live",                     // bundle id / package / domain (lowercase)
  team: "Sports", ownerId: "usr_…", env: "production", status: "active",   // active | paused | pending
  formats: ["banner","interstitial","rewarded_video","native","app_open"],
  countryRule: { mode: "all", countries: [] },          // all | include | exclude (ISO alpha-2)
  tags: ["Flagship","Football"],
  testMode: false,
  sdk: { state: "healthy", version: "6.2.1", lastHeartbeatAt: ISODate() },   // heartbeat throttled to 1 write/min/property
  createdAt, updatedAt, rev }
```
- Q1 by id (detail page, compiler). Q2 list all (≤ 200, table filtered client-side). Q3 "is this bundle id or domain already registered?" (add-property wizard).
- **I1** `{ platform: 1, identifier: 1 }` **unique** → Q3 plus the business rule "one property per platform + identifier".
- Not created: `{team}`, `{status}`, `{tags}`. ≤ 200 documents; the list is served in one query and filtered in the UI. Revisit at > 10 k.

#### `property_keys`
```js
{ _id: "key_01J…", propertyId: "prp_…", label: "Production SDK key", env: "live",   // live | test
  last4: "3f9a",
  hash: "<HMAC-SHA256(secret, pepper)>",   // secret shown ONCE at creation/rotation; never stored in clear
  status: "active",                        // active | grace | revoked
  graceUntil: null,                        // set on rotation: old key keeps working 24 h
  createdAt, createdBy, lastUsedAt, revokedAt, revokedBy }
```
- Q1 credentials tab: keys for a property. Q2 compiler loads all keys with status ∈ {active, grace}.
- **I1** `{ propertyId: 1 }` → Q1.
- Not created: `{status}`. Q2 is a full load of < 1,000 documents once per compile.
- `lastUsedAt` is written by a job from collector metrics (max once per hour per key), **not** per request.

#### `placements`
```js
{ _id: "plc_01J…", propertyId: "prp_…", name: "Home Banner", format: "banner", size: "320x50",
  minAppVersion: "6.0.0", freqCap: { count: 3, per: "day" } | null, refreshSec: 60 | null,
  status: "active", createdAt, updatedAt, rev }
```
- Q1 placements of a property (property tab, wizard step 5, compiler). Q2 global list (≤ 1,000, client-side filtering). Q3 unique name per property.
- **I1** `{ propertyId: 1, name: 1 }` **unique**, collation strength 2 → Q1 (prefix) + Q3. One index, two jobs.
- Not created: `{format}`, `{status}`. These are in-memory filters over a tiny set.

#### `creatives`
```js
{ _id: "crv_01J…", name: "World Cup Highlights 320×50", format: "banner", size: "320x50",
  status: "ready",                       // draft | in_review | ready | rejected | archived
  ownerId: "usr_…", currentVersion: 2,
  assets: [ { kind: "image", url: "https://cdn…/crv_…/v2/320x50.webp", mime: "image/webp",
              bytes: 38211, width: 320, height: 50, durationSec: null, sha256: "…" } ],
  copy: { headline: "…", body: "", cta: "Watch now" },
  destination: { url: null, deepLink: "drmsport://highlights/world-cup",
                 utm: { source: "orbit", medium: "banner", campaign: "wc_highlights" } },
  altText: "…",
  options: { closeDelaySec: null, reward: null, completionEvent: null, safeArea: null, closeButton: null, freqNotice: null },
  review: { state: "approved", by: "usr_…", at: ISODate(), reason: null },
  createdAt, updatedAt, rev }
```
- Q1 library list (≤ 5 k, default "not archived", sorted by `updatedAt` desc; filters by format, status, owner, destination, recency). Q2 by id. Q3 compiler: creatives referenced by live campaigns (by `_id $in`).
- Indexes: **none beyond `_id` in v1.** Q1 over ≤ 5 k documents with projection is ~5 ms. Q3 uses `_id`.
- Search: an **Atlas Search** index on `name` + `copy.headline` (a Lucene index, not a B-tree) for the library's search box.
- **Trigger to add `{ status: 1, updatedAt: -1 }`**: the collection passes ~20 k documents **and** the Atlas Performance Advisor reports Q1 with a scanned/returned ratio > 100.

#### `creative_versions`
```js
{ _id: "crv_01J…:3", creativeId: "crv_01J…", v: 3, snapshot: { /* creative minus review */ }, by: "usr_…", note: "Shortened headline", at: ISODate() }
```
- `_id = "<creativeId>:<v>"` enforces uniqueness for free. Q1 history newest first: `{ creativeId }` sorted by `v` desc.
- **I1** `{ creativeId: 1, v: -1 }` → Q1 (equality + sort, no in-memory sort).

#### `campaigns` (targets embedded: bounded, always read with the campaign)
```js
{ _id: "cmp_01J…", name: "World Cup Highlights Banner", objective: "awareness",
  status: "active",            // draft | scheduled | active | paused | completed | archived
  health: { issues: [ { code: "country_conflict", propertyId: "prp_…", country: "JP" } ], checkedAt: ISODate() },  // derived by compiler/jobs → "Needs attention" in UI
  ownerId: "usr_…", team: "Sports",
  flight: { start: ISODate("2026-09-12T00:00:00+06:00"), end: ISODate(), tz: "Asia/Dhaka" },
  priority: 2,                 // 1 low | 2 normal | 3 high
  creativeIds: ["crv_…"],      // ≤ 20
  targets: [                   // ≤ 50 (validated) — the per-property country rules
    { propertyId: "prp_…", countryRule: { mode: "include", countries: ["BD","IN","PK","NP"] },
      placementIds: ["plc_…"], allocationPct: null, destinationOverride: null } ],
  constraints: { days: ["mon",…], hours: { from: 0, to: 24 }, devices: ["phone","tablet","desktop"],
                 minAppVersion: null, freqCap: { count: 6, per: "day" }, audienceIds: [] },
  budget: { amountMicros: NumberLong("6000000000"), pacing: "even", goal: { type: "impressions", value: 3500000 } },
  live: true,                  // present while not archived → scopes the unique-name index (I4)
  publishedRev: 7, publishedAt: ISODate(), archivedAt: null,
  createdBy: "usr_…", createdAt, updatedAt, rev: 9 }
```
Why embed `targets`: always read and written with the campaign in the wizard, bounded (≤ 50), and needed atomically at publish. A separate collection would require multi-document transactions on every save.

- Q1 list by status tab, newest first (`status ∈ …`, sort `updatedAt` desc, paginated). Q2 compiler/jobs load `status ∈ {scheduled, active}`. Q3 campaigns targeting a property (property page, pause-impact confirm, placement "eligible campaigns" via its property). Q4 campaigns using a creative (creative detail "used in", archive warning, compiler invalidation). Q5 unique name check.
- **I1** `{ status: 1, updatedAt: -1 }` → Q1 (equality + sort) and Q2 (prefix).
- **I2** `{ "targets.propertyId": 1 }` (multikey) → Q3.
- **I3** `{ creativeIds: 1 }` (multikey) → Q4.
- **I4** `{ name: 1 }` **unique**, collation strength 2, `partialFilterExpression: { live: true }` → Q5. `live: true` is set on create and removed with `$unset` on archive, so archived names can be reused. Partial filters can't express `$ne` or `= null`, so a positive marker field is the supported way to scope uniqueness. Only live campaigns occupy index entries.

- Not created:
  - `{ "targets.placementIds": 1 }`: placement eligibility goes through the placement's property (I2) and then filters in memory (≤ a few dozen campaigns per property).
  - `{ ownerId }`, `{ objective }`, `{ team }`: list filters on ≤ 3 k documents, served by I1's status scan.
  - `{ "flight.start" }` / `{ "flight.end" }`: transitions are evaluated in memory by the compiler from Q2.

#### `campaign_revisions`
```js
{ _id: "cmp_01J…:7", campaignId: "cmp_01J…", rev: 7, snapshot: { /* full campaign at publish */ }, publishedBy: "usr_…", at: ISODate(), diff: [ /* JSON-patch summary for the activity feed */ ] }
```
- Written on every publish (audit, rollback, "what changed"). **I1** `{ campaignId: 1, rev: -1 }` → history newest first.

#### `countries`, `event_definitions`, `settings`, `budgets`
```js
countries:          { _id: "BD", name: "Bangladesh", region: "South Asia", enabled: true, isoNumeric: "050" }
event_definitions:  { _id: "trial_start", name: "Premium trial started", source: "server", active: true, createdAt }
settings:           { _id: "global", reportingTz: "Asia/Dhaka", currency: "USD", defaults: { freqCap: { count: 6, per: "day" }, refreshSec: 60 }, tracking: { clicks: true, viewability: true, ipTruncation: true }, autoPauseOnBudget: true, rev }
budgets:            { _id: "Sports:2026-Q4", team: "Sports", quarter: "2026-Q4", amountMicros: NumberLong(30000000000), updatedBy, updatedAt, rev }
```
- All are read in full (tiny) or by natural `_id`. **No secondary indexes.**

#### `audiences` (future-ready)
```js
{ _id: "aud_01J…", name: "Lapsed Premium trials", rule: { event: "trial_start", withinDays: 30, exclude: { event: "purchase", withinDays: 30 } }, status: "preview", estimate: { size: 42000, at: ISODate() }, createdBy, createdAt, updatedAt, rev }
```
- < 200 documents. No secondary indexes. Campaigns reference `audienceIds`. Deleting an audience removes the id from campaigns in the same transaction.

#### `audit_log` (append-only; also feeds "Recent activity")
```js
{ _id: "aud_log_01J…",            // ULID → time-ordered; newest-first = sort by _id desc
  at: ISODate(), actor: { id: "usr_…", name: "Priya Menon" },
  action: "campaign.published",    // dotted verbs: campaign.paused, key.rotated, role.changed, country.disabled…
  target: { type: "campaign", id: "cmp_…", name: "World Cup Highlights Banner" },
  detail: "Frequency cap 4/day → 6/day", diff: { … }, ip: "203.0.113.0/24", requestId: "req_…" }
```
- Q1 global feed newest first (Overview activity, Audit tab), paginated by `_id < cursor`. Q2 activity for one entity (campaign Activity tab, property history). Q3 audit tab filtered by action or actor within a date range (low frequency).
- **I1** `{ "target.id": 1, _id: -1 }` → Q2 (equality + sort).
- Q1 uses the built-in `_id` index (ULIDs are time-ordered).
- Q3: bounded by an `_id` range (time window), then filtered. Rare and admin-only. If it becomes common, use the Atlas Search index rather than more B-trees.
- Not created: `{ at: -1 }` (duplicates `_id` ordering), `{ action: 1 }`, `{ "actor.id": 1 }`.

#### `alerts`
```js
{ _id: "alr_01J…", type: "sdk_heartbeat_missing", severity: "critical", entity: { type: "property", id: "prp_…" },
  status: "open", firstSeenAt, lastSeenAt, resolvedAt: null, dedupeKey: "sdk_heartbeat_missing:prp_…" }
```
- Q1 open alerts (Overview, sidebar badge). Q2 upsert by `dedupeKey` (jobs). Q3 cleanup resolved.
- **I1** `{ dedupeKey: 1 }` **unique, partialFilterExpression `{ status: "open" }`** → Q2. At most one open alert per key, and the same key can recur later.
- **I2** `{ resolvedAt: 1 }` with `expireAfterSeconds: 7776000` (90 d). TTL ignores documents where the field is null, so open alerts are never deleted.
- Q1 (`status: "open"`) is deliberately left without its own index. I1 can't serve it, because a partial index is only eligible when the query also constrains `dedupeKey`. Open alerts number < 100, and the whole collection stays small thanks to the TTL.

### 6.5 Analytics rollups

The modelling correction from the prototype matters here: **requests and no-fills happen before a campaign is chosen**. So **supply** (requests, eligible, no-fill reasons, errors) is stored without campaign or creative dimensions. **Delivery** (impressions, clicks, video, conversions, spend) is stored with them. Fill rate = impressions ÷ requests, joined at property, placement, country or device level.

#### `delivery_daily`
Grain: **reporting day (Asia/Dhaka) × campaign × property × placement × creative × country × device**.
```js
{ _id: "20261019|cmp_01J…|prp_01J…|plc_01J…|crv_01J…|BD|ph",   // deterministic → idempotent upserts by _id
  d:  ISODate("2026-10-19T00:00:00+06:00"),   // reporting-day start (stored as UTC instant)
  c: "cmp_…", p: "prp_…", pl: "plc_…", cr: "crv_…", cc: "BD", dv: "ph",   // ph | tb | dt
  pf: "an", f: "banner",                      // platform (an|io|wb), format: denormalised for filtering without $lookup
  m: { imp: 12873, view: 9811, clk: 81, vs: 0, vc: 0, rw: 0, conv: 4, costMicros: NumberLong(23171400) },
  h: { imp: [24 ints], clk: [24 ints] }       // hour-of-day arrays → heatmap + intraday "today" without an hourly collection
}
```
- **Write path**: one upsert per document per 15 s window, addressed by `_id`, so writes need **no secondary index**. Use an **aggregation-pipeline update**: it creates the document with fixed-size 24-slot arrays on first write and increments in place afterwards, in a single round trip. (A classic `$setOnInsert` + `$inc` can't both touch `h.imp`, because the paths conflict.)

```js
// window deltas for one key: imp=120, clk=1, costMicros=216000, hour=21 (Asia/Dhaka)
{ updateOne: { filter: { _id }, upsert: true, update: [
  { $set: {
      d: { $ifNull: ["$d", day] }, c: { $ifNull: ["$c", c] }, p: { $ifNull: ["$p", p] }, pl: { $ifNull: ["$pl", pl] },
      cr: { $ifNull: ["$cr", cr] }, cc: { $ifNull: ["$cc", cc] }, dv: { $ifNull: ["$dv", dv] }, pf: { $ifNull: ["$pf", pf] }, f: { $ifNull: ["$f", f] },
      "m.imp":        { $add: [{ $ifNull: ["$m.imp", 0] }, 120] },
      "m.clk":        { $add: [{ $ifNull: ["$m.clk", 0] }, 1] },
      "m.costMicros": { $add: [{ $ifNull: ["$m.costMicros", NumberLong(0)] }, NumberLong(216000)] },
      "h.imp": { $let: { vars: { a: { $ifNull: ["$h.imp", ZERO_24] } }, in: {
        $map: { input: { $range: [0, 24] }, as: "i", in: { $add: [{ $arrayElemAt: ["$$a", "$$i"] }, { $cond: [{ $eq: ["$$i", 21] }, 120, 0] }] } } } } }
      // h.clk: same pattern
  } } ] } }
```
The aggregator generates these programmatically. Flush ≤ 1,000 per `bulkWrite({ ordered: false })`.
- Query patterns (all date-bounded, then `$group` on the analytics node):

| # | Query | Example screen |
|---|---|---|
| QA | `{ c: X, d: range }` (+ any other dim filters) | Campaign detail, Analytics `?campaign=`, pacing reconciliation |
| QB | `{ p: X, d: range }` (+ `pl` filter) | Property detail, placement detail, Inventory tile |
| QC | `{ cr: X, d: range }` | Creative detail performance, top creatives filtered |
| QD | `{ d: range }` (+ country, device, format or platform filters) | Overview, Analytics (no entity filter), Reports, Billing |

- **I1** `{ c: 1, d: 1 }` → QA (equality, then range: ESR rule).
- **I2** `{ p: 1, d: 1 }` → QB. Placement queries add `pl` as a residual filter; a placement's rows are a subset of its property's.
- **I3** `{ cr: 1, d: 1 }` → QC.
- **I4** `{ d: 1 }` → QD.
- Not created:
  - `{ cc, d }`, `{ dv, d }`, `{ f, d }`, `{ pf, d }`: low cardinality and only used with a date range. QD reads ≤ 30 days × ~10 k = 300 k small documents at worst. Use **precomputed summaries** (below) instead of more indexes.
  - `{ pl, d }`: covered via I2 + residual filter.
  - Compound "everything" indexes: index intersection isn't used by the planner in practice, and wide compounds bloat RAM.
  - Covered-query indexes including `m.*`: rollup values change constantly, so covering indexes would multiply write cost.
- **Summary for QD at scale**: a nightly `$merge` into `delivery_daily_summary` (grain: day × campaign × country × device × format × platform, without placement and creative) cuts QD's document count ~5–10×. Index `{ d: 1 }` only. Today's partial day is read from `delivery_daily`. Add this when QD p95 > 800 ms.

#### `supply_daily`
Grain: **reporting day × property × placement × country × device**.
```js
{ _id: "20261019|prp_…|plc_…|BD|ph", d, p, pl, cc, dv, pf,
  m: { req: 18123, elig: 16540, fill: 12873, nf: { no_candidates: 3011, capped: 1022, paced: 140, country: 77 }, err: 18, latP50: 9, latP99: 41 },
  h: { req: [24 ints] } }
```
- Queries: by property (QB'), by date for global fill rate (QD').
- **I1** `{ p: 1, d: 1 }`, **I2** `{ d: 1 }`. Nothing else.
- Latency percentiles are written by the aggregator from t-digests per window. Merging percentiles across rows is approximate: show the max across rows, or store digests in the data lake for exact reports.

#### `campaign_stats` (O(1) reads for lists, budgets and pacing)
```js
{ _id: "cmp_…", lifetime: { imp, clk, conv, costMicros }, today: { d: ISODate(), imp, clk, conv, costMicros }, updatedAt }
```
- Updated by the aggregator in the same bulk write as `delivery_daily`. Read by `_id` (campaign list joins in the API by `_id $in`). **No secondary index.**

#### `clicks` (attribution window)
```js
{ _id: "clk_01J…" /* clickId (ULID) carried in the click redirect and the deep link */, c, cr, p, pl, cc, dv, uid, at: ISODate() }
```
- Q1 conversion attribution by `clickId` → `_id`. Q2 expiry.
- **I1** `{ at: 1 }`, `expireAfterSeconds: 691200` (8 days = 7-day window + 1 day of slack).
- ~8 M documents live at most (~1.2 GB with index). If view-through or uid-based attribution is added later, keep it in Redis or the data lake, **not** as a new `{uid}` index here.

#### `conversions` (dedupe + short-term audit)
```js
{ _id: "clk_01J…:trial_start",   // clickId:eventKey → natural dedupe on insert (duplicate key = already counted)
  event: "trial_start", valueMicros: null, c, cr, p, cc, dv, source: "server", at: ISODate() }
```
- Inserting with `_id = clickId:event` makes double counting impossible **without** a unique secondary index.
- **I1** `{ at: 1 }`, `expireAfterSeconds: 7776000` (90 days). Counts live forever in the rollups.

#### `request_samples` (time-series; diagnostics tab)
```js
db.createCollection("request_samples", {
  timeseries: { timeField: "at", metaField: "k", granularity: "seconds" },
  expireAfterSeconds: 604800                     // 7 days, native TTL, no TTL index needed
})
// document: { at: ISODate(), k: { p: "prp_…", pl: "plc_…" }, cc: "BD", result: "200", latencyMs: 12, sdk: "6.2.1" }
```
- Q1 the latest N samples for a property: `{ "k.p": X, at: { $gte: now-24h } }` sorted by `at` desc.
- MongoDB 6.3+ automatically creates a compound index on `metaField` + `timeField`, which serves Q1. **Do not add more.**
- 1 % sampling at 1 B requests/month ≈ 10 M documents/month. Time-series bucketing compresses them roughly 10×.

#### `rollup_offsets`
```js
{ _id: "events.v1:17" /* topic:partition */, offset: NumberLong(…), windowEnd: ISODate(), updatedAt }
```
- Written inside the same transaction as each partition's bulk write. Read by `_id`. No secondary index.

### 6.6 Complete index inventory (the only indexes in the system)

| Collection | Index | Options | Serves |
|---|---|---|---|
| users | `{ email: 1 }` | unique, collation strength 2 | login, invite duplicate check |
| sessions | `{ expiresAt: 1 }` | TTL 0 | session expiry |
| properties | `{ platform: 1, identifier: 1 }` | unique | duplicate registration check |
| property_keys | `{ propertyId: 1 }` | — | credentials tab |
| placements | `{ propertyId: 1, name: 1 }` | unique, collation strength 2 | placements by property, unique name |
| creative_versions | `{ creativeId: 1, v: -1 }` | — | version history |
| campaigns | `{ status: 1, updatedAt: -1 }` | — | list tabs, compiler load |
| campaigns | `{ "targets.propertyId": 1 }` | — | campaigns by property / placement |
| campaigns | `{ creativeIds: 1 }` | — | campaigns using a creative |
| campaigns | `{ name: 1 }` | unique, collation strength 2, partial `{ live: true }` | unique live names |
| campaign_revisions | `{ campaignId: 1, rev: -1 }` | — | publish history |
| audit_log | `{ "target.id": 1, _id: -1 }` | — | per-entity activity |
| alerts | `{ dedupeKey: 1 }` | unique, partial `{ status: "open" }` | alert upsert/dedupe |
| alerts | `{ resolvedAt: 1 }` | TTL 90 d | cleanup |
| delivery_daily | `{ c: 1, d: 1 }` | — | campaign analytics |
| delivery_daily | `{ p: 1, d: 1 }` | — | property/placement analytics |
| delivery_daily | `{ cr: 1, d: 1 }` | — | creative analytics |
| delivery_daily | `{ d: 1 }` | — | global dashboards/reports |
| supply_daily | `{ p: 1, d: 1 }` | — | property fill/diagnostics |
| supply_daily | `{ d: 1 }` | — | global fill rate |
| clicks | `{ at: 1 }` | TTL 8 d | attribution window |
| conversions | `{ at: 1 }` | TTL 90 d | retention |
| creatives | Atlas Search `name`, `copy.headline` | search index | library search |
| request_samples | (automatic meta + time) | time-series | diagnostics |

**22 B-tree indexes + 1 search index.** Each one is tied to a named query above. With Mongoose, these are the *only* `schema.index()` calls in `packages/db`, and no schema field uses `index: true` or `unique: true` (§6.13).

**Index governance**
1. A new index requires an ADR line naming the query and an `explain("executionStats")` before and after. Merge only if `totalDocsExamined / nReturned` improves materially.
2. Monthly: run `$indexStats`. Any index with `accesses.ops == 0` over 30 days (excluding unique and TTL indexes) is a removal candidate.
3. Build indexes with Atlas rolling index builds in production. Never build in the foreground on the primary at peak.
4. Watch Performance Advisor suggestions, but accept them only through rule 1. It doesn't know about write costs or upcoming query changes.

### 6.7 Key query implementations

**Campaign list with stats (Q1 + campaign_stats join), cursor pagination**
```js
db.campaigns.find(
  { status: { $in: ["active", "paused"] }, ...(cursor && { updatedAt: { $lt: cursor.updatedAt } }) },
  { projection: { name: 1, status: 1, objective: 1, ownerId: 1, flight: 1, budget: 1, "targets.propertyId": 1, creativeIds: 1, health: 1, updatedAt: 1 } }
).sort({ updatedAt: -1 }).limit(25)
// then: db.campaign_stats.find({ _id: { $in: ids } })  — 1 round-trip, no $lookup on the hot list
```
Use `$in` on status with a sort on `updatedAt`. MongoDB merges the per-status ranges of I1 (SORT_MERGE), so there's no blocking sort.

The same query in the `campaigns` repo with Mongoose (lean, projected, no `populate`):
```ts
const rows = await Campaign.find(
  { status: { $in: statuses }, ...(cursor && { updatedAt: { $lt: cursor.updatedAt } }) },
  LIST_PROJECTION,
).sort({ updatedAt: -1 }).limit(limit + 1).lean<CampaignListRow[]>()
const stats = await CampaignStats.find({ _id: { $in: rows.map((r) => r._id) } }).lean()
```

**Analytics: views by country for one campaign, last 30 days (QA)**
```js
db.delivery_daily.aggregate([
  { $match: { c: "cmp_…", d: { $gte: ISODate("2026-09-20T00:00:00+06:00"), $lt: ISODate("2026-10-20T00:00:00+06:00") } } },
  { $group: { _id: "$cc", imp: { $sum: "$m.imp" }, clk: { $sum: "$m.clk" }, conv: { $sum: "$m.conv" }, cost: { $sum: "$m.costMicros" } } },
  { $sort: { imp: -1 } }
], { readPreference: "secondary", hint: { c: 1, d: 1 } })
```
With Mongoose this runs on the **analytics connection** (§6.13). `aggregate()` doesn't cast, so the repo builds `$match` with real `Date` objects (from `@orbit/domain` day helpers), never strings:
```ts
DeliveryDailyRO.aggregate<CountryRow>([{ $match: { c: id, d: { $gte: from, $lt: to } } }, GROUP_BY_COUNTRY, { $sort: { imp: -1 } }])
  .option({ hint: { c: 1, d: 1 }, maxTimeMS: 5_000 })
```

**Heatmap (weekday × hour) using the hourly arrays**
```js
[ { $match: { d: range, …filters } },
  { $project: { wd: { $isoDayOfWeek: { date: "$d", timezone: "Asia/Dhaka" } }, h: "$h.imp" } },
  { $unwind: { path: "$h", includeArrayIndex: "hour" } },
  { $group: { _id: { wd: "$wd", hour: "$hour" }, imp: { $sum: "$h" } } } ]
```

**Fill rate by property (supply joined with delivery, both bounded by date)**: run two aggregations in parallel (`supply_daily` by `p`, `delivery_daily` by `p`) and merge in the API. Don't use `$lookup` across rollups; it's slower and harder to cache.

**Publishing a campaign (transaction)**: validate (Zod + domain rules) → `campaigns.updateOne({_id, rev}, {$set: …, $inc: {rev: 1}})` + `campaign_revisions.insertOne` + `audit_log.insertOne`, all in one multi-document transaction with `writeConcern: majority` (Mongoose: `connection.transaction(async (session) => { … })`, passing `{ session }` to every operation). The compiler picks the change up from the change stream.

### 6.8 Validation example (`$jsonSchema`, campaigns, abbreviated)
```js
db.runCommand({ collMod: "campaigns", validationLevel: "strict", validationAction: "error", validator: { $jsonSchema: {
  bsonType: "object",
  required: ["_id","name","objective","status","flight","creativeIds","targets","budget","rev","createdAt","updatedAt"],
  properties: {
    _id: { bsonType: "string", pattern: "^cmp_[0-9A-HJKMNP-TV-Z]{26}$" },
    status: { enum: ["draft","scheduled","active","paused","completed","archived"] },
    priority: { bsonType: "int", minimum: 1, maximum: 3 },
    creativeIds: { bsonType: "array", maxItems: 20, items: { bsonType: "string", pattern: "^crv_" } },
    targets: { bsonType: "array", maxItems: 50, items: { bsonType: "object", required: ["propertyId","countryRule","placementIds"],
      properties: { countryRule: { bsonType: "object", required: ["mode","countries"],
        properties: { mode: { enum: ["all","include","exclude"] }, countries: { bsonType: "array", maxItems: 250, items: { bsonType: "string", pattern: "^[A-Z]{2}$" } } } } } } },
    budget: { bsonType: "object", required: ["amountMicros","pacing"], properties: { amountMicros: { bsonType: "long", minimum: 0 }, pacing: { enum: ["even","asap"] } } },
    rev: { bsonType: "int", minimum: 0 }
  } } } })
```
Business rules that span documents (an include list ⊆ property availability, placements compatible with creatives) are enforced in `packages/domain`, the same code the UI uses. The database enforces shape and bounds.

### 6.9 Transactions: where (and where not)

| Operation | Transaction? | Why |
|---|---|---|
| Publish / edit campaign + revision + audit | **Yes** | Atomic history |
| Rotate key (new key + old key → grace + audit) | **Yes** | Never zero valid keys |
| Delete audience + pull from campaigns + audit | **Yes** | Referential cleanup |
| Rollup bulk write + offset watermark | **Yes** (≤ 1,000 ops) | Exactly-once effect |
| Creative save + version | Yes | History consistency |
| Heartbeat / `lastUsedAt` / stats counters | No | Idempotent counters, high frequency |

Keep transactions **under 1,000 writes and 1 s**. Always retry on `TransientTransactionError`. Mongoose's `connection.transaction()` wraps the driver's `withTransaction`, which does this; keep the callback idempotent because it may run more than once.

### 6.10 Retention and data lifecycle

| Data | Hot (MongoDB) | Cold |
|---|---|---|
| Raw events | — | S3 Parquet 13 months (Glacier after 90 d) |
| `delivery_daily`, `supply_daily` | 25 months (monthly job deletes by `d` range; uses `{d:1}`) | S3 export before delete |
| `audit_log` | 400 days | Atlas Online Archive (forever) |
| `clicks` | 8 days (TTL) | — |
| `conversions` | 90 days (TTL) | Raw in S3 |
| `request_samples` | 7 days (time-series TTL) | — |

### 6.11 Growth path (when, not if)

| Trigger | Action |
|---|---|
| Overview/Reports p95 > 800 ms | Add `delivery_daily_summary` (§6.5) and a 60 s Redis cache keyed by query hash |
| `delivery_daily` > 50 M docs or > 200 GB | **Shard** `delivery_daily` on the ranged key **`{ c: 1, d: 1 }`**, which already exists as I1. Campaign-scoped queries (the majority) target one shard; global date queries scatter-gather, which is acceptable on the analytics path. A hashed `c` key is rejected because it would still scatter date-range queries and lose range locality per campaign. Writes stay spread out because ULID campaign ids are unique per campaign and many campaigns run at once. Schedule balancer windows off-peak |
| Ad-hoc analytics needs (cohorts, uniques, reach and frequency) | Add **ClickHouse** (or BigQuery) on top of the S3 lake; keep MongoDB rollups for the product UI |
| Multi-tenant (selling the platform to others) | Add `orgId` as the **first field of every compound index** and every unique index; shard key prefixed by `orgId` |

### 6.12 Why MongoDB fits, and its limits

- **Fits**: flexible campaign documents with embedded targets (the core aggregate); evolving creative format options; change streams drive the serving index; idempotent `$inc` upserts suit rollups; Atlas operations (PITR, Online Archive, Search) reduce operational load.
- **Limits**: unique-user reach and frequency over arbitrary ranges, and heavy multi-dimensional slicing over raw events, belong in a columnar engine. The design keeps those workloads in the lake, so MongoDB is never asked to do them.

### 6.13 Mongoose implementation rules

Mongoose is used for every MongoDB access outside the ad server. These rules keep it production-grade and keep the index inventory in §6.6 the only truth.

**Connections** (`packages/db/connection.ts`)
- Two connections per service via `mongoose.createConnection()`, never the global default:
  - `primary`: `readPreference: "primary"`, `w: "majority"`. CRUD, transactions, change streams.
  - `analytics`: `readPreference: "secondary"` with tags `[{ nodeType: "ANALYTICS" }, {}]`, `maxStalenessSeconds: 90`. Only the read-only rollup models (`DeliveryDailyRO`, `SupplyDailyRO`) are registered on it.
- `maxPoolSize` per §6.1 (api 50, workers 20), `serverSelectionTimeoutMS: 5000`, `bufferCommands: false`. Requests then fail fast instead of queueing silently while the cluster is unreachable.
- Global settings, set once at boot: `mongoose.set("strictQuery", true)`, `mongoose.set("sanitizeFilter", true)` (wraps `$`-prefixed values in filters in `$eq`, blocking operator injection; operators the code builds itself are marked with `mongoose.trusted()`, e.g. `{ status: trusted({ $in: statuses }) }`), `mongoose.set("autoIndex", false)`, `mongoose.set("autoCreate", false)`.

**Schemas and models** (`packages/db/models/*.ts`)
- One file per collection: the schema, its `schema.index()` calls (exactly those in §6.6), and the model, with the collection name pinned (`{ collection: "delivery_daily" }`) so Mongoose never pluralises.
- Schema options: `_id: { type: String, default: () => newId("cmp") }` (ULID helper from `@orbit/domain`), `versionKey: false` (we use our own `rev`, §6.2), `timestamps: true`, `strict: "throw"` on operational models, `minimize: false` where empty objects matter.
- **No `index: true`, `unique: true` or `sparse: true` on fields.** They silently create indexes. An ESLint rule (`no-restricted-syntax` on those keys inside `new Schema`) enforces it.
- Money fields use the `BigInt` schema type (stored as BSON `long`). The API serialises micros as JSON numbers (safe up to 2^53 micros, about $9 billion).
- Typing: `InferSchemaType` for persisted shape; the API contracts stay the Zod types from `@orbit/domain`. A unit test round-trips domain fixtures through `Model.validate()` so Zod, Mongoose and `$jsonSchema` (§6.8) can't drift apart.
- Validation layers, each with one job: **Zod** at the HTTP edge (business payload), **Mongoose** casting and validation (shape before write), **`$jsonSchema`** in the database (last line of defence for any writer, including scripts).

**Indexes and migrations**
- `0001_init` creates collections explicitly (`createCollection` with validators, the time-series options for `request_samples`, zstd for rollups) and then calls `Model.createIndexes()` per model. The Atlas Search index is created from JSON through the Atlas Admin API or Terraform.
- CI drift check: `Model.diffIndexes()` against the target cluster for every model; any `toDrop` or `toCreate` fails the build. `syncIndexes()` is **never** run automatically in production because it drops undeclared indexes; dropping is a reviewed migration.

**Reads**
- `.lean()` on every read that doesn't call document methods (lists, details for the API, analytics). It's several times faster and allocates far less.
- Always pass a projection. List endpoints use a shared `LIST_PROJECTION` constant per model.
- No `populate()` on list endpoints; batch the related ids into one `$in` query, as in §6.7. `populate` is allowed on single-document detail reads only.
- Every query in a repo has a `maxTimeMS` (admin 2 s, analytics 5 s) and, where §6.4–§6.6 names the index, a test proving it uses it (§11).

**Writes**
- Updates go through `updateOne` / `findOneAndUpdate` with `{ _id, rev }` filters and `$inc: { rev: 1 }`. `runValidators: true` on all update calls. `matchedCount === 0` → `ConflictError` → 409.
- Avoid `doc.save()` on hot or concurrent paths: it rewrites changed paths without the `rev` guard. Use it only for inserts.
- **Rollups and counters** (`rollup-aggregator`, `attribution`) use the native collection under the model, `DeliveryDaily.collection.bulkWrite(ops, { ordered: false, session })`. That skips Mongoose casting and middleware on thousands of ops per flush and supports the aggregation-pipeline upsert from §6.5. These ops are built by tested builders in `packages/db/rollups.ts` and nowhere else.
- Middleware (`pre("save")`, etc.) is not used for business logic (it doesn't run on `updateOne` or `bulkWrite`). Audit entries are written explicitly by services inside the transaction.

**Change streams** (`config-compiler`)
- `Model.watch(pipeline, { fullDocument: "updateLookup" })` on the primary connection, filtered with `$match` on `operationType` and the fields that affect serving. Store the **resume token** in Redis after every compile, and resume from it on restart. If the token is too old (`ChangeStreamHistoryLost`), do a full reload.

**Testing**
- `mongodb-memory-server` in replica-set mode (transactions and change streams need it), running the real migrations, so tests use exactly the production indexes and validators.

---

## 7. API design

### 7.1 Conventions
- REST + JSON under `/v1`, defined with Zod schemas in `packages/domain`. **OpenAPI 3.1 is generated from the Zod schemas** (`zod-openapi`) and served at `/v1/openapi.json` by the Express app. `@orbit/api-client` imports the same Zod contracts directly (monorepo), so `web` gets types without a codegen step, and exposes TanStack Query hooks and key factories.
- Auth: session cookie (HttpOnly, Secure, SameSite=Lax) for the admin UI. Service-to-service calls use mTLS or signed JWT.
- **RBAC on every route** via a policy map (`can(role, action, resource)`), mirroring the permission matrix in Settings → Team.
- **Pagination**: cursor-based (`?cursor=<opaque>&limit=25`). No `skip` beyond trivial sizes.
- **Concurrency**: `If-Match: <rev>` header (or `rev` in the body). Mismatch → `409` with the current document.
- **Idempotency**: `Idempotency-Key` header on POSTs that create resources or trigger publishes. Stored in Redis for 24 h.
- **Errors**: RFC 9457 `application/problem+json` with `code`, `title`, `detail`, `errors[]` (field paths), `requestId`.
- **Rate limits**: admin 600 req/min/user; analytics 60 req/min/user; public SDK endpoints are protected at the load balancer and WAF level.

### 7.2 Endpoints (admin API)

| Resource | Endpoints |
|---|---|
| Auth | `GET /v1/me`, `POST /v1/auth/logout`, OIDC callback |
| Properties | `GET/POST /v1/properties`, `GET/PATCH /v1/properties/:id`, `POST /:id/pause`, `POST /:id/activate`, `GET /:id/keys`, `POST /:id/keys` (returns secret **once**), `POST /:id/keys/:keyId/rotate` (returns new secret once; old key enters a 24 h grace period), `POST /:id/keys/:keyId/revoke`, `POST /:id/test-request`, `GET /:id/diagnostics` |
| Placements | `GET/POST /v1/placements`, `GET/PATCH /v1/placements/:id`, `POST /:id/pause`, `GET /:id/compat?creativeId=` |
| Creatives | `GET/POST /v1/creatives`, `GET/PATCH /v1/creatives/:id`, `POST /:id/submit`, `POST /:id/approve`, `POST /:id/reject` (reason), `POST /:id/archive`, `POST /:id/restore`, `POST /:id/duplicate`, `GET /:id/versions`, `POST /v1/uploads` (pre-signed S3 URL) |
| Campaigns | `GET/POST /v1/campaigns`, `GET/PATCH /v1/campaigns/:id` (draft edits), `POST /:id/validate` (returns blocking errors + warnings, same as the wizard Review step), `POST /:id/publish`, `POST /:id/pause`, `POST /:id/resume`, `POST /:id/archive`, `POST /:id/restore`, `POST /:id/duplicate`, `GET /:id/revisions`, `GET /:id/targeting-matrix` |
| Analytics | `POST /v1/analytics/delivery` (`range`, `compare`, `filters`, `groupBy`, `metrics`) → `{ totals, previous, rows }`; `POST /v1/analytics/supply`; `POST /v1/analytics/heatmap`; `GET /v1/analytics/export.csv?…` (streamed) |
| Ops | `GET /v1/alerts`, `POST /v1/alerts/:id/ack`, `GET /v1/audit`, `GET/PUT /v1/settings`, `GET/PATCH /v1/countries/:code`, `GET/POST/PATCH /v1/events`, `GET/POST/DELETE /v1/audiences`, `GET/PUT /v1/budgets/:team/:quarter`, `GET/POST/PATCH/DELETE /v1/team` (invite, role change, remove) |

### 7.3 Public endpoints (SDK and web)
- `POST /v1/serve` (ad server), `POST /v1/e` (event batch), `GET /i/:token` (pixel), `GET /c/:token` (click redirect → 302), `POST /v1/conversions` (server-to-server, signed with a property live key), `POST /v1/heartbeat`.
- Served from a separate hostname (`ads.` / `t.`) and separate services, with **no cookies** and CORS limited to the registered web property domains.

---

## 8. SDKs and web tag

| Concern | Requirement |
|---|---|
| Packages | Android (Kotlin, `minSdk 23`, AAR on a private Maven repo), iOS (Swift Package, iOS 13+), Web (TypeScript tag < 12 KB gzipped, async, no dependencies) |
| Init | `Orbit.init(appId, environment, testMode)`. Fetches remote config (refresh intervals, kill switch) |
| Ad views | Banner (auto-refresh by placement `refreshSec`; pause when off-screen), Interstitial (close button after `closeDelaySec ≤ 5`), Rewarded (reward callback **only** after the server-confirmed `video_complete`), Native (render-your-own with asset map + required "Ad" label), App Open (cold or warm start, frequency 1/session), Web display / popup / video |
| Tracking | Impression fires on render. **Viewability** (MRC: ≥ 50 % pixels for ≥ 1 s display, 2 s video) fires a separate `viewable` event. Clicks go through the signed redirect. Video quartiles are optional (start + complete required) |
| Reliability | Persistent event queue (SQLite / IndexedDB) with batching (10 s or 20 events), exponential back-off, max 24 h, dedupe by requestId |
| Privacy | No advertising IDs. Install-scoped random `uid`, hashed. Consent API (`Orbit.setConsent`) and honour ATT, GDPR (TCF if needed for EU traffic) and COPPA flags. IP is never sent in the payload |
| Performance | No main-thread blocking. Ad request timeout 1.5 s. Image decode off-thread. Total SDK size < 400 KB (Android) |
| Diagnostics | Test mode shows a "Test ad" badge. Debug overlay via a dev gesture or URL flag. Heartbeat every 60 s (sampled) |
| Versioning | SemVer. Server supports N-2 SDK majors. `sdkVersion` is in every request and visible in diagnostics |
| Kill switch | Remote config `disabled: true` per property or placement, for instant shut-off without an app release |

---

## 9. Security, privacy and compliance

**Identity and access**
- SSO only (Google Workspace or Okta via OIDC). Enforce **MFA** at the identity provider. No local passwords.
- Six roles (Owner, Admin, Campaign Manager, Analyst, Developer, Read-only). Server-side RBAC on every endpoint; the UI only hides what the API forbids.
- Session idle timeout 12 h, absolute 7 days, server-side revocation (`sessions` collection).

**Secrets and keys**
- SDK live and test keys: 32-byte random values with a prefix, shown once, stored as **HMAC-SHA256 with a server pepper** (keys are high-entropy, so a slow hash isn't needed). Rotation includes a 24 h grace period; revocation is immediate.
- Tracking HMAC secrets, the pepper, and database and Redis credentials live in AWS Secrets Manager with KMS. Rotate quarterly, with `kid` versioning.
- No secrets in the repo or images. Pre-commit `gitleaks`; CI secret scanning.

**Application security (OWASP ASVS L2)**
- Validate all input with Zod at the edge of every service. Projections and allow-lists on all MongoDB queries. **Never pass user JSON straight into a filter** (operator injection, e.g. `{"$gt": ""}`). Mongoose `sanitizeFilter` is on globally and `strictQuery` drops unknown filter paths (§6.13). Filters are built from parsed Zod values, never from `req.query` directly.
- Strict CSP (nonce-based), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'` for the admin UI.
- CSRF: SameSite cookies + origin check on state-changing requests.
- Creatives: uploads go to **private** S3 through pre-signed URLs with content-type and size limits. Processing re-encodes images and video (removing payloads and EXIF). Destination URLs must be `https` or a registered deep-link scheme; check them against Google Safe Browsing. HTML / rich media stays disabled until a sandboxed renderer exists.
- WAF (AWS WAF managed rules) on the admin and public hosts; bot control on `/v1/serve` and `/v1/e`.
- Dependency scanning (Dependabot / Renovate + `pnpm audit`); container image scanning (Trivy); SBOM per release.

**Ad fraud and data integrity**
- Signed tracking tokens, dedupe, data-centre IP filtering, per-uid rate thresholds, and anomaly alerts on CTR spikes (> 5σ).
- Test traffic (`test: true`) is excluded from rollups and budgets.

**Privacy (GDPR, Bangladesh PDPA draft, India DPDP Act 2023)**
- Data minimisation: no advertising IDs, no precise location; country only. IP is used transiently for geo and **truncated** (/24 IPv4, /48 IPv6) before anything is stored or logged.
- `uid` is a random install or cookie ID. A deletion request purges it from the lake (partitioned and replayable), clicks and conversions (TTL already short).
- Consent: honour SDK consent flags. With no consent, serve contextual (non-frequency-capped) ads and don't store `uid`.
- Record of processing activities, DPIA, retention table (§6.10), privacy notice update for each app and site.

**Audit**
- Every state change goes to `audit_log` with actor, before/after diff, IP (truncated) and requestId. Atlas database auditing is on for admin actions on the cluster.

---

## 10. Reliability, observability and operations

**Observability stack**: OpenTelemetry SDKs in every service → OTel Collector → Grafana Cloud (Tempo traces, Loki logs, Mimir/Prometheus metrics), or Datadog. Sentry for UI and API errors. Atlas metrics are exported to the same dashboards.

**Golden signals and SLO dashboards**
- Ad server: RPS, p50/p95/p99 latency, **event-loop lag**, GC pause time, heap used, fill rate, no-fill reasons, error rate, serving-index version and age, Redis latency.
- Collector: events/s by type, invalid-token rate, dedupe rate, stream produce latency, consumer lag.
- Aggregator: window lag, bulk-write latency, failed writes, late-event rate, dead-letter queue size.
- MongoDB: op latency, queues, cache dirty/used %, replication lag, connections, slow queries (> 100 ms), index usage.
- Business: impressions/min vs the same time last week, spend vs pacing plan, properties with no heartbeat.

**Alerts (paged)**
- `/v1/serve` p99 > 80 ms for 5 min, or error rate > 1 %.
- Fill rate drop > 30 % vs the 7-day baseline for any property with > 1 k req/min.
- Consumer lag > 2 min (dashboards going stale).
- Serving index older than 10 min (compiler stuck).
- SDK heartbeat missing on a production property > 30 min.
- MongoDB replication lag > 30 s, or primary election.
- Reconciliation mismatch > 0.1 %.

**Runbooks** (in `docs/runbooks/`): ad server latency spike, stale serving index, stream consumer lag, MongoDB failover, Redis failure (degraded mode: serve **without** frequency caps but with a conservative global pacing multiplier), rotating a leaked key, emergency campaign kill (pause via the API, and via the per-placement remote-config kill switch).

**Resilience**
- Ad server degraded modes: Redis down → skip frequency caps, keep pacing via the local token estimate. Index load failure → keep the last good index. Geo database failure → country `ZZ`, which only matches "all countries" campaigns.
- Collector: if the stream is unavailable, buffer to local disk (bounded), return `503` past the threshold, and SDKs retry.
- Multi-AZ everywhere. Second region (Singapore) warm standby for the ad server and collector, with DNS failover. MongoDB stays single-region with PITR; cross-region snapshot copies for DR.
- Load shedding: priority to `/v1/serve` and `/v1/e` over admin and analytics.

**Capacity tests before launch**: k6 at **2× the design peak (10 k rps)** on `/v1/serve` for 30 min, plus a spike from 500 to 10 k rps within 60 s. Collector at 12 k events/s. Aggregator replaying 1 hour of peak traffic.

---

## 11. Testing strategy

| Layer | Tools | What |
|---|---|---|
| Domain unit tests | Vitest | Targeting rules (`finalCountries`, conflicts, compat), validation per format, pacing math, metric formulas. **Property-based tests** (fast-check) for country rules |
| DB integration | Vitest + `mongodb-memory-server` (replica set mode) | Mongoose repositories, transactions, optimistic concurrency, unique and partial indexes, TTL behaviour (simulated), `$jsonSchema` rejections |
| Index tests | Custom script | `explain()` assertions (`Model.find(...).explain("executionStats")`): each named query uses its intended index (`IXSCAN`, no `SORT` stage), every declared index is hit by ≥ 1 test query, and `diffIndexes()` is empty |
| API contract | Vitest + Supertest against the Express app + generated OpenAPI + Schemathesis | Every endpoint, RBAC matrix (role × action), error shapes |
| Ad server | Vitest + golden files; `vitest bench`; autocannon | Decision correctness on fixture indexes (same `@orbit/domain` rules as the UI); benchmark p99 < 2 ms CPU per decision; autocannon smoke at 1.5 k rps per task |
| Pipeline | Testcontainers (Redpanda, MongoDB, Redis) | End-to-end: beacons → rollups; idempotency on replay; late events; dedupe |
| UI | Vitest + Testing Library + MSW for TanStack Query hooks; Playwright (desktop 1440, tablet 834, mobile 390) | The flows from the prototype's `flow.mjs`: create creative → property → placement → campaign (per-property countries) → publish → analytics. Visual regression snapshots; axe accessibility checks |
| Load | k6 | §10 capacity tests in CI nightly on staging (scaled) and before every major release |
| Security | ZAP baseline on staging; quarterly external pentest | |

Quality gates: domain package **≥ 90 % coverage**, services ≥ 75 %; zero high-severity vulnerabilities; Lighthouse accessibility ≥ 95 on admin pages.

---

## 12. Infrastructure, CI/CD and environments

**Cloud**: AWS `ap-south-1` primary (closest to BD, IN and PK), `ap-southeast-1` warm standby for public endpoints. Everything is in **Terraform** (`infra/`), including MongoDB Atlas (the `mongodbatlas` provider: cluster, users and roles, network peering, backups, Online Archive).

| Component | Service |
|---|---|
| Containers | ECS Fargate (simpler) or EKS (if the team knows Kubernetes); autoscaling policies per §4.4 |
| Load balancing | Global Accelerator / Route 53 latency routing → ALB (or NLB for the ad server) |
| CDN | CloudFront for creatives (immutable versioned paths, 1-year cache) and the web tag (5-minute cache, versioned file) |
| Stream | Amazon MSK Serverless or Redpanda Cloud (topic `events.v1`, 24 partitions, RF 3, 7-day retention) |
| Redis | ElastiCache for Redis 7, cluster mode, 3 shards × 1 replica, Multi-AZ |
| Object storage | S3 (creatives private bucket, lake bucket with lifecycle rules) |
| Secrets | AWS Secrets Manager + KMS |
| Admin UI hosting | Vercel (Next.js) **or** containerised on ECS behind CloudFront. Keep the UI stateless; it talks only to `api` |

**Environments**: `dev` (local Docker Compose: Redis, Redpanda, MailHog, an optional MongoDB replica set; or a shared Atlas dev database named `orbit*`; creative uploads on local disk), `preview` (per-PR UI with a staging API), `staging` (production-like, seeded with `packages/domain/demo` data and synthetic traffic), `production`.

**CI/CD (GitHub Actions)**
1. PR: install → typecheck → lint → unit tests → DB integration tests → index drift check → build → Playwright against preview → Trivy scan.
2. Main: build images (tagged with the git SHA), run migrations against staging, deploy to staging, smoke tests, k6 smoke.
3. Release: manual approval → migrations (expand/contract pattern, always backward-compatible) → **canary** (5 % for the ad server and collector, watching SLOs for 15 min) → full rollout. Automatic rollback on SLO burn.

**Feature flags** (e.g. GrowthBook or a simple `settings.flags`) for risky features: optimise-by-CTR rotation, audiences, rich media.

**Cost (indicative, monthly, at design peak)**: MongoDB Atlas M30 + analytics node ≈ $700–900; ElastiCache ≈ $400; MSK Serverless or Redpanda ≈ $400–700; Fargate (ad server, collector, workers, api) ≈ $1,000–1,800; S3, CloudFront and Athena ≈ $200–400; observability ≈ $300–600. **≈ $3–5 k/month** total. Validate with load tests; the ad-server task count (Node throughput per vCPU) is the biggest lever.

---

## 13. Step-by-step build plan with Claude

Each phase lists **goal → steps → what to ask Claude → definition of done (DoD)**. Phases are sequential unless marked parallel. Rough durations assume 2–3 engineers working with Claude Code.

### Phase 0 — Foundations (week 1)
**Goal:** monorepo, tooling, conventions, local stack.
1. Create the `orbit/` monorepo (pnpm + Turborepo). Move `orbit-ads/` to `apps/web` unchanged; the app must still run.
2. Add `packages/config` (tsconfig strict, ESLint, Prettier), `CLAUDE.md` (see §14), `docs/adr/`. Copy `01-claude-design-prompt.md`, this guideline (as `docs/02-production-build-guideline.md`) and `orbit-ads/docs/DATA_MODEL.md` into `docs/`; every prompt below refers to them there.
3. `docker-compose.yml`: Redis 7, Redpanda, MailHog, and an optional MongoDB 8 single-node replica set (profile `local-db`). Creative uploads use a local-disk storage driver in dev (MinIO images are no longer published on Docker Hub) and S3 in production.
4. GitHub Actions skeleton (typecheck, lint, test, build).

> **Ask Claude:** "Set up a pnpm + Turborepo monorepo named `orbit` with apps/web (move the existing Next.js app from ../orbit-ads without changes), packages/config, and a docker-compose with Redis 7, Redpanda and an optional MongoDB 8 single-node replica set. Add a CI workflow running typecheck, lint and test. Follow docs/02-production-build-guideline.md §3.3 and §12."

**DoD:** `pnpm dev` runs the prototype; `docker compose up` gives healthy services; CI is green.

### Phase 1 — Domain package (week 1–2)
**Goal:** one source of truth for business rules, shared by UI, API and compiler.
1. Create `packages/domain`: types (rename to production enums: lowercase snake_case), **Zod schemas** for every entity and API payload, ID helpers (prefixed ULID), money helpers (micros).
2. Port rules from the prototype with tests: `compat`, `placementSizes`, `availSet`, `finalCountries`, `ruleSummary`, `conflictsFor`, `pacing`, creative checks (`creative-checks.ts`), campaign wizard validation (`wizard-state.ts` errors/warnings), `METRICS`.
3. Move the simulator (`genFacts`, seed) to `packages/domain/demo` for seeding dev and staging.

> **Ask Claude:** "Create packages/domain. Port the pure business logic from apps/web/src/lib/sim.ts, lib/analytics.ts, components/creatives/creative-checks.ts and components/campaigns/wizard-state.ts into typed, framework-free modules with Zod schemas per §6.4 of the guideline. Use integer micros for money and prefixed ULIDs for ids. Write Vitest unit tests and fast-check property tests for finalCountries/conflicts. Don't change behaviour; list any bugs you find instead of silently fixing them."

**DoD:** ≥ 90 % coverage; the web app imports rules from `@orbit/domain` with no behaviour change (Playwright flows still pass).

### Phase 2 — Database layer (week 2)
**Goal:** production MongoDB schema exactly as §6.
1. `packages/db`: Mongoose connections (`primary` + `analytics`, pool sizes per service, global settings from §6.13), schemas and models per collection, repositories.
2. `indexes.ts`: declarative definitions of the **22 indexes** in §6.6, applied with `schema.index()` (+ the Atlas Search definition as JSON). `validators.ts`: `$jsonSchema` per collection.
3. Migration runner + `0001_init` (collections, validators, indexes, time-series `request_samples`, TTLs).
4. Index drift check script (CI) and the `explain()` test harness (§11).
5. Seed script from `@orbit/domain/demo` (38 properties, creatives, campaigns, 60 days of rollups mapped to `delivery_daily` / `supply_daily`, splitting requests into supply as §6.5 describes).

> **Ask Claude:** "Implement packages/db per §6 and §6.13 of the guideline with Mongoose 9: one model file per collection (autoIndex and autoCreate off, versionKey false, String ULID _id, BigInt micros, no field-level index/unique options), $jsonSchema validators, exactly the indexes listed in §6.6 (no others) via schema.index(), the request_samples time-series collection, TTLs, a migration runner with 0001_init, an index-drift CI check using Model.diffIndexes(), and explain()-based tests proving each named query in §6.4–§6.7 uses its index without a SORT stage. Use mongodb-memory-server in replica-set mode for tests."

**DoD:** migrations apply cleanly to an empty Atlas dev cluster; drift check passes; all explain tests show IXSCAN.

### Phase 3 — Admin API (weeks 3–5)
**Goal:** every prototype action backed by a real API.
1. Express 5 app with `@orbit/server-kit` (§3.5): Zod `validate()` middleware, OIDC login (Google Workspace, `openid-client`), sessions (Redis store, `sessions` collection for revocation), RBAC policy middleware, problem+json errors, request ids, `pino-http`, OpenTelemetry, graceful shutdown.
2. Resources in order: users/team → countries/settings → properties (+ keys) → placements → creatives (+ uploads, versions, review) → campaigns (+ validate, publish transaction, revisions) → audit/alerts → budgets/events/audiences.
3. OpenAPI generation from the Zod contracts + `@orbit/api-client` (typed fetch wrapper, query-key factories, TanStack Query hooks).

> **Ask Claude (per resource):** "Implement the Campaigns API per §7.2 as an Express module (router → controller → service → repo, §3.5): routes, Zod validation from @orbit/domain via validate(), Mongoose repo with lean reads and rev-guarded updates (§6.13), RBAC (Campaign Manager+ can publish), optimistic concurrency with `rev` → 409, idempotency keys on publish, and the publish transaction (campaign + campaign_revisions + audit_log) from §6.7. Add contract tests for each role in the permission matrix and Supertest integration tests for concurrent edits."

**DoD:** OpenAPI published; RBAC matrix tests pass; Schemathesis has no 5xx.

### Phase 4 — Wire the admin UI to the API (weeks 4–6, parallel with Phase 3)
**Goal:** replace the in-memory Zustand data with server state; keep the UX identical.
1. Add TanStack Query (`QueryClientProvider` in `providers.tsx`, Devtools in development); replace `useStore` data reads with `@orbit/api-client` query hooks and actions with mutations (optimistic updates for pause/resume; invalidate on publish), per §3.4.
2. Keep Zustand only for UI state (sidebar, dirty flag, wizard draft, column visibility; the screen-state preview is removed in production).
3. Switch list tables to TanStack Table server-side mode (cursor pagination, server sorting and filtering); forms to React Hook Form + `zodResolver` with the shared Zod schemas.
4. Analytics/Overview/Reports call `/v1/analytics/*` with the same shapes as `lib/analytics.ts`; URL filters become query keys.
5. Real uploads (pre-signed S3), real SDK snippets with real ids, real one-time secrets.

> **Ask Claude:** "Migrate apps/web from the in-memory store to the API using TanStack Query and @orbit/api-client, one route group at a time, starting with Properties. Preserve every existing UI behaviour, loading/empty/error state and Playwright flow. Show me the diff for one route group before continuing."

**DoD:** all prototype flows work against staging; no imports of the demo seed in `apps/web`.

### Phase 5 — Serving: compiler + ad server (weeks 5–8)
1. `config-compiler`: change streams → compile serving index (§4.3) → Redis versioned blob + pub/sub; leader election (Redis lock).
2. `ad-server` (Express, §3.5 and §4.4): request auth, GeoIP, decision algorithm (§4.2), Redis frequency caps and pacing, signed tracking URLs, supply events, kill switch, graceful degradation.
3. Golden-file tests from fixture indexes; benchmarks; k6 load test at 10 k rps.

> **Ask Claude:** "Write the Express ad server per §4 of the guideline. Start with the decision function as a pure, framework-free module in packages/domain/serving with table-driven Vitest tests covering countries (include/exclude/all, conflicts), schedule in the campaign time zone, devices, min app version, frequency caps and pacing. Then add the Express layer (no Mongoose, minimal middleware), ioredis auto-pipelining, maxmind geo, signed tracking tokens and the event-loop-lag metric. Target < 2 ms CPU per decision in vitest bench and report rps per vCPU with autocannon."

**DoD:** p99 < 50 ms at 5 k rps on staging; the ad server and the admin UI preview import the same `@orbit/domain/serving` decision code, verified on 10 k randomised fixtures.

### Phase 6 — Events, rollups, attribution (weeks 7–10)
1. Collector (§5.2) with HMAC verification, dedupe, enrichment and durable produce.
2. Rollup aggregator (§5.3) with pipeline-update upserts, transactional offsets, `campaign_stats`, Redis spend.
3. Raw sink to S3 Parquet; Athena tables.
4. Attribution service: click redirect → `clicks`; conversion API → `conversions` (`_id` dedupe) → rollup increments.
5. Reconciliation job (§5.5).

> **Ask Claude:** "Implement the rollup aggregator per §5.3, §6.5 and §6.13: consume events.v1, aggregate in 15 s windows, write delivery_daily/supply_daily with the aggregation-pipeline upsert shown in §6.5 through Model.collection.bulkWrite inside connection.transaction(), commit offsets transactionally via rollup_offsets, and handle late events. Include a Testcontainers test that replays the same batch twice and proves counts don't double."

**DoD:** replay test passes; reconciliation within 0.1 % on staging synthetic traffic; dashboards ≤ 2 min fresh.

### Phase 7 — SDKs (weeks 6–12, parallel)
1. Web tag first (fastest feedback), then Android, then iOS.
2. Sample apps per platform; integration docs generated into the property's Integration tab.
3. Viewability, offline queue, consent, kill switch, test mode.

> **Ask Claude:** "Build the web tag per §8: < 12 KB gzipped, async loader, placement auto-discovery via data-orbit-placement, request → render → impression/viewable/click tracking with a batched persistent queue and consent API. Include a demo page and Playwright tests for viewability and offline retry."

**DoD:** pilot property (e.g. YahaChha Web) serving in production test mode; heartbeat and diagnostics visible in the admin.

### Phase 8 — Jobs, alerts and operations (weeks 9–11)
- Status transitions, health issues (`campaigns.health`), alert lifecycle (`alerts`), budget auto-pause, nightly reconciliation, retention jobs, `$indexStats` monthly report.
- Dashboards, alerts and runbooks per §10.

### Phase 9 — Hardening (weeks 11–13)
- Security review (OWASP ASVS L2 checklist), ZAP scan, external pentest, privacy DPIA.
- Load and chaos tests (kill a Redis shard, MongoDB failover during peak, stream broker restart).
- Accessibility audit (axe + manual keyboard and screen-reader pass) on admin pages.
- DR drill: restore MongoDB PITR to a new cluster and replay one day from the lake.

### Phase 10 — Launch and rollout (weeks 13–15)
1. Pilot: one web property + one Android app, test mode, then 5 % of placements.
2. Ramp by property group (Sports → Utilities → Lifestyle → Media), watching fill, latency and app crash rates (SDK).
3. Turn off any legacy ad code per property only after 7 stable days.
4. Post-launch: weekly KPI review, index usage review, cost review.

---

## 14. Working effectively with Claude

### 14.1 `CLAUDE.md` (put at the repo root)
```md
# Orbit Ads — instructions for Claude
- Read docs/02-production-build-guideline.md before architectural changes; follow its ADRs. Propose an ADR before deviating.
- Business rules live ONLY in packages/domain. Never duplicate targeting/validation logic in apps.
- MongoDB: only the indexes in packages/db/indexes.ts. Adding one requires: the named query, explain() before/after, and an ADR line.
- Stack is fixed: web = Next.js + shadcn/ui + TanStack Query + TanStack Table + Zustand + Zod; backend = Express 5 + Zod + Mongoose 9. No new frameworks without an ADR.
- Server data lives in TanStack Query only; Zustand holds UI state only.
- Express modules: router → controller → service → repo. Only repos import Mongoose models. Validate every input with the shared Zod schemas.
- Mongoose: autoIndex/autoCreate off, .lean() + projection on reads, rev-guarded updateOne, no field-level index/unique options, native bulkWrite only in packages/db/rollups.ts.
- Never query MongoDB from the ad-server request path (the ad-server has no Mongoose dependency). Never write raw events to MongoDB.
- Money = integer micros (Long). IDs = prefixed ULIDs. Dates = UTC; reporting day = Asia/Dhaka.
- Every API change: Zod schema → OpenAPI regen → contract tests → client regen.
- Tests are required: unit for domain, integration for db/api, Playwright for UI flows (1440/834/390).
- Small PRs (< 400 lines). Explain trade-offs in the PR description.
- Next.js in apps/web is v16: read node_modules/next/dist/docs before using new APIs.
```

### 14.2 How to prompt for best results
1. **Give the exact section** of this guideline and the files to read ("Implement §6.5 delivery_daily writes; read packages/db/indexes.ts and §5.3").
2. **Ask for a plan first** on anything multi-file ("Propose the file list and interfaces; wait for my OK").
3. **Constrain scope**: "Don't touch apps/web", "no new dependencies without asking", "no new indexes".
4. **Demand verification**: "Run typecheck, unit tests and the explain() tests; paste the results", "Run the Playwright flows at 1440/834/390".
5. **Use parallel agents** for independent areas (e.g. Web tag, Android SDK and the reconciliation job), each with its own folder ownership, as the prototype was built.
6. **Review checklist** for every Claude PR: matches the guideline? tests meaningful? no secrets? no unbounded queries? indexes unchanged (or ADR)? error states handled? accessibility kept?

### 14.3 Reusable prompt templates
- *Feature:* "Implement <feature> per §<n>. Inputs: <files>. Constraints: <list>. Output: code + tests + a short note on trade-offs. Verify by running <commands>."
- *Bug:* "Reproduce <bug> with a failing test first, then fix the root cause, then show the test passing. Don't change unrelated code."
- *Performance:* "Profile <query/endpoint> with explain('executionStats') / `node --cpu-prof` / clinic.js, report the bottleneck with numbers, propose ≤ 2 options with trade-offs, implement the chosen one."
- *Review:* "Review this PR against docs/02-production-build-guideline.md §6 and §9. List violations with file:line and severity."

---

## 15. Launch checklist

**Product**
- [ ] Every prototype screen is backed by the API; no demo data in production
- [ ] Per-property country rules verified end-to-end (wizard → compiler → ad server → analytics by country)
- [ ] Creative review workflow enforced server-side (only `ready` creatives compile)
- [ ] One-time secret display + rotation grace + revocation tested
- [ ] Budget auto-pause and pacing verified against reconciliation

**Data**
- [ ] Exactly the §6.6 indexes in production (drift check green); all validators `error` mode
- [ ] TTLs active (`sessions`, `clicks`, `conversions`, `alerts`, `request_samples`)
- [ ] PITR enabled; restore drill done; Online Archive rule for `audit_log`
- [ ] Reconciliation raw ↔ rollups within 0.1 % for 7 consecutive days

**Reliability**
- [ ] k6: 10 k rps on `/v1/serve` p99 < 50 ms; spike test passed
- [ ] Alerts wired to on-call; runbooks reviewed; degraded modes tested (Redis down, compiler down)
- [ ] Multi-AZ; standby region DNS failover rehearsed

**Security and privacy**
- [ ] SSO + MFA enforced; RBAC tests green; pentest findings resolved
- [ ] IP truncation verified in logs and lake; consent flags honoured by the SDKs
- [ ] Secrets in Secrets Manager; rotation documented; gitleaks clean

**SDKs**
- [ ] Crash-free sessions unchanged vs control (Android vitals, Xcode Organizer)
- [ ] App size impact within budget; kill switch tested in production

---

## 16. Appendix

### 16.1 Decisions log (open for review)
| Topic | Decision | Revisit when |
|---|---|---|
| Ad server runtime | Node 22 + Express 5 (shared TypeScript decision code) | Benchmark misses p99 < 50 ms at a sensible task count → swap the HTTP layer to `uWebSockets.js`; only if still short, consider Go |
| ODM | Mongoose 9 (native driver only for rollup `bulkWrite`) | Profiling shows Mongoose overhead on a specific path → drop to `Model.collection` for that path only |
| Stream | MSK Serverless or Redpanda Cloud | Volume > 5 B events/month |
| Analytics store | MongoDB rollups + S3 lake | Need for uniques, cohorts or sub-hour slicing → add ClickHouse |
| Reporting time zone | Asia/Dhaka for daily buckets | Teams in other time zones need their own day boundaries |
| Audiences | Stored, not enforced in v1 | Event pipeline stable for 60 days |

### 16.2 Glossary
**Property**: an owned app or website. **Placement**: a named ad slot in a property. **Creative**: a reusable ad asset. **Target**: a campaign's rule for one property (countries + placements). **Request**: an ad call. **Impression (view)**: a rendered ad. **Viewable**: an MRC-viewable impression. **Fill rate**: impressions ÷ requests. **eCPM**: internal cost per 1,000 impressions. **Pacing**: spending the budget evenly over the flight. **Serving index**: the compiled, in-memory set of eligible campaigns per placement.

### 16.3 Open questions for the business
1. Exact monthly traffic split per property, and the live-event calendar (to tune pre-warming).
2. Whether any EU or UK traffic needs TCF consent strings (affects SDK scope).
3. The internal CPM table per format (drives spend and budgets), and who approves changes.
4. Conversion events: which come from the server (subscriptions, purchases), which from SDKs.
5. Data retention requirements from legal (defaults are in §6.10).
6. Whether third-party demand will ever be added (it would change the architecture: auction, bidder integrations, billing).

---

*Prototype reference:* `orbit-ads/` (Next.js 16, Tailwind 4, shadcn/ui, TanStack Table, Zustand; TanStack Query, Zod and the Express/Mongoose backend are added from Phase 1 onwards). Run with `cd orbit-ads && npm run dev`. *Data model:* `orbit-ads/docs/DATA_MODEL.md`.




