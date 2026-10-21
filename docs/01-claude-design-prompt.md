# Claude Design Prompt — Multi-App Advertising Platform

Act as a senior product designer and SaaS UX architect. Design a high-fidelity, fully responsive web application prototype for an internal advertising management platform inspired by the workflows of Google Ads and AdMob. This is a proprietary platform for managing ads across 20+ mobile apps and 15+ websites owned by one company. Do not copy Google's branding or exact UI. Create a distinctive, production-minded product named **Orbit Ads** (working name).

## Product goal

The platform lets an internal marketing/operator team:
1. Create reusable ad creatives as independent assets.
2. Register and manage mobile apps and websites.
3. Build campaigns that reuse one or more creatives.
4. Select which apps/websites each campaign targets.
5. Configure country-level availability per app/site, with optional platform, placement, device, schedule, and audience targeting.
6. Track delivery and performance across all properties in one dashboard.

The prototype should communicate a real ad operations system, not a generic analytics dashboard. Use realistic sample data and complete user flows. Make all primary interactions clickable and use coherent mock data.

## Design direction

- Modern, premium B2B SaaS dashboard; clean and information-dense without feeling crowded.
- Responsive desktop, tablet, and mobile layouts.
- Light theme by default, with an optional dark theme if practical.
- Neutral surfaces, restrained indigo/blue accent, clear semantic status colors, accessible contrast.
- Consistent spacing, typography, tables, forms, filter bars, empty states, loading states, confirmation dialogs, toasts, and validation.
- Use a left sidebar on desktop, collapsible navigation on smaller screens, and a compact mobile navigation pattern.
- Avoid excessive animation, decorative gradients, oversized hero sections, and unnecessary charts.
- Use reusable components and a consistent design system.
- Use realistic labels and data. Do not use lorem ipsum.

## Core navigation

1. Overview
2. Campaigns
3. Ad Creatives
4. Apps & Websites
5. Placements
6. Reports
7. Audiences (future-ready / optional)
8. Billing & Budgets (internal budget tracking; not an ad-network billing clone)
9. Settings
   - Team & Roles
   - SDK / Integration
   - Countries & Regions
   - Events / Conversion Tracking
   - Audit Log

## Required screens and flows

### A. Overview dashboard
- Date range selector and filters for platform, app/site, country, and campaign.
- KPI cards: Impressions, Clicks, CTR, Spend/Internal Budget, eCPM, Fill Rate, Conversions.
- Time-series chart with metric selector.
- Performance by campaign, app/site, country, ad format, and platform.
- Delivery alerts: campaign not delivering, creative rejected/paused, country targeting conflict, SDK heartbeat missing.
- Recent activity feed.
- Make clear that metrics are demo data in the prototype.

### B. Ad Creatives library
- Table/grid toggle, search, filters by format, status, destination, owner, and updated date.
- Create-creative wizard with steps:
  1. Choose format: Banner, Interstitial, Rewarded Video, Native, App Open, Web Popup/Modal, Web Display, Video, HTML/Rich Media (future-ready).
  2. Upload/select assets and enter creative details.
  3. Preview for mobile and desktop where relevant.
  4. Add click-through URL / deep link, optional tracking parameters, alt text, and CTA.
  5. Validate and save as Draft or Ready.
- Creative details page with preview, dimensions, file details, status, version history, associated campaigns, performance summary.
- Format-specific validation:
  - Banner: aspect ratio/dimensions, image, destination.
  - Interstitial: full-screen image or video, close behavior preview.
  - Rewarded video: video preview, reward label and completion event.
  - Native: icon/image, title, body, CTA.
  - App open: portrait/screen-safe preview.
  - Web popup: modal preview, close button, frequency-cap notice.
- Clearly show creative status: Draft, Ready, In Review, Rejected, Archived.
- Show safe placeholder asset previews if no actual uploads are available.

### C. Apps & Websites inventory
- Manage properties with type (Android, iOS, Web), name, bundle ID/package name or domain, environment, owner/team, status, SDK/integration state.
- Detail page per app/site with:
  - Overview and integration health.
  - Placement inventory.
  - Allowed ad formats.
  - Country availability defaults.
  - SDK/API credentials section with masked values and rotate/revoke actions.
  - Test mode and sample integration instructions.
  - Recent requests and diagnostics.
- Add property wizard.
- Include 20+ example mobile apps and 15+ websites in seeded data, but keep the visible list manageable with pagination.

