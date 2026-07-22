# Apple Platform Migration Plan

**Status:** Proposed (target architecture approved in principle)
**Decision:** Akashic becomes an iOS/iPadOS-first app built on Apple's platform services. The self-hosted backend (Supabase + Cloudflare) is fully decommissioned. The web app survives as a thin client. Apple vendor lock-in is an accepted trade-off.

This document supersedes the "Target Architecture" section of [ARCHITECTURE.md](./ARCHITECTURE.md) once migration begins.

---

## 1. Target Architecture (Målbilde)

```
                        ┌────────────────────────────────────┐
                        │        CloudKit container          │
                        │        iCloud.no.akashic           │
                        │                                    │
                        │  Private DB   ─ owner's journeys   │
                        │  Shared DB    ─ family access      │
                        │               (CKShare per zone)   │
                        │  Public DB    ─ showcase mirror    │
                        │               (metadata + thumbs)  │
                        └───────┬──────────────┬─────────────┘
                                │              │
                   CloudKit native SDK    CloudKit JS
                   (CKSyncEngine or       (Apple ID web sign-in)
                    NSPersistentCK)            │
                                │              │
                 ┌──────────────┴───┐   ┌──────┴───────────────┐
                 │  iOS/iPadOS app  │   │  Web app (existing   │
                 │  SwiftUI+MapKit  │   │  React SPA, thin     │
                 │  PRIMARY CLIENT  │   │  read-mostly client) │
                 │                  │   │                      │
                 │  App Intents ────┼─► │  GitHub Pages        │
                 │  (Siri/Shortcuts/│   │  (static hosting,    │
                 │   system MCP)    │   │   akashic.no)        │
                 └──────────────────┘   └──────────────────────┘

        Nothing is self-hosted. No servers, no workers, no database
        to operate. All data lives in CloudKit; all access control is
        enforced by Apple.
```

### Target stack

| Layer | Today | Target | Cost |
|-------|-------|--------|------|
| Auth | Supabase Auth (Google OAuth) | None on iOS (device Apple ID); CloudKit JS Apple ID sign-in on web | 0 |
| Database | Supabase PostgreSQL | CloudKit private + shared databases | 0 (developer) |
| Photo storage | Cloudflare R2 | CKAsset in owner's private DB | Owner's iCloud quota |
| Media access control | Cloudflare Worker (JWT proxy) | CloudKit built-in (share participants) | 0 |
| Web hosting | Cloudflare Pages | GitHub Pages (public repo → free) | 0 |
| DNS | Cloudflare DNS | Registrar DNS (Norid registrar, e.g. Domeneshop) | included in domain fee |
| Maps (iOS) | — | MapKit `.hybrid(elevation: .realistic)` | 0 |
| Maps (web) | Mapbox GL JS | Mapbox GL JS (unchanged; free tier) | 0 |
| AI/assistant integration | MCP Worker (JSON-RPC) | App Intents (Siri/Shortcuts today, system-level MCP when Apple ships it) | 0 |
| App distribution | — | TestFlight → App Store (unlisted or public) | Included in $99/yr |

### Total running cost

- Apple Developer Program: **$99/yr** (already paid)
- Domain `akashic.no`: ~150–200 NOK/yr at a Norid registrar (already paid)
- Owner's iCloud+ plan sized to photo library (photos count against the *owner's* personal iCloud quota; share participants consume nothing)
- Everything else: **0** — GitHub Pages/Actions are free for public repos; CloudKit developer quotas are free; MapKit is free in native apps

### Accounts/services eliminated

Supabase (project + auth + database), Cloudflare (Pages, R2, Worker, DNS), Google OAuth consent config.

---

