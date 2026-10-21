# Orbit Ads

A clickable prototype of an internal ad management platform for owned mobile apps and websites: reusable creatives, apps and websites with placements, campaigns with **country targeting per property**, and delivery reporting.

All delivery and analytics data is **simulated** in the browser. Real serving needs an ad server, platform SDKs and an event pipeline.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4 + shadcn/ui (Radix primitives, Lucide icons, Geist font)
- TanStack Table v8 for every data table (sorting, search, faceted filters, column visibility, pagination, mobile cards)
- Recharts via shadcn charts
- Zustand for in-memory app state (seeded, deterministic)
- next-themes for light and dark mode

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

Production build: `npm run build && npm start`.

## Where things live

```
src/
  app/(app)/              routes: overview, campaigns, creatives, properties, placements,
                          reports, audiences, billing, settings
  components/
    app-sidebar.tsx       collapsible sidebar (full on desktop, icon rail on tablet, sheet on mobile)
    site-header.tsx       breadcrumbs, ⌘K search, theme toggle, account menu
    data-table.tsx        shared TanStack table
    domain/               targeting matrix + country rule editor, ad preview, placement dialog, KPI and charts
    ui/                   shadcn components
  lib/
    types.ts              domain model
    seed.ts               22 apps, 16 websites, 30 placements, 15 creatives, 11 campaigns, team, events
    sim.ts                simulation engine (60 days of facts), formatting, targeting rules, alerts, pacing
    store.ts              Zustand store and actions (publish, pause, rotate keys, invite, …)
```

## Prototype controls

From the account menu (top right):

- **Preview screen state** switches list pages between normal, loading, empty and error.
- **Reset demo data** restores the seed.

State lives in memory, so a full page reload also resets it.

## Key flow

Create a creative → register an app or website → add a placement → new campaign → select properties → set countries **per property** → review → publish → check delivery on the campaign page and in Reports.

On **New campaign**, **Load example** fills in a banner running on three apps, each with different countries.
