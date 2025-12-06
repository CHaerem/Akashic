# Akashic Roadmap

## Overview

This document outlines the feature development roadmap for Akashic, from MVP to full multi-user platform.

---

## MVP Goal

**Target**: Christmas 2024 gift for family

A polished experience where authorized family members can:

- Log in with Google
- Explore existing family journeys on the 3D globe
- View photos, routes, camps, and stats for each journey

**Current journeys**: Kilimanjaro, Inca Trail, Mount Kenya

### MVP Checklist (what's done vs remaining)

| Feature                           | Status | Notes                                    |
| --------------------------------- | ------ | ---------------------------------------- |
| Google auth                       | ✅     | Family members whitelisted               |
| 3D globe view                     | ✅     | Click journey → zooms in                 |
| Journey details (overview, stats) | ✅     | InfoPanel with tabs                      |
| Photo upload to R2                | ✅     | With EXIF extraction                     |
| Photo viewing (grid + lightbox)   | ✅     | In Photos tab                            |
| Photos by day                     | ✅     | Auto-match by date + manual assign       |
| Edit journey details              | ✅     | Modal with all fields                    |
| Edit waypoints/days               | ✅     | Name, elevation, description, highlights |
| Free tier limits                  | ✅     | Server-side enforcement                  |
| Delete photos                     | ✅     | Via Photos tab                           |
| Photo map markers                 | ✅     | Click to open lightbox, fly to photo     |
| **Create new journey**            | ❌     | Not needed for MVP (3 journeys exist)    |
| **Delete journey**                | ❌     | Nice-to-have, not critical               |

**MVP is feature-complete** - remaining work is polish and testing.

---

## Phase 1: Photo Storage & Upload Infrastructure

### Goal

Move photos from git repo to Cloudflare R2 and build upload tooling.

### Tasks

#### 1.1 Cloudflare R2 Setup

- [x] Create R2 bucket (`akashic-media`)
- [x] Create authenticated media Worker (`workers/media-proxy/`)
- [x] JWT verification via Supabase JWKS (public key)
- [x] Worker deployed at `akashic-media.chris-haerem.workers.dev`
- [x] Frontend utilities (`src/lib/media.ts`, `src/hooks/useMedia.ts`)

#### 1.2 Photo Upload API

- [x] Add upload endpoint to media Worker (`POST /upload/journeys/{slug}/photos`)
- [x] File validation (type, size limits)
- [x] Extract EXIF metadata (coordinates, date taken) - client-side via `exifr`
- [x] Handle thumbnail generation (client-side resize before upload)

#### 1.3 Database Integration

- [x] Photo CRUD operations in `src/lib/journeys.ts`
- [x] Link photos to journeys
- [x] Link photos to waypoints (via "Assign Photos" button per day)
- [x] Store extracted EXIF data (coordinates, timestamps)

#### 1.4 Photo Display

- [x] PhotosTab component with upload UI
- [x] Photo grid with thumbnails
- [x] Lightbox for full-size viewing
- [x] Photos organized by day in Journey tab (matched by taken_at date)
- [x] Display photos on map at GPS coordinates (markers with click-to-view)

### Photo Data Model (existing in Supabase)

```sql
photos (
  id UUID,
  journey_id UUID,      -- Required: which journey
  waypoint_id UUID,     -- Optional: specific camp/location
  url TEXT,             -- R2 path (e.g., "journeys/kilimanjaro/photos/abc123.jpg")
  thumbnail_url TEXT,   -- R2 path for thumbnail
  caption TEXT,
  coordinates JSONB,    -- [lng, lat] from EXIF or manual
  taken_at TIMESTAMPTZ, -- From EXIF or manual
  sort_order INTEGER
)
```

### R2 Storage Structure

```
akashic-media/
└── journeys/
    └── {journey_uuid}/
        └── photos/
            ├── {photo_id}.jpg
            └── {photo_id}_thumb.jpg
```

**Note**: Photos are served through authenticated Worker, not directly from R2. Paths use journey UUIDs (migrated from slug-based paths).

---

## Phase 2: Journey Management UI

### Goal

Collaborative interface for family members to create and edit journeys together.

### Tasks

#### 2.1 Journey CRUD

- [ ] Create new journey form (name, type, dates, description)
- [x] Edit journey details (name, country, description, dates, stats via modal)
- [ ] Delete journey (with confirmation)
- [x] Journey visibility: private by default, shared with all authenticated family members (MVP model)

#### 2.2 Waypoint Management

- [x] Add waypoints to journey (via RouteEditor - click on route)
- [x] Edit waypoint details (name, day number, elevation, description, highlights)
- [x] Reorder waypoints (via RouteEditor - drag along route, auto-sorts by distance)
- [x] Delete waypoints (via RouteEditor)
- [x] Click-on-map to set coordinates (via RouteEditor)

#### 2.3 Photo Management

