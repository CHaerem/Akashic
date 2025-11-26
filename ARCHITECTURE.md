# Akashic Architecture

## Vision

An interactive platform to explore family travel journeys with photos, routes, and memories displayed on an immersive 3D globe. Designed to eventually support multiple users creating and sharing their own journeys.

### Journey Types

The platform should support different types of journeys:

1. **Treks/Hikes** (primary focus) - Multi-day adventures with routes, camps, elevation data
2. **Vacations** (future) - Location-based trips without a specific route (e.g., "Paris 2024")
3. **Road Trips** (future) - Route-based but with different waypoint semantics

The data model is designed to be flexible - routes, camps, and structured waypoints are all optional.

---

## Current State

| Component | Service | Status |
|-----------|---------|--------|
| Hosting | Cloudflare Pages | ✅ Active |
| Auth | Supabase Auth (Google OAuth) | ✅ Active |
| Media Storage | Cloudflare R2 (`akashic-media`) | ✅ Active |
| Media API | Cloudflare Worker (authenticated) | ✅ Active |
| Database | Supabase PostgreSQL | ✅ Active (data migrated) |
| Domain | akashic.no | ✅ Active (Cloudflare DNS) |

---

## Target Architecture

### Guiding Principles

1. **Minimal vendor lock-in** - Use open-source and portable solutions
2. **Multi-user ready** - Architecture supports multiple users from day one
3. **Expandable** - Easy to scale when free tiers are exceeded
4. **Simple** - Prefer managed services over self-hosting for now

### Target Stack

| Layer | Service | Why |
|-------|---------|-----|
| **Hosting** | Cloudflare Pages | 500 builds/mo, low lock-in, excellent CDN |
| **Auth** | Supabase Auth | Open source, self-hostable, replaces Auth0 |
| **Database** | Supabase PostgreSQL | Standard SQL, Row Level Security, exportable |
| **Storage** | Cloudflare R2 | S3-compatible API, 10GB free, zero egress |

### Free Tier Limits

| Service | Limit | Sufficient For |
|---------|-------|----------------|
| Cloudflare Pages | 500 builds/month | Heavy development |
| Supabase Auth | 50,000 MAU | Plenty |
| Supabase DB | 500 MB | ~100k+ journey records |
| Cloudflare R2 | 10 GB | ~2,000-3,000 photos |

---

## Data Model

### Users (Supabase Auth)

Managed by Supabase Auth - provides:
- Email/password authentication
- Social logins (Google, GitHub, etc.)
- User metadata

### Database Schema