### D. Placements
- Create placements per app/site: e.g. Home Banner, Match Detail Interstitial, Article Inline, App Open, Rewarded Unlock.
- Placement ID, property, platform, supported format, dimensions, minimum app version, frequency cap, refresh interval (where applicable), status.
- Placement detail shows which campaigns are eligible and recent delivery.
- Warn if a creative format is incompatible with a placement.

### E. Campaigns
- Campaign list with search, filters, status, owner, platform, dates, objective, delivery, and budget.
- Statuses: Draft, Scheduled, Active, Paused, Completed, Archived, Needs Attention.
- Campaign creation wizard:
  1. Basics: name, objective (Awareness, Traffic, Engagement, Conversion), start/end dates, timezone, priority.
  2. Select reusable creative(s) from the library.
  3. Select apps and websites. Support multi-select, search, platform filters, tags, and grouped selection.
  4. Configure country targeting **for each selected property separately**. This is essential. Each app/site row should expand into country rules with Include/Exclude country selection, all-countries option, and an explicit preview of the final targeting matrix. Do not assume one global country list applies to every property.
  5. Select compatible placements and formats for each property.
  6. Optional schedule, device/platform constraints, frequency caps, audience segments, and deep-link/destination overrides.
  7. Budget and delivery: internal budget, impression/click goals, priority, pacing (even / ASAP), and optional per-property allocation.
  8. Review: show a complete campaign summary and validation warnings before publishing.
- Campaign detail page:
  - Summary, creatives, properties, per-property country targeting matrix, placements, schedule, budget, delivery status, performance, activity log.
  - Pause/resume, duplicate, edit, archive, and view report actions.
- Allow a campaign to use multiple creatives and allow a creative to be reused by multiple campaigns.
- Include a campaign setup example: one banner creative used on three apps, each with different country targeting.

### F. Reports & analytics
- Date range and filters for campaign, creative, property, platform, country, placement, format.
- Metrics: requests, eligible requests, impressions, clicks, CTR, video starts/completions, completion rate, conversions, eCPM, fill rate, errors.
- Breakdown tables and charts by day, country, app/site, creative, placement, and format.
- CSV export action (mock behavior acceptable).
- Explain metric definitions via tooltips.
- Clearly distinguish ad requests from served impressions.

### G. Settings and operational controls
- Roles: Owner, Admin, Campaign Manager, Analyst, Developer, Read-only.
- Team member list and invite flow.
- SDK / Integration: app keys, endpoint, sample snippets, environment selector, test events, last heartbeat.
- Country/region management with searchable country list.
- Audit log for publishing, pausing, targeting edits, credential rotation, and role changes.
- Global settings for default frequency caps and tracking.
- Safety: show confirmation for destructive actions and credential rotation; mask secrets; never show full secret after creation.

## Critical UX requirements

- Build responsive layouts for 1440px desktop, tablet, and 390px mobile.
- Every primary button must have a meaningful prototype interaction. No dead-end buttons.
- Include breadcrumbs, page titles, helpful empty states, form validation, save/cancel patterns, and unsaved-change warnings.
- Use accessible labels, keyboard-friendly controls, clear focus states, and sufficient contrast.
- For tables on mobile, use responsive cards or controlled horizontal scrolling rather than crushing columns.
- Provide loading, error, empty, and success states for key screens.
- Use realistic seeded sample records, e.g. campaigns “World Cup Highlights Banner”, “Premium Trial Interstitial”, “Summer Web Retargeting”; properties such as “DRM Sport Android”, “YahaChha Web”, “Converter iOS”.
- The prototype is an internal first-party ad management platform. Do not imply it already has the reach, auction ecosystem, external advertiser marketplace, or monetization network of Google Ads/AdMob.
- Include a visible note in the prototype that delivery/analytics are simulated and require a backend, SDKs, and event pipeline to become real.

## Deliverables

Produce:
1. A complete clickable prototype with the major screens and realistic navigation.
2. Reusable design components and consistent visual language.
3. A clear campaign creation flow emphasizing per-property country targeting.
4. Mobile/tablet responsive behavior.
5. A short implementation handoff describing screen hierarchy, key components, states, and assumptions.

Prioritize the end-to-end workflow: **create creative → register property/placement → create campaign → select properties → configure countries per property → validate → publish → inspect delivery/reporting**.
