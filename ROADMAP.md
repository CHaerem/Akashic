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
- [ ] Handle thumbnail generation (resize on upload or on-demand)

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
- [ ] Display photos on map at GPS coordinates

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
    └── {journey_slug}/
        └── photos/
            ├── {photo_id}.jpg
            └── {photo_id}_thumb.jpg
```

**Note**: Photos are served through authenticated Worker, not directly from R2.

---

## Phase 2: Journey Management UI

### Goal
Collaborative interface for family members to create and edit journeys together.

### Tasks

#### 2.1 Journey CRUD
- [ ] Create new journey form (name, type, dates, description)
- [x] Edit journey details (name, country, description, dates, stats via modal)
- [ ] Delete journey (with confirmation)
- [ ] Set journey visibility (public/private)

#### 2.2 Waypoint Management
- [ ] Add waypoints to journey
- [x] Edit waypoint details (name, day number, elevation, description, highlights)
- [ ] Reorder waypoints (drag-and-drop)
- [ ] Delete waypoints
- [ ] Click-on-map to set coordinates

#### 2.3 Photo Management
- [ ] Bulk photo upload with progress
- [x] Assign photos to waypoints (via modal)
- [ ] Set hero images for journey/waypoints
- [ ] Add/edit captions
- [ ] Reorder photos
- [x] Delete photos

#### 2.4 Route Management
- [ ] Upload GPX file
- [ ] Parse and store route geometry
- [ ] Compute stats (distance, elevation gain/loss)
- [ ] Visualize route on map during editing

### UI Considerations

For MVP, the admin UI can be simple:
- Accessible only to authorized users (owner)
- Basic forms and lists
- No need for drag-and-drop or fancy UX yet

---

## Phase 3: Enhanced Features

### Goal
Polish and quality-of-life improvements.

### Nice-to-Haves

#### Photo Features
- [x] Auto-extract coordinates from EXIF GPS data (client-side via exifr)
- [ ] Auto-match photos to nearest waypoint by coordinates
- [x] Auto-match photos to days by date (Journey tab shows photos per day)
- [x] Photo lightbox/gallery view
- [ ] Photo map markers (show photos at their GPS locations)

#### Journey Features
- [ ] GPX import with automatic waypoint detection
- [ ] Elevation profile visualization (already partially done)
- [ ] Timeline view of journey
- [ ] Journey statistics dashboard

#### UX Improvements
- [ ] Offline support (PWA)
- [ ] Mobile gesture improvements
- [ ] Loading skeletons
- [ ] Error boundaries

---

## Future: Multi-User Platform

### Vision
A platform where anyone can create and share their travel journeys.

### Features Required

#### User Management
- [ ] Self-service registration (currently disabled)
- [ ] User profiles
- [ ] User dashboard (my journeys)

#### Sharing
- [ ] Public journey links
- [ ] Embed widget for blogs
- [ ] Social sharing

#### Collaboration
- [ ] Share journey with specific users
- [ ] Collaborative editing
- [ ] Comments on journeys

### Scale Considerations

| When | Action |
|------|--------|
| R2 > 10GB | Pay-as-you-go ($0.015/GB/month) |
| DB > 500MB | Supabase Pro ($25/month) |
| High traffic | Consider caching strategy |

---

## Current Status

| Phase | Status | Notes |
|-------|--------|-------|
| Infrastructure | ✅ Complete | Cloudflare Pages, Supabase Auth/DB |
| Data Migration | ✅ Complete | 3 journeys, 18 waypoints in DB |
| E2E Tests | ✅ Complete | Auth bypass for testing |
| Phase 1.1 (R2 Setup) | ✅ Complete | Bucket + authenticated Worker deployed |
| Phase 1.2 (Photo Upload) | ✅ Complete | Upload endpoint + frontend UI |
| Phase 1.3 (DB Integration) | ⏳ Partial | Photo CRUD done, waypoint linking pending |
| Phase 1.4 (Photo Display) | ✅ Complete | Grid, lightbox, day-based organization |
| Phase 2 (Journey UI) | ⏳ Partial | Journey editing done, waypoint/create pending |
| Phase 3 (Polish) | 📋 Planned | After MVP launch |
| Multi-user | 🔮 Future | Post-MVP |

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2024-11 | Use Cloudflare R2 over S3 | Zero egress fees, 10GB free |
| 2024-11 | Supabase over Auth0 | Open source, self-hostable, unified with DB |
| 2024-11 | Keep auth simple (Google only) | MVP scope, family use case |
| 2024-11 | E2E test auth bypass | Allows automated testing without real auth |
| 2024-11 | Authenticated R2 via Worker | Future-proof for multi-user, uses JWKS for JWT verification |
| 2024-11 | MVP access: all authenticated users see all journeys | Simplest model for family sharing |
| 2024-11 | Photo display UX TBD | Will experiment with map markers, lightbox, timeline |
| 2024-11 | Collaborative over admin-only | Family members can all contribute photos |

---

## Questions to Resolve

1. **Photo display**: Map markers? Lightbox? Timeline? (needs experimentation)
2. ~~**EXIF extraction**: Client-side (before upload) or server-side (after upload)?~~ → **Resolved**: Client-side using `exifr` library
3. **Thumbnail generation**: On-demand vs at upload time?
