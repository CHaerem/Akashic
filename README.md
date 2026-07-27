# Akashic

**Akashic** turns a family trip into something you can hold onto: routes and photos pinned to an interactive 3D globe, organized day by day. Built for treks first, but a journey needs no route at all.

![Akashic Globe View](public/hero-images/akashic-hero.png)

Akashic is **iOS-first**: the native app under [`apple/`](apple/) is the primary
experience and the only place journeys are created or edited. This repo's web app
is a **read-only showcase** — viewing, plus day comments and caption edits; every
other write is native-only. Data lives in Apple **CloudKit** — the family's
private database, synced by the app, shared with family via CKShare, plus a
world-readable public mirror for journeys the owner publishes.

## Features

- **Interactive 3D Globe** — journey routes on a rotating globe with satellite imagery and terrain
- **Create a journey on iPhone** — from a GPX file, from photo GPS, drawn by hand on the map, or with no route at all
- **Immersive Photo Lightbox** — full-screen photo viewing with swipe navigation
- **Day-by-Day Journey** — photos automatically organized by date, weather, fun facts and points of interest per day
- **Detailed Statistics** — elevation profiles, daily distances, and journey metrics
- **Family Sharing** — journeys shared via iCloud (CKShare); comments and caption edits from the web
- **Public Showcase** — journeys the owner publishes are viewable by anyone, no sign-in; thumbnails only, never full-resolution originals
- **Exit Door Built In** — any journey exports from the iOS app as GPX + JSON + original photos

## Featured Journeys

1. **Kilimanjaro (Lemosho Route)** — Tanzania
2. **Mount Kenya (Chogoria/Sirimon)** — Kenya
3. **Inca Trail to Machu Picchu** — Peru

## Tech Stack

| Layer | Technology |
|-------|------------|
| iOS app | SwiftUI, MapKit (realistic globe), Core Data + CKSyncEngine, App Intents, StoreKit 2, WidgetKit (extension built; dormant until the App Group is enabled) |
| iOS AI | Foundation Models on-device, where Apple Intelligence is available — day notes, day names, grounded facts |
| Data | Apple CloudKit (`iCloud.no.akashic`) — private DB per family, shared DB for CKShare participants, public DB showcase mirror |
| Web frontend | React 19, TypeScript, Vite |
| Web maps | Mapbox GL JS (globe projection, 3D terrain) |
| Web data | CloudKit JS (Apple ID sign-in for family; anonymous public reads) |
| Hosting | **Cloudflare Pages today.** GitHub Pages is staged and dormant, awaiting the DNS cutover — see [`docs/github-pages-cutover.md`](docs/github-pages-cutover.md) |

## Getting Started (web)

### Prerequisites

- Node.js 20+ (Vite 7 requires `^20.19` or `>=22.12`; CI runs 20)
- Mapbox access token
- CloudKit JS API token for the container (public, container-scoped)

### Environment Variables

Create `.env.local` in the project root (see `.env.example`):

```env
VITE_MAPBOX_TOKEN=your_mapbox_token
VITE_CLOUDKIT_ENV=development
VITE_CLOUDKIT_API_TOKEN=your_cloudkit_api_token
```

### Installation

```bash
# Clone and install
git clone https://github.com/CHaerem/Akashic.git
cd Akashic
npm install

# Start development server
npm run dev

# Run tests
npm test           # Unit tests (Vitest)
npm run test:e2e   # E2E tests (Playwright)

# Build for production
npm run build
```

## The iOS app

Everything native lives under [`apple/`](apple/) — XcodeGen project, sync layer,
importer, App Intents, widget, TestFlight scripts. Start with
[`apple/README.md`](apple/README.md). The CloudKit schema and its Postgres
mapping are documented in [`apple/CloudKit/MAPPING.md`](apple/CloudKit/MAPPING.md).

## Status

**[`WORKPLAN.md`](WORKPLAN.md) is the only authoritative statement of what is done
and what is not.** Nothing else in this repo is authoritative about status.

The move from Supabase/Cloudflare to CloudKit is **complete** — CloudKit is the
only backend, and no source file reaches Supabase, R2 or the old media Worker.
What remains on that front is operator work: the GitHub Pages + DNS cutover and
then deleting the retired services. The decisions are in
[`APPLE-MIGRATION-PLAN.md`](APPLE-MIGRATION-PLAN.md), the task history in
[`APPLE-MIGRATION-TASKS.md`](APPLE-MIGRATION-TASKS.md), the manual steps in
[`APPLE-MIGRATION-RUNBOOK.md`](APPLE-MIGRATION-RUNBOOK.md), and the system as it
actually stands in [`ARCHITECTURE.md`](ARCHITECTURE.md).

Current work is v1.0 commercialization — see
[`COMMERCIALIZATION-PLAN.md`](COMMERCIALIZATION-PLAN.md).

## Architecture (web)

```
src/
├── components/      # AkashicApp, AuthGuard, MapboxGlobe + feature folders
│                    # (common, home, trek, journey, comments, public, layout, nav, ui)
├── contexts/        # AuthContext, JourneysContext, ThemeContext
├── hooks/           # useMapbox (modular), useTrekData, usePhotoDay, useMedia, …
├── lib/             # CloudKit JS adapter, journeys API, media, nativeOnly guard
├── styles/          # liquidGlass.ts design tokens
├── types/           # TypeScript types
└── utils/           # dates, formatting, geography, routeUtils, stats
```

[`ARCHITECTURE.md`](ARCHITECTURE.md) is the fuller picture, including the CloudKit
data model and the read-only guarantee on the web client.

## License

Personal project, built as a gift for family, now being prepared as a paid App
Store product ([`COMMERCIALIZATION-PLAN.md`](COMMERCIALIZATION-PLAN.md)). No
open-source licence is granted.