```sql
-- Journeys: A trek/trip/vacation created by a user
CREATE TABLE journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Basic info
  name TEXT NOT NULL,              -- "Kilimanjaro Summit" or "Paris 2024"
  slug TEXT UNIQUE NOT NULL,       -- "kilimanjaro-2024"
  description TEXT,
  country TEXT,
  journey_type TEXT DEFAULT 'trek', -- 'trek', 'vacation', 'road_trip'

  -- Trek-specific (optional)
  summit_elevation INTEGER,        -- meters (null for vacations)
  total_distance NUMERIC,          -- kilometers (null for vacations)
  total_days INTEGER,
  date_started DATE,
  date_ended DATE,

  -- Media
  hero_image_url TEXT,             -- R2 URL
  gpx_url TEXT,                    -- R2 URL (optional - treks only)

  -- Map settings
  center_coordinates JSONB,        -- [lng, lat]
  default_zoom NUMERIC,
  preferred_bearing NUMERIC,       -- Camera bearing for map view
  preferred_pitch NUMERIC DEFAULT 60, -- Camera pitch for map view

  -- Route data (trek-specific)
  route JSONB,                     -- GeoJSON LineString geometry
  stats JSONB,                     -- Computed stats (distance, elevation, etc.)

  -- Metadata
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Waypoints: Stops/locations along a journey (camps for treks, places for vacations)
-- Optional - a journey can have zero waypoints (just photos with coordinates)
CREATE TABLE waypoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID REFERENCES journeys(id) ON DELETE CASCADE,

  -- Basic info
  name TEXT NOT NULL,              -- "Machame Camp" or "Eiffel Tower"
  waypoint_type TEXT DEFAULT 'camp', -- 'camp', 'location', 'landmark', 'hotel'
  day_number INTEGER,              -- Day 1, Day 2, etc. (optional)

  -- Location
  coordinates JSONB NOT NULL,      -- [lng, lat]
  elevation INTEGER,               -- meters (optional)

  -- Content
  description TEXT,
  highlights TEXT[],               -- Array of highlights

  -- Timing (optional)
  arrival_time TEXT,               -- "14:00"
  departure_time TEXT,
  date_visited DATE,               -- For vacations without day numbers

  -- Order
  sort_order INTEGER,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Photos: Images associated with journeys/waypoints
CREATE TABLE photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID REFERENCES journeys(id) ON DELETE CASCADE,
  waypoint_id UUID REFERENCES waypoints(id) ON DELETE SET NULL,

  -- Storage
  url TEXT NOT NULL,               -- R2 URL
  thumbnail_url TEXT,              -- R2 URL (smaller version)

  -- Metadata
  caption TEXT,
  coordinates JSONB,               -- [lng, lat] if geotagged
  taken_at TIMESTAMPTZ,

  -- Display
  is_hero BOOLEAN DEFAULT false,   -- Featured photo for waypoint
  sort_order INTEGER,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security (RLS) policies
ALTER TABLE journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE waypoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;

-- Users can read public journeys or their own
CREATE POLICY "Public journeys readable by all" ON journeys
  FOR SELECT USING (is_public = true OR auth.uid() = user_id);

-- Users can only modify their own journeys
CREATE POLICY "Users can manage own journeys" ON journeys
  FOR ALL USING (auth.uid() = user_id);

-- Waypoints inherit journey permissions
CREATE POLICY "Waypoints follow journey permissions" ON waypoints
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM journeys
      WHERE journeys.id = waypoints.journey_id
      AND (journeys.is_public = true OR journeys.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can manage own waypoints" ON waypoints
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM journeys
      WHERE journeys.id = waypoints.journey_id
      AND journeys.user_id = auth.uid()
    )
  );

-- Photos inherit journey permissions
CREATE POLICY "Photos follow journey permissions" ON photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM journeys
      WHERE journeys.id = photos.journey_id
      AND (journeys.is_public = true OR journeys.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can manage own photos" ON photos
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM journeys
      WHERE journeys.id = photos.journey_id
      AND journeys.user_id = auth.uid()
    )
  );
```

### Storage Structure (R2)

**Bucket**: `akashic-media`

```
akashic-media/
└── journeys/
    └── {journey_slug}/
        └── photos/
            ├── {photo_id}.jpg
            └── {photo_id}_thumb.jpg
```

**Access**: All R2 content is served through an authenticated Cloudflare Worker (`workers/media-proxy/`). The Worker:
- Verifies Supabase JWT tokens using JWKS (public key)
- Checks journey access permissions
- MVP: Any authenticated user can access all journeys
- Future: Support for private/shared/public access levels

**Worker URL**: `https://akashic-media.chris-haerem.workers.dev`

**Frontend utilities**:
- `src/lib/media.ts` - URL building helpers
- `src/hooks/useMedia.ts` - React hook for authenticated media URLs

---

## Migration Plan

### Phase 1: Infrastructure Setup ✅

1. **Cloudflare Pages** ✅
   - ✅ Create Cloudflare account
   - ✅ Connect GitHub repo
   - ✅ Configure build settings
   - ✅ Point akashic.no DNS to Cloudflare
   - ✅ Remove Netlify

2. **Supabase** ✅
   - ✅ Create Supabase project
   - ✅ Create database schema (journeys, waypoints, photos tables)
   - ✅ Configure auth providers (Google OAuth)
   - ✅ Set up Row Level Security
   - ✅ Add route/stats JSONB columns for trek data

3. **Cloudflare R2** ✅
   - ✅ Create R2 bucket (`akashic-media`)
   - ✅ Create authenticated media Worker
   - ✅ JWT verification via Supabase JWKS
   - ✅ Frontend utilities for authenticated URLs

### Phase 2: Code Migration ✅

4. **Replace Auth0 with Supabase Auth** ✅
   - ✅ Install `@supabase/supabase-js`
   - ✅ Remove `@auth0/auth0-react`
   - ✅ Update AuthGuard component
   - ✅ Update login flow
   - ✅ Configure allowed users (sign-ups disabled)