## 2. Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **iOS/iPadOS-first**; web demoted to thin client | Family is on Apple devices; native unlocks offline, sharing UX, photo pipeline, widgets, Siri |
| D2 | **CloudKit private + shared DB** as the single source of truth | Zero hosted backend; CKShare maps 1:1 to the owner/editor/viewer model; storage rides on owner's iCloud plan |
| D3 | **Zone-per-journey sharing** | CKShare on a custom record zone shares the journey and all child records (waypoints, photos, comments) as one unit — mirrors today's `journey_members` semantics |
| D4 | **✅ DECIDED (2026-07-22): `CKSyncEngine` with custom record types** (`Journey`/`Waypoint`/`Photo`/`DayComment` per `apple/CloudKit/schema.ckdb`), zone-per-journey, Core Data as the local store | NSPCKC would generate its own `CD_`-prefixed schema in one zone — incompatible with the hand-authored schema, the imported record types, the web adapter's queries, and D3's zone-per-journey sharing. Everything built in Phase 0–1 is CKSyncEngine-shaped. Trade-off analysis: `apple/CloudKit/MAPPING.md` §12 |
| D5 | **✅ DECIDED (2026-07-22): MapKit** with realistic elevation — accepted the ~35° pitch clamp in exchange for tokenless native quality (real day/night globe, excellent terrain). Standing quality clause: if MapKit regresses or the pitch clamp becomes unacceptable in family use, fall back to Mapbox iOS SDK (free tier: 25k MAU) — the map layer is isolated so the swap is contained | The rotating globe is the app's signature; Spike B showed MapKit matches or beats Mapbox everywhere except the 55–60° oblique dive |
| D6 | **Web = read-mostly CloudKit JS client** | CloudKit JS supports Apple ID sign-in, private *and* shared DB access, and share acceptance — but the library is aging. Minimizing the web surface (viewing, light edits) keeps risk low while keeping akashic.no alive |
| D7 | **GitHub Pages for web hosting** | Repo is already public → Pages and Actions are free. The web app is a static bundle; photos come from CloudKit, so Pages' 1 GB site / ~100 GB/mo soft limits are irrelevant |
| D8 | **App Intents replace the MCP Worker** | Same tool surface (`list_journeys`, `get_journey_details`, …) exposed as App Intents: usable via Siri/Shortcuts immediately, and via Apple's system-level MCP bridge (in iOS/macOS 26.x betas) when it ships |
| D9 | **Public showcase via public DB mirror** | Public DB free quota scales per active user and is small for a family app — mirror only journey metadata + thumbnails for `is_public` journeys, never full-resolution photos |
| D10 | **Accept Apple lock-in; keep an export path** | Owner can export any journey as GPX + JSON + original photos from the native app. Exit cost stays low because the data is fundamentally portable formats |

---

## 3. CloudKit Data Model

### Container

- ID: `iCloud.no.akashic` (Development + Production environments)
- Schema managed via CloudKit Console / `cktool`; promoted Dev → Prod like DB migrations

### Zones and sharing

- One custom zone per journey in the **owner's private database**: `journey-<uuid>`
- The zone root record is the `Journey`; all child records live in the same zone
- Sharing = `CKShare` on the zone. Participants access it through their **shared database**
- Role mapping: `owner` → share owner · `editor` → participant `.readWrite` · `viewer` → participant `.readOnly`
- Invitations via `ShareLink`/`UICloudSharingController` (same UX as shared albums/Notes); web can accept shares via CloudKit JS

### Record types (from today's Postgres schema)

| Postgres table | CloudKit record type | Notes |
|----------------|---------------------|-------|
| `journeys` | `Journey` (zone root) | Scalar fields 1:1; `route`/`stats` JSONB → JSON-encoded `String`/`CKAsset` if large; `hero_image_url` → `heroImage: CKAsset` + `heroThumb: CKAsset`; `gpx_url` → `gpx: CKAsset` |
| `waypoints` | `Waypoint` | `journeyRef: CKRecord.Reference` (cascade delete); coordinates as `CLLocation` or lat/lon Doubles |
| `photos` | `Photo` | `original: CKAsset`, `thumb: CKAsset`; `waypointRef` optional reference; EXIF fields (takenAt, coordinates) as record fields |
| `day_comments` | `DayComment` | `waypointRef` reference; author = participant identity (`CKShare.Participant` / record `creatorUserRecordID`) — no separate profiles table needed |
| `journey_members` | *(eliminated)* | Replaced entirely by `CKShare` participants |
| `profiles` | *(eliminated)* | Participant names/avatars come from CloudKit user identities (with user permission) |

