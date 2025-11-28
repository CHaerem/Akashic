# Akashic

**Akashic** is an interactive 3D globe for visualizing family mountain adventures. Explore trek routes, view photos organized by day, and relive expeditions through immersive terrain visualization.

![Akashic Globe View](public/hero-images/akashic-hero.png)

## Features

- **Interactive 3D Globe** - Explore trek routes on a rotating globe with satellite imagery and terrain
- **Immersive Photo Lightbox** - Full-screen photo viewing with swipe navigation and auto-hiding controls
- **Day-by-Day Journey** - Photos automatically organized by date, with manual assignment option
- **Detailed Statistics** - Elevation profiles, daily distances, and trek metrics
- **Collaborative Editing** - Family members can upload photos and edit journey details
- **Calm Design** - Minimal, distraction-free interface with smooth animations

## Featured Journeys

1. **Kilimanjaro (Lemosho Route)** - Tanzania
2. **Mount Kenya (Chogoria/Sirimon)** - Kenya
3. **Inca Trail to Machu Picchu** - Peru

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite |
| Maps | Mapbox GL JS (globe projection, 3D terrain) |
| Auth | Supabase Auth (Google OAuth) |
| Database | Supabase PostgreSQL |
| Photo Storage | Cloudflare R2 |
| Media Proxy | Cloudflare Worker (JWT auth) |
| Hosting | Cloudflare Pages |

## Getting Started

### Prerequisites

- Node.js 18+
- Mapbox access token
- Supabase project
- Cloudflare account (for R2 and Workers)

### Environment Variables

Create `.env` in the project root:

```env
VITE_MAPBOX_TOKEN=your_mapbox_token
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_MEDIA_WORKER_URL=your_worker_url
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

### Deployment

The app auto-deploys to Cloudflare Pages on push to `main`.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system design and [ROADMAP.md](ROADMAP.md) for development progress.

```
src/
├── components/
│   ├── common/      # Shared components (PhotoLightbox, etc.)
│   ├── home/        # Globe view components
│   └── trek/        # Journey view components (InfoPanel, tabs)
├── hooks/           # Custom hooks (useMapbox, useMedia, etc.)
├── lib/             # API clients (Supabase, media)
├── contexts/        # React contexts
└── types/           # TypeScript types
```

## License

Personal project, created as a gift for family.
