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
| MCP API | Cloudflare Worker (JSON-RPC) | ✅ Active |
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
-- User profiles (synced from auth.users via trigger)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Journey membership with role-based access
CREATE TABLE journey_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID REFERENCES journeys(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(journey_id, user_id)
);

-- Journeys: A trek/trip/vacation
CREATE TABLE journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users(id),  -- Original creator

  -- Basic info
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  country TEXT,
  journey_type TEXT DEFAULT 'trek',

  -- Trek-specific (optional)
  summit_elevation INTEGER,
  total_distance NUMERIC,
  total_days INTEGER,
  date_started DATE,
  date_ended DATE,

  -- Media (R2 paths use journey UUID, not slug)
  hero_image_url TEXT,
  gpx_url TEXT,

  -- Map settings
  center_coordinates JSONB,
  default_zoom NUMERIC,
  preferred_bearing NUMERIC,
  preferred_pitch NUMERIC DEFAULT 60,

  -- Route data
  route JSONB,
  stats JSONB,

  -- Metadata
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Waypoints with route position data
CREATE TABLE waypoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID REFERENCES journeys(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  waypoint_type TEXT DEFAULT 'camp',
  day_number INTEGER,
  coordinates JSONB NOT NULL,
  elevation INTEGER,
  description TEXT,
  highlights TEXT[],
  sort_order INTEGER,
  route_distance_km NUMERIC,     -- Distance along route (from RouteEditor)
  route_point_index INTEGER,     -- Index in route array
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Photos with uploader attribution
CREATE TABLE photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID REFERENCES journeys(id) ON DELETE CASCADE,
  waypoint_id UUID REFERENCES waypoints(id) ON DELETE SET NULL,
  url TEXT NOT NULL,             -- R2 path: journeys/{journey_uuid}/photos/{id}.jpg
  thumbnail_url TEXT,
  caption TEXT,
  coordinates JSONB,
  taken_at TIMESTAMPTZ,
  is_hero BOOLEAN DEFAULT false,
  sort_order INTEGER,
  uploaded_by UUID REFERENCES auth.users(id),  -- Who uploaded
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Helper function for membership-based access checks
CREATE FUNCTION user_has_journey_access(journey_uuid UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM journey_members
    WHERE journey_id = journey_uuid
    AND user_id = auth.uid()
    AND (
      CASE required_role
        WHEN 'viewer' THEN role IN ('owner', 'editor', 'viewer')
        WHEN 'editor' THEN role IN ('owner', 'editor')
        WHEN 'owner' THEN role = 'owner'
      END
    )
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- RLS Policies (membership-based)
ALTER TABLE journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE waypoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Journeys: public OR member with viewer+ role
CREATE POLICY "Journey access" ON journeys
  FOR SELECT USING (is_public = true OR user_has_journey_access(id));
CREATE POLICY "Journey modify" ON journeys
  FOR ALL USING (user_has_journey_access(id, 'editor'));

-- Waypoints/Photos: inherit from journey membership
CREATE POLICY "Waypoint access" ON waypoints FOR SELECT USING (user_has_journey_access(journey_id));
CREATE POLICY "Waypoint modify" ON waypoints FOR ALL USING (user_has_journey_access(journey_id, 'editor'));
CREATE POLICY "Photo access" ON photos FOR SELECT USING (user_has_journey_access(journey_id));
CREATE POLICY "Photo modify" ON photos FOR ALL USING (user_has_journey_access(journey_id, 'editor'));

-- Members: owners can manage, members can view
CREATE POLICY "Member view" ON journey_members FOR SELECT USING (user_has_journey_access(journey_id));
CREATE POLICY "Member manage" ON journey_members FOR ALL USING (user_has_journey_access(journey_id, 'owner'));

-- Profiles: all authenticated users can view (for member dropdown)
CREATE POLICY "Profile view" ON profiles FOR SELECT USING (auth.role() = 'authenticated');

-- Triggers: auto-create profile, auto-add creator as owner
-- (See migration file for full implementation)
```

### Roles

| Role | Permissions |
|------|-------------|
| **owner** | Full control - edit journey, manage members, delete journey |
| **editor** | Edit journey details, upload/edit photos, edit waypoints |
| **viewer** | Read-only access to journey, photos, and waypoints |

### Storage Structure (R2)

**Bucket**: `akashic-media`

```
akashic-media/
└── journeys/
    └── {journey_uuid}/
        └── photos/
            ├── {photo_id}.jpg
            └── {photo_id}_thumb.jpg
```

**Access**: All R2 content is served through an authenticated Cloudflare Worker (`workers/media-proxy/`). The Worker:
- Verifies Supabase JWT tokens using JWKS (public key)
- Checks journey membership via `journey_members` table
- Role-based access: owner, editor, viewer
- Public journeys accessible without authentication

**Worker URL**: `https://akashic-media.chris-haerem.workers.dev`

**Frontend utilities**:
- `src/lib/media.ts` - URL building helpers
- `src/hooks/useMedia.ts` - React hook for authenticated media URLs

### MCP (Model Context Protocol) API

The media Worker also exposes an MCP endpoint for AI assistant integration (e.g., Claude Desktop).

**Endpoint**: `POST /mcp`

**Protocol**: JSON-RPC 2.0 over HTTP

**Available Tools**:

| Tool | Description | Auth Required |
|------|-------------|---------------|
| `list_journeys` | List user's accessible journeys | Yes |
| `get_journey_details` | Full journey with camps, route, stats | Yes |
| `search_journeys` | Search by name/country/description | Yes |
| `get_journey_stats` | Computed difficulty, times, elevation | Yes |
| `get_journey_photos` | Photos with GPS and dates | Yes |

**Authentication**: All tool calls require a valid Supabase JWT token in the `Authorization: Bearer <token>` header.

**Example Usage**:

```bash
# List available tools
curl -X POST https://akashic-media.chris-haerem.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call a tool (requires auth)
curl -X POST https://akashic-media.chris-haerem.workers.dev/mcp \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_journeys","arguments":{}}}'
```

**Claude Desktop Integration**:

Add to your MCP settings (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "akashic": {
      "type": "http",
      "url": "https://akashic-media.chris-haerem.workers.dev/mcp"
    }
  }
}
```

**Source**: `workers/media-proxy/src/mcp/`

---

## UI Components

### Design System

The UI uses a **Liquid Glass** design system inspired by iOS/macOS glass morphism:

| Layer | Purpose |
|-------|---------|
| `src/styles/liquidGlass.ts` | Core design tokens (colors, blur, shadows) |
| `src/components/ui/` | shadcn/ui components with glass theme |
| `src/contexts/ThemeContext.tsx` | Dark mode (Liquid Glass is dark-only) |

### Navigation (Find My-Inspired UI)

The UI follows Apple's "Find My" iOS app pattern: full-screen map with a draggable bottom sheet.

```
src/components/layout/
├── BottomSheet.tsx         # iOS-style draggable sheet with snap points
├── BottomSheetContent.tsx  # Routes content based on view + mode
└── QuickActionBar.tsx      # Top-right floating action buttons

src/components/nav/
├── NavigationPill.tsx      # Day selector + mode switcher in sheet header
├── AdaptiveNavPill.tsx     # Legacy pill with magnification (deprecated)
├── ContentCard.tsx         # Floating card for tab content (deprecated)
└── ContextCard.tsx         # Day info context card
```

**BottomSheet Features:**
- **Three snap points**: minimized (10vh), half (45vh), expanded (88vh)
- **Spring animations**: iOS-native feel with velocity-based snapping
- **Scroll locking**: Content scrolls only when sheet is expanded
- **Safe area support**: Works with notched devices

**QuickActionBar Actions:**
- **Globe button**: Return to globe view
- **Edit mode toggle**: Enable editing (waypoints, photos, journey details)
- **Recenter**: Fly camera to current camp/trek

**Content Modes:**
- `day`: Current day details with photo strip
- `photos`: Full photo grid with edit/assign
- `stats`: Elevation profile and journey statistics
- `info`: Journey overview

**Edit Mode:**
When enabled via QuickActionBar, edit buttons appear in:
- Globe view: "Edit Journey Details" button
- Trek day view: "Edit Day" and "Assign Photos" buttons

### Tab Components

Content cards render these tab components:

| Component | Purpose |
|-----------|---------|
| `StatsTab` | Journey stats, uses extracted sub-components |
| `JourneyTab` | Day-by-day breakdown with segments |
| `OverviewTab` | Trek description and key stats |
| `PhotosTab` | Photo gallery with upload |

**Extracted Trek Components** (`src/components/trek/`):

| Component | Purpose |
|-----------|---------|
| `InteractiveElevationProfile` | SVG elevation chart with zoom/pan/touch |
| `HistoricalSiteCard` | Expandable historical site info |
| `DayPhotos` | Photo grid for a single day |
| `SegmentInfo` | Hiking segment details between camps |

### Shared Hooks

| Hook | Location | Purpose |
|------|----------|---------|
| `usePhotoDay` | `src/hooks/usePhotoDay.ts` | Photo-day matching with 4-tier strategy |
| `useMedia` | `src/hooks/useMedia.ts` | Authenticated media URL generation |
| `useOnlineStatus` | `src/hooks/useOnlineStatus.ts` | Network status, cache status, storage usage |
| `useMapbox` | `src/hooks/mapbox/` | Mapbox GL integration (modular) |

### Modular Code Structure

Large files have been refactored into focused modules for maintainability:

**`src/lib/journeys/`** - Supabase data layer (split from 960-line journeys.ts)
```
journeys/
├── index.ts          # Barrel file with re-exports
├── types.ts          # DbJourney, DbWaypoint interfaces
├── transforms.ts     # toTrekConfig, toTrekData helpers
├── journeyAPI.ts     # Journey CRUD + cache management
├── photoAPI.ts       # Photo operations
├── waypointAPI.ts    # Waypoint CRUD
└── memberAPI.ts      # Member management
```

**`src/hooks/mapbox/`** - Mapbox GL hook (extracted types and configs)
```
mapbox/
├── index.ts          # Barrel file with re-exports
├── types.ts          # Hook interfaces and types
├── layerConfigs.ts   # Mapbox layer paint configurations
└── useMapbox.ts      # Core hook logic
```

**Backwards Compatibility**: Original files (`src/lib/journeys.ts`, `src/hooks/useMapbox.ts`) re-export from the modular structure, preserving all existing imports.

### Utilities

| File | Purpose |
|------|---------|
| `src/utils/dates.ts` | Date formatting and photo-day matching |
| `src/utils/formatting.ts` | Distance, elevation, duration formatting |
| `src/utils/geography.ts` | Haversine distance, bearing calculations |
| `src/utils/routeUtils.ts` | Route segments, difficulty, hiking time |

### Icons Library

Reusable icons in `src/components/icons/index.tsx`:
- CalendarIcon, InfoIcon, PhotoIcon, StatsIcon
- CloseIcon, ChevronIcon, PencilIcon, MapPinIcon
- ExpandIcon, TrashIcon, DownloadIcon

### Component Library (shadcn/ui)

Base components in `src/components/ui/`:

- `Button` - 5 variants, 44px mobile touch targets
- `Card` - Glass morphism cards
- `Dialog` - Modal dialogs
- `Sheet` - Bottom sheets for mobile
- `Tabs` - Tab navigation
- Form components: `Input`, `Textarea`, `Select`, `Label`
- `Skeleton` - Loading states

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

6. **Photo Upload System** ✅
   - ✅ Upload endpoint in media Worker (`POST /upload/journeys/{slug}/photos`)
   - ✅ Photo CRUD operations in `src/lib/journeys.ts`
   - ✅ PhotosTab component with drag-and-drop upload
   - ✅ Photo grid + lightbox display
   - ⏳ EXIF metadata extraction (pending)
   - ⏳ Photo map markers (pending)

### Phase 3: Multi-user Foundation ✅

7. **Database Schema** ✅
   - ✅ `profiles` table with auth.users sync trigger
   - ✅ `journey_members` table with role-based access
   - ✅ RLS policies using `user_has_journey_access()` helper
   - ✅ Auto-create owner membership on journey creation

8. **Member Management** ✅
   - ✅ Add/remove journey members
   - ✅ Role management (owner, editor, viewer)
   - ✅ Member management UI in JourneyEditModal
   - ✅ R2 paths migrated from slug to UUID

### Phase 4: Multi-user Features (Future)

9. **User Dashboard**
   - View own journeys
   - Create new journey
   - Edit journey details

10. **Journey Editor**
    - Add/edit camps
    - Upload photos
    - Draw/import GPX routes

11. **Sharing**
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