**Public showcase mirror** (public DB): `PublicJourney` record type — metadata + `heroThumb` + per-photo thumbs only. Written by the owner's native app when a journey is toggled public ("publish" step). Web reads it without sign-in via CloudKit JS + API token.

**Size constraints:** record field payloads should stay < ~1 MB (route JSON for long treks goes in a `CKAsset`); CKAssets themselves comfortably handle photo/GPX sizes.

---

## 4. Native App (primary client)

New top-level directory **`apple/`** in this repo (monorepo keeps docs/history together; can be split out later if Xcode/CI ergonomics demand it).

- **UI:** SwiftUI, iOS/iPadOS 17 minimum (required for `CKSyncEngine` and modern MapKit-in-SwiftUI APIs); Liquid Glass design language carries over naturally — it was modeled on Apple's own materials
- **Map:** `Map` with `.mapStyle(.hybrid(elevation: .realistic))`; camera choreography (globe → fly-in → route follow) rebuilt with `MapCamera`; route as `MapPolyline`, camps as annotations; elevation profile reuses the SVG logic as a Swift Charts view
- **Photos:** `PhotosPicker` import → on-device EXIF extraction (replaces `scripts/bulkUploadR2.ts` + `exif.ts`), on-device thumbnail generation, background upload to CloudKit
- **Sync:** per D4 — NSPersistentCloudKitContainer + CKShare by default; local store gives full offline support for free
- **App Intents:** `ListJourneysIntent`, `GetJourneyDetailsIntent`, `SearchJourneysIntent`, `GetJourneyStatsIntent`, `GetJourneyPhotosIntent` — mirroring the MCP Worker's tool surface
- **Extras unlocked later:** widgets (journey stats), Spotlight indexing, Handoff to web
- **CI:** GitHub Actions macOS runners (free on public repos) for build + unit tests
- **Distribution:** TestFlight during development (family = internal testers); App Store release, *unlisted* distribution being a good fit for a family app

---

## 5. Web App (thin client on GitHub Pages)

The React app survives with its UI intact; only the data layer changes.

### Data layer swap

The Supabase data layer is already isolated behind `src/lib/journeys/` (`journeyAPI`, `photoAPI`, `waypointAPI`, `memberAPI`, `commentAPI`) — swap its internals to a CloudKit JS adapter while keeping the exported interface:

- `src/lib/supabase.ts` → `src/lib/cloudkit.ts` (CloudKit JS bootstrap: container ID, environment, API token)
- Queries → CloudKit JS `performQuery`/`fetchRecords` against shared + private DBs
- `src/lib/media.ts` + `useMedia` → CKAsset `downloadURL`s (time-limited, direct from Apple; the JWT proxy logic is deleted)
- Auth UI: Supabase Google login → CloudKit JS Apple ID sign-in button (`ckSignInButton`); session persists via CloudKit JS cookie
- `memberAPI` → share metadata (participant list read-only on web; membership management stays native-only)

### Scope on web (read-mostly)

- ✅ Sign in with Apple ID; see all journeys shared with you
- ✅ Globe, routes, photos, stats, day-by-day view (Mapbox GL stays for the 3D globe)
- ✅ Light edits: captions, day comments
- ❌ Photo upload, route editing, member management, journey creation → native app (reduces surface against the aging CloudKit JS API; can be revisited)
- ✅ Public journeys viewable without sign-in via the public DB mirror

### GitHub Pages hosting

Repo is public → Pages is free with Actions-based deploys.

