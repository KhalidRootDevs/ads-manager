# Orbit Ads data model

This prototype runs entirely in the browser, but its data is shaped like the production system it stands in for. Every screen reads the same entities and the same delivery fact table. Turning the prototype into a real ads manager is mostly a matter of moving `src/lib/store.ts` and `src/lib/analytics.ts` behind an API.

## 1. Entities (operational data)

| Entity | Prototype type | Key relationships | Production table |
|---|---|---|---|
| Property (app or website) | `Property` | has many Placements; has API keys; has country availability defaults | `properties`, `property_keys`, `property_country_rules` |
| Placement | `Placement` | belongs to Property; accepts one format + size | `placements` |
| Creative | `Creative` | reusable; many-to-many with Campaigns; has versions | `creatives`, `creative_versions`, `creative_assets` |
| Campaign | `Campaign` | many Creatives; many Targets | `campaigns`, `campaign_creatives` |
| Target | `Target` | Campaign × Property: country rule (all / include / exclude + list) and selected Placements | `campaign_targets`, `campaign_target_countries`, `campaign_target_placements` |
| Country | `Country` | platform-wide enable/disable; region | `countries` |
| Member / Role | `Member` | role-based permissions | `users`, `memberships` |
| Conversion event | `TrackedEvent` | sent by SDK, web tag or server | `event_definitions` |
| Audience | `Audience` | rule over events (future) | `audiences` |
| Activity / Audit | `Activity`, `AuditEntry` | append-only | `audit_log` |
| Team budget | `budgets` | per team per quarter | `budgets` |

```
Property 1──* Placement
Property 1──* Target *──1 Campaign *──* Creative
Target   *──* Placement          (only placements whose format/size match a creative: compat())
Target   ──  country rule        (evaluated against Property availability and Country.enabled)
```

**Effective countries** for a target = `property availability ∩ enabled countries`, then the campaign rule on top (`finalCountries()` in `src/lib/sim.ts`). A country named in an *Include* rule but outside the property defaults is a **conflict**. Conflicts are flagged on the Overview, the campaign page and the wizard, and that country never serves.

## 2. Delivery fact table

All analytics come from one fact table, a **daily rollup** of ad-server and SDK events.

**Grain:** `day × campaign × property × placement × creative × country × device`

| Column | Prototype field (`Fact`) | Notes |
|---|---|---|
| date | `d` (day index; 59 = today) | `DATE` in production, in the reporting timezone |
| campaign_id | `c` | FK campaigns |
| property_id | `p` | FK properties |
| placement_id | `pl` | FK placements |
| creative_id | `cr` | FK creatives |
| country | `cc` | ISO 3166-1 alpha-2, resolved from IP at request time |
| platform | `t` | Android / iOS / Web, denormalised from property for fast filtering |
| format | `f` | denormalised from creative |
| device | `dv` | Phone / Tablet / Desktop, respecting campaign device targeting |
| requests | `req` | ad calls received |
| eligible | `elig` | requests matching ≥ 1 live campaign |
| impressions | `imp` | rendered and counted by the impression beacon ("views") |
| clicks | `clk` | click-tracker hits |
| video_starts / video_completions | `vs` / `vc` | video formats only |
| conversions | `conv` | attributed to a click within 7 days |
| cost | `cost` | internal spend allocation (internal CPM × impressions) |
| errors | `err` | timeouts, invalid keys, SDK errors |

Suggested production storage: a columnar store (ClickHouse, BigQuery or Postgres + Timescale) partitioned by date, with an **hourly** rollup alongside the daily one. The prototype models hour-of-day from daily totals (`HOUR_PROFILE` in `src/lib/analytics.ts`). That's clearly labelled in the UI, and an hourly table replaces it.

## 3. Metrics (derived, never stored)

| Metric | Formula |
|---|---|
| CTR | clicks ÷ impressions |
| Fill rate | impressions ÷ requests |
| eCPM | cost ÷ impressions × 1000 |
| Completion rate | video_completions ÷ video_starts |
| Conversion rate | conversions ÷ clicks |
| Cost per conversion | cost ÷ conversions |
| Pacing | (cost ÷ budget) − (days elapsed ÷ flight days) |

The canonical definitions live in `METRICS` (`src/lib/analytics.ts`) and are shown as tooltips throughout the UI.

## 4. Query API

Dashboards call the query layer in `src/lib/analytics.ts`:

```ts
select(facts, { days: 30 }, { campaign: ["c1"], country: ["BD", "IN"] }, lookup)  // filtered rows
groupBy(rows, "country", lookup)                                                   // ranked breakdown
daily(rows, { days: 30 })                                                          // zero-filled series
heatmap(rows)                                                                      // weekday × hour
```

Production equivalent:

```http
POST /v1/analytics/delivery
{
  "range":   { "days": 30 },
  "compare": "previous_period",
  "filters": { "campaign": ["c1"], "country": ["BD", "IN"], "device": ["Phone"] },
  "groupBy": ["country"],
  "metrics": ["imp", "clk", "ctr", "conv", "cost"]
}
→ { "totals": {...}, "previous": {...}, "rows": [{ "key": "BD", "label": "Bangladesh", "imp": 671000, ... }] }
```

Supported dimensions: `day, campaign, property, placement, creative, country, region, format, platform, device`.
Filters use the same keys. The Analytics page stores them in the URL (`/analytics?days=14&campaign=c1&country=BD`), so every view can be shared.

## 5. Event pipeline (what produces the facts)

```
SDK / web tag ──► ad request ──► decision API (/v1/serve) ──► ad response
       │                                                         │
       └── impression beacon, click redirect, video events, heartbeat
                                   │
                          event stream (Kafka / PubSub)
                                   │
                 hourly + daily rollups ──► delivery fact tables ──► /v1/analytics/*
                                   │
                     conversions (SDK / server events, 7-day click attribution)
```

## 6. What is simulated in the prototype

- Facts are generated deterministically from campaign settings (`genFacts` in `src/lib/sim.ts`). Volume scales with property size, country rank and device mix (`DEVICE_MIX`).
- Publishing a campaign simulates its first hours of delivery so the analytics flow can be shown end to end.
- Hour-of-day is modelled (see §2).
- All state is in memory (Zustand). A full reload restores the seed.