5. **Migrate Data to Database** ✅
   - ✅ Create Supabase client (`src/lib/supabase.ts`)
   - ✅ Create data fetching layer (`src/lib/journeys.ts`)
   - ✅ Create JourneysContext for async data loading
   - ✅ Run migration script (3 journeys, 18 waypoints, routes + stats)
   - ✅ Update hooks to use context (`useTrekData`, `useMapbox`)
   - ✅ Remove old JSON data files
   - ✅ Add e2e tests for Supabase data loading

6. **Photo Upload System** ⏳
   - Add upload endpoint to media Worker
   - Extract EXIF metadata (coordinates, date)
   - Store photo records in Supabase
   - Build photo display UI (TBD)

### Phase 3: Multi-user Features (Future)

7. **User Dashboard**
   - View own journeys
   - Create new journey
   - Edit journey details

8. **Journey Editor**
   - Add/edit camps
   - Upload photos
   - Draw/import GPX routes

9. **Sharing**
   - Public/private toggle
   - Share links
   - Embed support

---

## Environment Variables

### Frontend (.env)

```env
VITE_MAPBOX_TOKEN=xxx
VITE_SUPABASE_URL=xxx
VITE_SUPABASE_ANON_KEY=xxx
VITE_MEDIA_URL=https://akashic-media.chris-haerem.workers.dev  # Optional, has default
```

### Media Worker (workers/media-proxy/)

Secrets set via `wrangler secret put`:
- `SUPABASE_ANON_KEY` - For querying journey access

Environment variables in `wrangler.toml`:
- `SUPABASE_URL` - Supabase project URL

---

## GitHub Secrets Setup

The following secrets must be configured in your GitHub repository for CI/CD:

### Required Secrets

| Secret | Description | How to Get |
|--------|-------------|------------|
| `VITE_MAPBOX_TOKEN` | Mapbox API token for globe/map | [Mapbox Dashboard](https://account.mapbox.com/access-tokens/) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token for deployment | See below |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID | See below |

### Getting Cloudflare Credentials

1. **Account ID**:
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
   - Select your account
   - Account ID is shown in the right sidebar (or URL)

2. **API Token**:
   - Go to [API Tokens](https://dash.cloudflare.com/profile/api-tokens)
   - Click "Create Token"
   - Use the "Edit Cloudflare Workers" template OR create custom token with:
     - Account > Cloudflare Pages > Edit
     - Account > Account Settings > Read
   - Copy the generated token

### Adding Secrets to GitHub

1. Go to your repository on GitHub
2. Navigate to Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Add each secret with its name and value

---

## Long-term Goals

### Features

- [ ] Multiple journeys per user
- [ ] Photo galleries with lightbox
- [ ] Elevation profiles from GPX
- [ ] Journey statistics (distance, elevation gain, etc.)
- [ ] Timeline view of journey
- [ ] Photo map markers
- [ ] Journey sharing (public links)
- [ ] Embed widget for blogs
- [ ] Mobile app (PWA improvements)
- [ ] Offline support

### Scale Considerations

When free tiers are exceeded:

| Service | Upgrade Path | Est. Cost |
|---------|--------------|-----------|
| Supabase | Pro plan | $25/month |
| Cloudflare R2 | Pay-as-you-go | ~$0.015/GB/month |
| Cloudflare Pages | Pro plan (if needed) | $20/month |

### Exit Strategy

If needing to migrate away:

- **Supabase** → Self-host Supabase or migrate to any PostgreSQL
- **Cloudflare R2** → Any S3-compatible storage (AWS, Backblaze, MinIO)
- **Cloudflare Pages** → Any static host (Vercel, GitHub Pages, self-hosted)

---

## Development Notes

### Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

### Deployment

Automatic via GitHub → Cloudflare Pages on push to `main`.

### Testing Auth Locally

Supabase provides a local emulator:

```bash
npx supabase start
```

---

## References

- [Supabase Docs](https://supabase.com/docs)
- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages)
- [Cloudflare R2 Docs](https://developers.cloudflare.com/r2)
- [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js)

---

## Related Documents

- [ROADMAP.md](./ROADMAP.md) - Feature roadmap and development phases