- [x] Bulk photo upload with progress (multi-file select, shows upload status)
- [x] Assign photos to waypoints (via modal)
- [x] Set hero images for journey (via PhotoEditModal)
- [x] Add/edit captions (via PhotoEditModal)
- [x] Edit photo location (via PhotoEditModal with map picker)
- [x] Reorder photos (drag-and-drop in edit mode)
- [x] Delete photos

#### 2.4 Route & Camp Position Management

**Phase A: Camp Placement Editor** ✅

- [x] RouteEditor fullscreen component with draggable markers
- [x] Snap camps to route line when dragged
- [x] Click on route to add new camps
- [x] Store route_distance_km and route_point_index in waypoints
- [x] Elevation profile uses stored route distances
- [x] Route utility functions (snap to route, distance calc)

**Phase B: Route Adjustment** ✅

- [x] Click to add intermediate points to route
- [x] Drag existing route points to adjust path
- [x] Delete route points
- [x] Douglas-Peucker auto-simplification

**Phase C: Intelligent Route Drawing** ✅

- [x] Draw mode toggle (Edit vs Draw sub-modes)
- [x] Freehand drawing with mouse/touch gestures
- [x] Real-time drawing preview layer
- [x] Mapbox Map Matching API integration (snap to trails)
- [x] Auto-fallback to simplified freehand when no trails nearby
- [x] Visual feedback (snapped vs freehand)
- [x] Mobile touch support (single finger = draw, two fingers = pan)

**Phase D: Route Import** (Future)

- [ ] GPX re-import with merge options
- [ ] Upload GPX file
- [ ] Parse and store route geometry
- [ ] Compute stats (distance, elevation gain/loss)

### UI Considerations

For MVP, the admin UI can be simple:

- Accessible only to authorized users (owner)
- Basic forms and lists
- No need for drag-and-drop or fancy UX yet

---

## Phase 2.5: Immersive Exploration

### Goal

Deepen the journey exploration experience by connecting map, photos, elevation, and route into a cohesive, interactive narrative. Keep it calm and simple while making exploration more engaging.

### Priority Order

#### 2.5.1 Interactive Elevation Profile ✅

Transform the static elevation chart into an interactive exploration tool.

- [x] Hover shows day name, elevation, distance marker
- [x] Click flies camera to that camp, selects it in Journey tab
- [x] Current selected day highlighted on the profile
- [x] Smooth transitions between selections
- [x] Touch support for mobile devices

#### 2.5.2 Photo Markers on Map ✅

Show photos spatially on the map using their GPS coordinates.

- [x] Render small markers/dots at photo locations along route
- [x] Click marker to open lightbox
- [x] Cluster markers when zoomed out, spread when zoomed in
- [x] When a day is selected, highlight only that day's photo markers
- [x] Subtle styling that doesn't clutter the map

#### 2.5.3 Photo ↔ Map Connection ✅

Connect the lightbox experience to the spatial journey.

- [x] "View on map" button flies camera to photo location (from all lightboxes)
- [ ] Small map inset in lightbox (future - adds complexity)
- [ ] Option to navigate photos by geographic order (future)

#### 2.5.4 Enhanced Camp Selection

Visual improvements when selecting a day/camp.

- [ ] Photo thumbnails appear as subtle strip when camp selected
- [ ] Featured photo fades in as background layer (optional)
- [ ] Walked segment pulses briefly on selection

#### 2.5.5 Route as Timeline

Make the route line itself interactive.

- [x] Click anywhere on route to see segment info (distance, elevation, nearest camp)
- [ ] Show "Day X - between Camp A and Camp B"
- [ ] Display distance walked, elevation change for segment
- [ ] Jump to that day's photos from route click

#### 2.5.6 Journey Playback Mode

Meditative "walk through" experience.

**Status**: Implementation stashed (`git stash list` to see). Revisit when more photos are added to journeys.

- [ ] Play button starts automatic camp-to-camp progression
- [ ] Camera moves smoothly between waypoints
- [ ] Day/night cycle simulation (dawn → midday → sunset per day segment)
- [ ] Photos fade in as you "arrive" at each day (5 second pause with gallery)
- [ ] Pause/resume, manual control with arrow keys
- [ ] Optional ambient mode (minimal UI)

---

## Phase 3: Polish & Extended Features

### Goal

Quality-of-life improvements and additional features.

### Features

#### Photo Features

- [x] Auto-extract coordinates from EXIF GPS data (client-side via exifr)
- [ ] Auto-match photos to nearest waypoint by coordinates
- [x] Auto-match photos to days by date (Journey tab shows photos per day)
- [x] Photo lightbox/gallery view

#### Journey Features

- [ ] GPX import with automatic waypoint detection
- [ ] Journey statistics dashboard

#### UX Improvements