1. Replace the Cloudflare deploy in `.github/workflows/deploy.yml` with `actions/configure-pages` + `actions/upload-pages-artifact` + `actions/deploy-pages` (Pages "Source: GitHub Actions" mode; no `gh-pages` branch)
2. SPA routing (react-router): copy `index.html` → `404.html` in the build output (Pages' SPA fallback); delete `netlify.toml` (legacy)
3. PWA (`vite-plugin-pwa`) works unchanged on Pages — HTTPS is provided
4. Custom domain: `public/CNAME` containing `akashic.no` (Vite copies it into `dist/`), plus repo Settings → Pages → custom domain + Enforce HTTPS (Let's Encrypt)
5. Staging trade-off: Cloudflare's `staging.akashic.pages.dev` preview goes away. PR builds remain as CI artifacts; a preview environment can be added later via a second Pages site if missed

### DNS cutover (leaving Cloudflare entirely)

`.no` domains are registered at Norid-accredited registrars (Cloudflare Registrar does not support `.no`), so only DNS hosting moves — back to the registrar's own DNS (e.g. Domeneshop, free with the domain):

```
akashic.no      A     185.199.108.153 / 185.199.109.153 / 185.199.110.153 / 185.199.111.153
akashic.no      AAAA  2606:50c0:8000::153 / 8001::153 / 8002::153 / 8003::153
www.akashic.no  CNAME chaerem.github.io.
```

Lower TTL before cutover; verify HTTPS issuance after; then remove the Cloudflare zone.

---

## 6. Data Migration (one-time)

1. **Freeze & export**: Supabase → JSON dump per table (reuse patterns from `scripts/migrateToSupabase.js` in reverse); R2 → local photo archive (`wrangler`/`rclone`). Keep both sources read-only until verification passes
2. **Import**: a debug-only "Import" screen in the native app, signed in as the owner — reads the JSON + photo archive, creates zones/records/assets in the private DB, re-creates shares. (Alternative: `cktool` with a user token. Server-to-server web tokens only reach the *public* DB, so the import must run in a user context)
3. **Verify**: record counts per type, asset byte totals, spot-check checksums; family members confirm shared access on their devices
4. **Archive**: final export bundle (JSON + GPX + originals) stored offline as the pre-migration backup

---

## 7. Phased Roadmap

### Phase 0 — De-risking spikes (S)

The two genuinely uncertain pieces, both testable in an evening each:

- [ ] Create CloudKit container (Dev env) with a toy schema
- [ ] **Spike A — CloudKit JS**: static HTML page: Apple ID sign-in → read records from a *shared* zone → accept a share invitation on web. Proves D6
- [ ] **Spike B — MapKit globe/terrain**: SwiftUI prototype with one hardcoded journey: zoomed-out globe → fly-in → 3D terrain route. Compare against Mapbox side-by-side. Decides D5
- [ ] Decision gate: confirm D4 (NSPCKC vs CKSyncEngine) based on Spike B's codebase feel

### Phase 1 — Native MVP, read-only (M)

- [ ] `apple/` Xcode project, CI on macOS runners
- [ ] CloudKit schema (Section 3) in Dev environment
- [ ] Sync layer + local store; journey list, globe, day view, photo grid, stats (read-only)
- [ ] Manual import of one journey (Kilimanjaro) for development

### Phase 2 — Full data migration (S)

- [ ] Section 6 executed for all 3 journeys, photos, waypoints, comments
- [ ] Schema promoted to Production; family on TestFlight sees real data

### Phase 3 — Native editing + collaboration (M/L)

- [ ] CKShare invitations (ShareLink) + participant management
- [ ] Photo upload pipeline (PhotosPicker → EXIF → thumbs → CKAsset)
- [ ] Journey/waypoint/comment editing; day assignment
- [ ] App Intents layer (D8); export function (D10)

### Phase 4 — Web on CloudKit + GitHub Pages (M)

- [ ] CloudKit JS adapter behind `src/lib/journeys/` interface; remove `@supabase/supabase-js`
- [ ] Apple ID sign-in UI; read-mostly scope (Section 5)
- [ ] Public DB mirror + "publish" step in native app
- [ ] Pages workflow, `404.html` SPA fallback, `CNAME`, DNS cutover to registrar
- [ ] Delete `netlify.toml`

### Phase 5 — Decommission (S)

Only after ≥1 month of stable parallel running:

- [ ] Final archival export (Section 6.4)
- [ ] Delete Cloudflare Worker + R2 bucket + Pages project + DNS zone
- [ ] Delete Supabase project; retire Google OAuth consent config
- [ ] Remove `workers/`, `supabase/`, Supabase scripts from repo; prune GitHub secrets (`CLOUDFLARE_*`, `VITE_SUPABASE_*`)
- [ ] Rewrite ARCHITECTURE.md to describe the CloudKit architecture as current

### Phase 6 — Polish & App Store (ongoing)

- [ ] App Store (unlisted) release; widgets, Spotlight, Siri suggestions
- [ ] Watch for: SwiftData sharing support (simplify D4), Apple's system MCP GA (activate D8 fully), MapKit globe improvements (retire Mapbox on web?)

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| CloudKit JS is aging/frozen; Apple could sunset it | Web client breaks | Spike first (Phase 0); read-mostly scope keeps surface small; worst case web falls back to public-showcase-only or retires — native is unaffected |
| MapKit's zoomed-out globe doesn't match Mapbox's signature look | Core experience regresses | Spike B before committing; fallback = Mapbox iOS SDK (free tier is ~3 orders of magnitude above family usage) |
| SwiftData never gets sharing / NSPCKC+CKShare edge cases | Sync layer friction | NSPCKC+CKShare is Apple's documented path (Notes-style apps); CKSyncEngine as escape hatch with full control |
| Owner's iCloud quota fills up | Uploads fail for everyone | Owner sizes iCloud+ plan to library (50/200 GB tiers); app surfaces quota status; thumbnails aggressive |
| Public DB quota (scales per active user; small for a family app) | Public showcase throttled | Mirror metadata + thumbs only (D9); public web is a showcase, not the archive |
| CloudKit JS session-persistence quirks (known forum reports) | Web login friction | Handle re-auth gracefully; family primarily uses the native app |
| Non-Apple family member appears | Can't participate | Hard constraint of D2 — confirmed acceptable before Phase 1 |
| Migration data loss | Losing family memories | Sources frozen read-only until verified; offline archive before any deletion (Phase 5 gate) |
| Losing PR staging previews on Pages | Slower web QA | PR builds as artifacts; add a preview Pages site later if needed |

---

## 9. Open Questions

1. **Minimum OS**: iOS 17 vs 18 — check the oldest family device before Phase 1
2. **`route` JSONB size** for the longest trek — field vs CKAsset threshold (measure during Phase 2)
3. **Comments on web**: keep writable (current plan) or read-only?
4. **Repo layout**: `apple/` in monorepo (default) vs separate repo — revisit if Xcode + Actions ergonomics get noisy
5. **akashic.no for the app**: Universal Links (`apple-app-site-association` served from Pages) so shared journey links open the native app — nice Phase 6 addition

---

## 10. References

- CloudKit: [Designing with CloudKit](https://developer.apple.com/icloud/cloudkit/designing/) · [CKShare](https://developer.apple.com/documentation/cloudkit/ckshare) · [Shared records / zones](https://developer.apple.com/documentation/cloudkit/shared_records)
- Sync: [NSPersistentCloudKitContainer sharing](https://developer.apple.com/documentation/coredata/sharing_core_data_objects_between_icloud_users) · [CKSyncEngine](https://developer.apple.com/documentation/cloudkit/cksyncengine)
- Web: [CloudKit JS](https://developer.apple.com/documentation/cloudkitjs) · [CloudKit Web Services](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/index.html) · [CloudKit Catalog demo](https://cdn.apple-cloudkit.com/cloudkit-catalog/)
- Maps: [MapKit for SwiftUI (WWDC23)](https://developer.apple.com/videos/play/wwdc2023/10043/)
- Intents: [App Intents](https://developer.apple.com/documentation/appintents)
- Hosting: [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site) · [Publishing with Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- Tooling: [cktool](https://developer.apple.com/documentation/cloudkit/managing_icloud_containers_with_the_cloudkit_database_app)
