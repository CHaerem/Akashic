# Akashic

**Akashic** is an interactive 3D globe for visualizing family mountain adventures. Explore trek routes, view photos organized by day, and relive expeditions through immersive terrain visualization.

![Akashic Globe View](public/hero-images/akashic-hero.png)

Akashic is **iOS-first**: the native app under [`apple/`](apple/) is the primary
experience (and the only place journeys are edited); this repo's web app is a
read-mostly companion for any browser. Data lives in Apple **CloudKit** — the
family's private database, synced by the app, plus a world-readable public
showcase mirror for journeys marked public.

## Features

- **Interactive 3D Globe** — trek routes on a rotating globe with satellite imagery and terrain
- **Immersive Photo Lightbox** — full-screen photo viewing with swipe navigation
- **Day-by-Day Journey** — photos automatically organized by date, weather, fun facts and points of interest per day
- **Detailed Statistics** — elevation profiles, daily distances, and trek metrics
- **Family Sharing** — journeys shared via iCloud (CKShare); comments and caption edits from the web
- **Public Showcase** — journeys marked public are viewable by anyone, no sign-in
- **Exit Door Built In** — any journey exports from the iOS app as GPX + JSON + original photos

## Featured Journeys

1. **Kilimanjaro (Lemosho Route)** — Tanzania
2. **Mount Kenya (Chogoria/Sirimon)** — Kenya
3. **Inca Trail to Machu Picchu** — Peru

## Tech Stack

| Layer | Technology |
|-------|------------|
| iOS app | SwiftUI, MapKit (realistic globe), Core Data + CKSyncEngine, App Intents, WidgetKit |
| Data | Apple CloudKit (`iCloud.no.akashic`) — private DB per family, public DB showcase |
| Web frontend | React 19, TypeScript, Vite |
| Web maps | Mapbox GL JS (globe projection, 3D terrain) |
| Web data | CloudKit JS (Apple ID sign-in for family; anonymous public reads) |
| Hosting | GitHub Pages (static bundle; photos come from CloudKit) |

## Getting Started (web)

### Prerequisites

- Node.js 18+
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

## Migration status

The move from Supabase/Cloudflare to CloudKit is documented in
[`APPLE-MIGRATION-PLAN.md`](APPLE-MIGRATION-PLAN.md) (decisions),
[`APPLE-MIGRATION-TASKS.md`](APPLE-MIGRATION-TASKS.md) (progress) and
[`APPLE-MIGRATION-RUNBOOK.md`](APPLE-MIGRATION-RUNBOOK.md) (operator steps).

## Architecture (web)

```
src/
├── components/
│   ├── common/      # Shared components (PhotoLightbox, etc.)
│   ├── home/        # Globe view components
│   └── trek/        # Journey view components (InfoPanel, tabs)
├── hooks/           # Custom hooks (useMapbox, useMedia, etc.)
├── lib/             # CloudKit JS adapter, journeys API, media
├── contexts/        # React contexts
└── types/           # TypeScript types
```

## License

Personal project, created as a gift for family.