- [ ] Offline support (PWA)
- [ ] Mobile gesture improvements
- [ ] Loading skeletons
- [ ] Error boundaries

---

## Phase 4: Multi-User Foundation ✅

### Goal

Role-based access control allowing journey owners to invite collaborators.

### Completed Features

#### Database Schema ✅

- [x] `profiles` table with auth.users sync trigger
- [x] `journey_members` table with role-based access (owner/editor/viewer)
- [x] RLS policies using `user_has_journey_access()` helper function
- [x] Auto-create owner membership when journey is created

#### Member Management ✅

- [x] Add/remove journey members from JourneyEditModal
- [x] Change member roles (owner, editor, viewer)
- [x] View current members and their roles
- [x] R2 paths migrated from slug to UUID (8 photos migrated)

#### Sharing Model

- [x] Role-based access: owner, editor, viewer
- [x] Owners can manage members
- [x] Editors can modify journey content
- [x] Viewers have read-only access
- [ ] Public journey links (opt-in per journey)
- [ ] Email invitations

---

## Future: Extended Multi-User Platform

### Vision

A platform where anyone can create and share their travel journeys.

### Features Required

#### User Management

- [ ] Self-service registration (currently disabled)
- [ ] User dashboard (my journeys)
- [ ] User profile editing

#### Extended Sharing

- [ ] Share journey with specific users (email invite)
- [ ] Public journey links (opt-in per journey)
- [ ] Embed widget for blogs
- [ ] Social sharing

#### Collaboration

- [ ] Comments on journeys

### Scale Considerations

| When         | Action                          |
| ------------ | ------------------------------- |
| R2 > 10GB    | Pay-as-you-go ($0.015/GB/month) |
| DB > 500MB   | Supabase Pro ($25/month)        |
| High traffic | Consider caching strategy       |

---

## Current Status

| Phase                                 | Status           | Notes                                                          |
| ------------------------------------- | ---------------- | -------------------------------------------------------------- |
| Infrastructure                        | ✅ Complete      | Cloudflare Pages, Supabase Auth/DB                             |
| Data Migration                        | ✅ Complete      | 3 journeys, 18 waypoints in DB                                 |
| E2E Tests                             | ✅ Complete      | Auth bypass for testing                                        |
| Phase 1.1 (R2 Setup)                  | ✅ Complete      | Bucket + authenticated Worker deployed                         |
| Phase 1.2 (Photo Upload)              | ✅ Complete      | Upload endpoint + frontend UI                                  |
| Phase 1.3 (DB Integration)            | ✅ Complete      | Photo CRUD, waypoint linking, assign photos modal              |
| Phase 1.4 (Photo Display)             | ✅ Complete      | Grid, lightbox, day-based, map markers                         |
| Phase 2 (Journey UI)                  | ✅ Complete      | Journey editing, Route Editor A+B+C (intelligent drawing) done |
| **Phase 2.5 (Immersive Exploration)** | ✅ Core Complete | Elevation profile, photo markers, view-on-map done             |
| Phase 3 (Polish)                      | 📋 Planned       | After immersive exploration                                    |
| **Phase 4 (Multi-user Foundation)**   | ✅ Complete      | Role-based access, member management UI                        |

---

## Decision Log

| Date    | Decision                                             | Rationale                                                                                  |
| ------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 2024-11 | Use Cloudflare R2 over S3                            | Zero egress fees, 10GB free                                                                |
| 2024-11 | Supabase over Auth0                                  | Open source, self-hostable, unified with DB                                                |
| 2024-11 | Keep auth simple (Google only)                       | MVP scope, family use case                                                                 |
| 2024-11 | E2E test auth bypass                                 | Allows automated testing without real auth                                                 |
| 2024-11 | Authenticated R2 via Worker                          | Future-proof for multi-user, uses JWKS for JWT verification                                |
| 2024-11 | MVP access: all authenticated users see all journeys | Simplest model for family sharing                                                          |
| 2024-11 | Photo display UX TBD                                 | Will experiment with map markers, lightbox, timeline                                       |
| 2024-11 | Collaborative over admin-only                        | Family members can all contribute photos                                                   |
| 2024-11 | Free tier limits enforced server-side                | Worker: 20MB max, Supabase triggers: 20 journeys, 100 photos/journey, 30 waypoints/journey |
| 2024-11 | Multi-user via journey_members table                 | Role-based (owner/editor/viewer), RLS helper function, migrated R2 paths to UUID           |

---

## Questions to Resolve

1. ~~**Photo display**: Map markers? Lightbox? Timeline?~~ → **Resolved**: Lightbox done, map markers deferred to Phase 3
2. ~~**EXIF extraction**: Client-side (before upload) or server-side (after upload)?~~ → **Resolved**: Client-side using `exifr` library
3. ~~**Thumbnail generation**: On-demand vs at upload time?~~ → **Resolved**: Client-side at upload time (400px max, JPEG 80%)
