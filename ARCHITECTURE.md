# Akashic Architecture

Akashic is an iOS-first family-journey app. A SwiftUI app under [`apple/`](./apple) is the
primary and only editing client; a read-only static web showcase under [`src/`](./src) is the
face of `akashic.no`. **All data lives in Apple CloudKit.** There is no backend of ours, no
database to operate, and no server to run.

> **Read this before you delete anything.** This document describes what exists on
> **2026-07-28**. [`WORKPLAN.md`](./WORKPLAN.md) is the only authoritative statement of status;
> where the two disagree, the ledger wins. The `LEG-*` track in the ledger is the ordered
> decommission plan, and its dependency edges are load-bearing.
>
> The cutover has happened: **akashic.no resolves through Domeneshop DNS to GitHub Pages** and
> Cloudflare is out of the serving path. So `LEG-11A` (the Cloudflare Pages project and DNS zone)
> is now safe on the hosting side. What still gates deletion is **data, not serving**: `LEG-11B`
> waits on `LEG-02`/`LEG-03` because 5080 objects in R2 (12.21 GB) exist only there and in the
> local export, having never been imported. Deleting that bucket destroys the only two copies of
> real family photographs, and no amount of green CI tells you so.

---

## What is live right now

| Concern | What serves it | Status |
|---|---|---|
| Data (journeys, waypoints, photos, comments) | CloudKit container `iCloud.no.akashic` — private DB per family | **Live.** The only backend. |
| Identity / auth | The device Apple ID on iOS; CloudKit JS Apple ID sign-in on web; anonymous for public reads | **Live.** No account system of ours. |
| Photo bytes | `CKAsset` in the owner's private DB, on the owner's iCloud quota | **Live.** No object store of ours. |
| Access control | CloudKit itself — `CKShare` on a per-journey record zone | **Live.** Enforced by Apple, not by us. |
| Public journeys | A mirror in the container's **public** database, written by the app on publish | **Live.** Metadata + thumbnails only. |
| Assistant / automation | App Intents (Siri, Shortcuts) inside the app | **Live.** |
| Web maps | Apple MapKit JS for the journey view; our own tokenless canvas globe for the landing view | **Live. The replacement is done** — see the decision below. `MAP-03` moved the journey view, `MAP-02` replaced the globe with geometry we vendor ourselves, and `MAP-05` deleted Mapbox: 2707 lines of source and a 1 664 113-byte chunk out of the bundle. Journeys need a minted MapKit token; the globe needs none. |
| iOS app native maps | MapKit `.hybrid(elevation: .realistic)` | **Live, and staying.** Free, on-device, no token, no vendor. |
| Web fonts | **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`) — Roboto + Playfair Display | **Live, and missed by the first dependency audit** because that audit grepped the compiled JS and not `index.html`. Every visitor's IP reaches Google before any of the family's content renders, on a page whose selling point is that the data never leaves the owner's iCloud. `LEG-17` self-hosts them. |
| Web hosting | **GitHub Pages**, via [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml) | **Live.** Cut over 2026-07-27; `deploy.yml` (Cloudflare) is deleted. Only `main` may deploy — the `github-pages` environment restricts it. |
| DNS for `akashic.no` | **Domeneshop** (also the registrar) | **Live.** Zone rebuilt 2026-07-27: 4 apex A + 4 AAAA at GitHub Pages, `www` CNAME. Cloudflare DNS is redundant and awaiting deletion (`LEG-11A`). |

| Concern | Former owner | Status |
|---|---|---|
| Database | Supabase PostgreSQL | **Gone from the product, measured.** No package dependency (`@supabase/*` absent from `package.json`), nothing in `src/`, and **nothing in the built bundle** — verified by grepping `dist/assets/*.js`. What remains is migration tooling, not product: `supabase/` (19 SQL migrations, `LEG-13`) and three one-shot export scripts. The project is still switched on because `LEG-04`'s delta check needs it; `LEG-11B` deletes it. |
| Auth | Supabase Auth (Google OAuth) | **Retired from the code** (`T3.4`). Config still exists in the dashboards, pending deletion. |
| Photo storage | Cloudflare R2 (`akashic-media`) | **Retired from the code.** Bucket still holds the archive — and 5080 of its objects (12.21 GB) exist **only** there and in the local export, never having been imported. That is why `LEG-11B` waits on `LEG-02`/`LEG-03` rather than on a calendar. |
| Media access proxy | Cloudflare Worker | **Gone.** Deployment deleted (`LEG-01`, verified by Cloudflare edge error 1042); source removed from the repo (`LEG-12`). |
| Assistant API | MCP endpoint on the same Worker | **Gone with the Worker.** Replaced 1:1 by App Intents (D8); `Intents/JourneyQuery.swift` now holds the only copy of the tool defaults and clamps. |

### One map layer, swapped together (ARCH-01, 2026-07-27)

**The map is one architectural choice, not two.** Apple MapKit on both surfaces: the native app already
uses it, so alignment is reached by moving only the web.

If a different vendor ever fits better, the correct move is to swap **both surfaces as a single job** so
they cannot drift. That imposes a requirement on the web work rather than being a slogan: the map has to
sit behind an interface narrow enough that the next swap is one adapter. When this was written, `useMapbox.ts`
was 1810 lines with Mapbox concepts (`addLayer`, `setPaintProperty`, `setTerrain`) leaking through its own
surface, and three components imported Mapbox types directly — rebuilding that shape against MapKit would have
spent ten days to arrive at the same trap. `MAP-01` therefore came first, before any MapKit code.

**It paid out, and the number is worth recording.** `MAP-01` found that almost nothing was actually leaking:
one vendor type (`mapboxgl.LngLatBoundsLike`) across four files, and it was wider than the truth. The swap
that followed replaced the whole surface without touching `AkashicApp`, and `src/lib/map/boundary.test.ts`
now fails the build if anything reaches past the boundary again. That test is the durable part of this
decision — the prose above is why it exists.

**What the web gives up, measured rather than assumed.** An agent downloaded the shipped MapKit JS binary
(v5.81.65) and grepped it: `pitch` 0 hits, `tilt` 0, `globe` 0, `orthographic` 0. Apple's web map has no
3D and no globe at any price. So the web loses camera pitch, terrain relief, atmosphere and the blurred
glow on the active day. **Satellite imagery is kept** for the journey view — the screen a shared link
actually lands on — and the landing globe is drawn by us instead (`MAP-02`), which also means it survives
the day a MapKit token lapses.

**What was rejected.** A vendored-geometry or WebGL globe (14–14.5 d) never needs a token but abandons
satellite entirely, which is maximum divergence from the app. Dropping the web map is cheapest and
contradicts a product called "Your treks, on a living globe". Lowering *native* to a shared custom
renderer was proposed and was bad advice: MapKit on iOS is free, tokenless and already inside the
Apple-only constraint, so trading satellite and 3D terrain on the app's signature screen for cosmetic
parity with a shop window is the tail wagging the dog. Consistency is a means, not a goal.

**The dangerous part is the token** (`MAP-04`). It is public by design and protected by domain
restriction, not secrecy — that is fine. Its one-year maximum validity is not: there is no backend to
mint a replacement, so expiry breaks the journey map until a human pushes a build. A CI check that fails
below 14 days remaining is the feature, not a nicety, and a `schedule:` workflow must not be trusted to
rotate it — GitHub disables schedules after 60 days of repository inactivity, which is exactly the quiet
period the guard exists for.

The distinction in that second table is the whole point of it: **nothing in the shipped code
talks to any of those services any more, but several of them are still running and still
billable.** They are live resources awaiting an owner action, not architecture. See
[What this replaced](#what-this-replaced-history).

---

## System shape

```
                     ┌──────────────────────────────────────────┐
                     │      CloudKit container                  │
                     │      iCloud.no.akashic                   │
                     │                                          │
                     │  Private DB   one zone per journey       │
                     │               journey-<uuid>             │
                     │               + journey-<uuid>-media     │
                     │  Shared DB    the same zones, seen by    │
                     │               CKShare participants       │
                     │  Public DB    showcase mirror —          │
                     │               metadata + thumbs only     │
                     └────────┬───────────────────┬─────────────┘
                              │                   │
                   CKSyncEngine + CKDatabase   CloudKit JS
                   (native SDK, entitled       (Apple ID web sign-in,
                    build only)                 anonymous public reads)
                              │                   │
              ┌───────────────┴────┐   ┌──────────┴──────────────────┐
              │  iOS / iPadOS app  │   │  Web showcase (React SPA)   │
              │  SwiftUI + MapKit  │   │  READ-ONLY                  │
              │  PRIMARY CLIENT    │   │  viewing + day comments,    │
              │  the only writer   │   │  nothing else               │
              │                    │   │                             │
              │  App Intents ──────┼─► │  static bundle on           │
              │  (Siri/Shortcuts)  │   │  akashic.no                 │
              └────────────────────┘   └─────────────────────────────┘

     Nothing is self-hosted. No servers, no workers, no database to operate.
     All data lives in CloudKit; all access control is enforced by Apple.
```

---

## The CloudKit data model

### Container and schema

- Container: `iCloud.no.akashic`, with the usual Development and Production environments.
- The schema is **hand-authored** at [`apple/CloudKit/schema.ckdb`](./apple/CloudKit/schema.ckdb)
  and imported with `cktool`; Dev → Prod promotion is treated like a database migration. See
  [`apple/CloudKit/README.md`](./apple/CloudKit/README.md).
- The authoritative field-by-field mapping — including the historical Postgres correspondence
  that explains several field names — is [`apple/CloudKit/MAPPING.md`](./apple/CloudKit/MAPPING.md).

### Record types

| Record type | Database | Holds |
|---|---|---|
| `Journey` | private / shared | Zone root. Name, slug, country, dates, distance/days/summit, camera preferences, `centerLocation`, `statsJSON`, `routeJSON` (`CKAsset`), `heroImage`/`heroThumb`, `mediaShareURL` |
| `Waypoint` | private / shared | One per day/camp. `journeyRef`, coordinates, elevation, description, `highlights` (`LIST<STRING>`), and the day-content payloads `weatherJSON`, `funFactsJSON`, `pointsOfInterestJSON`, `historicalSitesJSON` |
| `Photo` | private / shared | Metadata plus `thumb` (`CKAsset`). `journeyRef`, optional `waypointRef`, `takenAt`, coordinates, `isHero`, rotation, media type |
| `DayComment` | private / shared | Per-day family comments; `content`, `createdAt`/`modifiedAt`, `authorDisplayName` |
| `PhotoMedia` | private / shared, **separate media zone** | The full-resolution `original` only. Never fetched by the sync engines |
| `PublicJourney` | **public** | The showcase mirror of one published journey: metadata, `statsJSON`, `routeJSON`, `waypointsJSON` (both `CKAsset`), `heroThumb` |
| `PublicPhoto` | **public** | One published thumbnail: `journeySlug`, `thumb`, caption, `takenAt`, `dayNumber`, `sortOrder` |

`journey_members` and `profiles`, the two Postgres tables that carried access control, have no
CloudKit equivalent and no replacement: `CKShare` participants *are* the membership model, and
participant identities come from CloudKit.

### Zones and sharing

- One custom zone per journey in the owner's private database: `journey-<uuid>`. The zone root
  record is the `Journey`; every child record lives in the same zone.
- Sharing is `CKShare(recordZoneID:)` — zone-level, not hierarchical. A hierarchical share
  would require every child to hold an owning reference back to the root, and CloudKit caps
  those at roughly 750 per record; Kilimanjaro alone has 939 photos. Zone-wide sharing has no
  equivalent limit. Full reasoning in [`apple/Docs/sharing.md`](./apple/Docs/sharing.md).
- Roles flatten CloudKit's (role, permission) pair to three the family recognises: **Owner**,
  **Can edit** (`.readWrite`), **Can view** (`.readOnly`). An unknown permission maps to
  viewer, never editor.
- `CKSyncEngine` binds to exactly one database, so participation needs **two engines** — one on
  the private database, one on the shared — with separate state files. `CDJourney.zoneOwnerName`
  routes each journey to exactly one of them; `nil` means "mine".

### Media: why originals live in their own zone

First sync used to mean pulling every original — 11.2 GB for the family archive. Photo
architecture v2 splits the bytes:

- `Photo.thumb` syncs with the metadata, so a fresh install is ~97 MB rather than ~11.2 GB.
- `PhotoMedia.original` lives in a **separate `journey-<uuid>-media` zone that both sync
  engines deliberately exclude from every fetch**, and is read on demand by record name via
  `CKDatabase.records(for:)`. Writes and deletes go direct through `CKDatabase` (chunked
  `modifyRecords`), never through the engine, so the engine's bookkeeping stays purely
  metadata.
- The media zone gets its own `CKShare`, whose URL is published on `Journey.mediaShareURL` so a
  participant accepting a journey auto-accepts its media. A participant who cannot accept it
  degrades to thumbnails with a quiet log, never a dialog.

The seam is [`apple/Akashic/Media/MediaDatabase.swift`](./apple/Akashic/Media/MediaDatabase.swift);
`MAPPING.md` §13 is the specification.

### The public showcase mirror

Publishing is an explicit owner action. The app writes `PublicJourney` + `PublicPhoto` records
into the container's public database
([`apple/Akashic/Sync/PublicMirrorPublisher.swift`](./apple/Akashic/Sync/PublicMirrorPublisher.swift)),
reconciles stale photos, and can unpublish. One rule has its own tests: **originals never leave
the private database** — the publisher refuses `Photo.thumbnailFileURL`'s display-time fallback
to original bytes. Only thumbnails and the story go out.

> **The public database is billed to us, not to the customer.** Private-database traffic rides
> on the user's own iCloud; the public mirror does not. Anything that increases showcase traffic
> has a real cost line. This is the one place where the "no servers, no costs" story has a
> caveat.

---

## The native app (`apple/`)

The primary client and the only writer. Start at [`apple/README.md`](./apple/README.md), which
covers the XcodeGen setup, persistence modes, the sync layer file-by-file, and the activation
path for an entitled build.

The shape, briefly:

- **Local store** is Core Data (on-disk SQLite). CloudKit is a sync peer, not the store.
- **Sync** is `CKSyncEngine` with custom record types (decision D4), one zone per journey.
  [`apple/Akashic/Sync/RecordCoder.swift`](./apple/Akashic/Sync/RecordCoder.swift) is the single
  domain ↔ `CKRecord` contract, shared with the importer, written to `schema.ckdb` exactly.
  [`apple/Akashic/Sync/AkashicSyncEngine.swift`](./apple/Akashic/Sync/AkashicSyncEngine.swift)
  is the coordinator, behind a `SyncEngineProtocol` seam so the whole layer is unit-testable
  against a mock engine.
- **Conflict policy** is last-writer-wins, server-authoritative. On a send conflict the local
  edit is rebased onto the server record so the resend carries the correct change tag.
- **`NSPersistentCloudKitContainer` was rejected**, not merely unused: it generates its own
  `CD_`-prefixed schema in the single default zone, which would invalidate the hand-authored
  schema, the imported records, the web adapter's queries, and zone-per-journey sharing all at
  once. `MAPPING.md` §12 has the trade-off analysis.
- **The entitlement is the first safety gate, not the account check.** A `CKContainer`
  instantiated in a binary *without* `com.apple.developer.icloud-services` traps (SIGTRAP). So
  every CloudKit touchpoint sits behind `#if AKASHIC_CLOUDKIT_BUILD`, a compilation condition
  defined only by the signed `Debug-CloudKit` / `Release-CloudKit` configurations. In a default
  build the sync layer compiles but never constructs a container.
- **Paid tier**: a one-time non-consumable IAP verified with StoreKit 2. The capability rules
  live in exactly one place,
  [`apple/Akashic/Store/Entitlements.swift`](./apple/Akashic/Store/Entitlements.swift) — free is
  one owned journey and 100 photos per owned journey, and that journey is fully finishable
  (publishing and export are **not** gated on any tier). Shared-in content is never gated.

### Assistant integration (App Intents)

[`apple/Akashic/Intents/`](./apple/Akashic/Intents) reproduces the retired MCP Worker's
five-tool surface 1:1 as App Intents — `list_journeys`, `search_journeys`,
`get_journey_details`, `get_journey_stats`, `get_journey_photos` — including the exact JSON wire
shapes, so Siri, Shortcuts and a future system-level MCP bridge all hit one query surface.
Every intent goes through `JourneyStore` → `PersistenceController`, never straight to Core Data.

---

## The web showcase (`src/`)

A React 19 + TypeScript + Vite single-page bundle. Apple MapKit JS draws the journey map; the landing
globe is ours, a 2D canvas over vendored public-domain coastline geometry with no token and no tile
service, so the first screen cannot fail on a credential. CloudKit JS is the data layer: Apple ID sign-in for the family (private and shared databases),
anonymous reads against the public database for everyone else.

**It is read-only.** As of 2026-07-26 every capability that mutates a journey is native-only.
[`src/lib/nativeOnly.ts`](./src/lib/nativeOnly.ts) is the one place that decides this, and it is
a constant rather than a flag on purpose: every mutating function in the CloudKit adapter is
already a warn-and-return-false stub, pinned by
[`src/lib/journeys/adapters/cloudkit/writeStubs.test.ts`](./src/lib/journeys/adapters/cloudkit/writeStubs.test.ts).
A web control that offered a write could not perform one — it could only *look* like it had. So
the affordances are gone, replaced by a native-only notice, and any code path that still reaches
an upload or delete throws rather than resolving.

Day comments and caption edits are the deliberate exception, and they round-trip live.

```
src/
├── components/       AkashicApp, AuthGuard, MapSurface (picks AkashicGlobe or
│                     MapKitJourneyMap by view), and feature folders
│                     (home, trek, journey, photos, comments, public, layout, nav, ui)
├── contexts/         AuthContext, JourneysContext, ThemeContext
├── hooks/            useTrekData, usePhotoDay,
│                     usePhotoOriginals, useMedia, useOnlineStatus, gesture hooks
├── lib/              cloudkit.ts (CDN load + auth facade), journeys/ (API + CloudKit
│                     adapters), map/ (vendor-neutral contract + mapkit/ adapter),
│                     globe/ (the tokenless landing globe), media.ts, nativeOnly.ts, exif.ts
├── styles/           liquidGlass.ts design tokens
├── types/            shared TypeScript types
└── utils/            dates, formatting, geography, routeUtils, stats, countryFlags
```

### Media URLs on the web

There is nothing to sign and nothing to proxy. CloudKit hands back complete, pre-authenticated
`CKAsset` download URLs, so [`src/lib/media.ts`](./src/lib/media.ts) passes absolute URLs
through untouched and resolves everything else to `''`. There is no relative-path fallback: the
schema declares no URL strings on `Photo` (only `original`/`thumb` assets), so no record can
carry a relative object path. Removing the fallback retired the last source reference to the
media Worker *before* the Worker is deleted, which is the only order that cannot break.

### UI conventions

The web UI follows Apple's "Find My" pattern — full-screen map with a draggable bottom sheet
(snap points at 10 / 45 / 88 vh, velocity-based spring snapping, scroll locking, safe-area
aware). Content modes are `day`, `photos`, `stats` and `info`. The visual language is the
"Liquid Glass" token set in `src/styles/liquidGlass.ts` over shadcn/ui primitives.

The rapid-day-switching behaviour is worth knowing about because it looks like a bug when it
regresses: every day switch cancels **all** pending camera work (`map.stop()`, RAF callbacks,
style-load handlers, timeouts) and re-verifies that the selection has not changed before
applying camera movement or route highlighting. `isStyleLoaded()` returns `false` during
`fitBounds`/`flyTo`, so checking it invents problems; once `mapReady` is true the style is
loaded. That was the Mapbox surface, deleted in `MAP-05`; the same class of race is handled on MapKit by
[`src/lib/map/mapkit/cameraQueue.ts`](./src/lib/map/mapkit/cameraQueue.ts), which exists precisely because
MapKit has no `map.stop()` to make the problem disappear.

---

## Hosting and DNS

**Today:** `akashic.no` resolves through **Domeneshop DNS** to **GitHub Pages**, deployed on every
push to `main` by [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml).
The site serves HTTPS on its own certificate. `deploy.yml` (Cloudflare) is deleted and Cloudflare
is out of the serving path entirely.

`public/CNAME` carries `akashic.no` — but note that with `build_type: workflow` it does **not** set
the custom domain; that lives in Settings → Pages and is set. `404.html` is copied from
`index.html` in CI and never committed (the app has no client-side router — navigation is
`?journey=&day=` query params). `public/.nojekyll` is load-bearing and easy to mistake for
clutter: without it Pages serves **no path beginning with a dot**, which silently 404s
`/.well-known/apple-app-site-association` and kills every Universal Link while every build-side
check stays green. `deploy-pages.yml` asserts the served file after deploying, because nothing on
the build side can see this.

Only `main` may deploy — the `github-pages` environment carries a deployment branch policy, so a
`workflow_dispatch` run from a branch builds successfully and then fails at the deploy job. That is
a permissions setting, not a broken workflow.

**What remains** is `LEG-11A`/`LEG-11B`: deleting the now-unused Cloudflare Pages project and DNS
zone, and `LEG-10B`, revoking the four dead credentials. Both are owner tasks. The historical
cutover sequence is kept in
[`docs/github-pages-cutover.md`](./docs/github-pages-cutover.md).

---

## Environment variables

The web bundle needs two things and no secrets of ours. See [`.env.example`](./.env.example).

```env
VITE_MAPKIT_TOKEN=…            # journey map only — mint with scripts/mapkit/devToken.mjs.
                               # The landing globe needs NO token, so an unset value degrades
                               # to an error card on journeys and nothing else.
VITE_CLOUDKIT_ENV=development  # 'development' (default) | 'production'
VITE_CLOUDKIT_API_TOKEN=…      # container-scoped, public — for anonymous public-DB reads
VITE_E2E_TEST_MODE=true        # optional — disables auth for Playwright
```

CloudKit JS itself is loaded from Apple's CDN. There are no Supabase, R2 or Worker variables
left in the code; the `VITE_MEDIA_URL` line still present in `.env.example` is dead and should
go with the Worker.

CI secrets still in use: `MAPKIT_PRIVATE_KEY` (the Apple `.p8`, plus the `MAPKIT_KEY_ID` and
`MAPKIT_TEAM_ID` repo *variables*) — `deploy-pages.yml` and `e2e.yml` mint a fresh token per run rather
than storing one, so the token's lifetime is never load-bearing. `VITE_MAPBOX_TOKEN` is no longer read by
any workflow after `MAP-05`; **revoking the Mapbox account key itself is the owner's outstanding task**,
and `scripts/mapkit/imagery-compare/` is the one thing that still uses it. `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` are read by nothing now that `deploy.yml` is deleted — they are still
*present* in the repository settings, and `LEG-10B` is the owner task that deletes them and then
revokes the tokens at the provider. Those are two separate acts: deleting the secret stops CI from
holding the credential, revoking is what makes the credential dead, and only the second one matters
if it has already leaked.

---

## Testing

| What | Command | Expected |
|---|---|---|
| Web unit tests | `npx vitest --run` | 406 tests (measured 2026-07-26) |
| Web build | `npm run build` | ~4 s, no env needed |
| Web e2e | `VITE_E2E_TEST_MODE=true CI=true npx playwright test --project=chromium --ignore-snapshots` | needs `.env.local` |
| Native build + tests | see [`CLAUDE.md`](./CLAUDE.md) for the full invocation | — |
| Ledger | `npm run workplan:check` | ok |

**[`CLAUDE.md`](./CLAUDE.md) is the maintained list — prefer it over this table**, which will
drift. It carries the exact native invocation and its expected counts, which commands currently
fail and why (web typecheck does; three quality gates are open at once, which is how that
happened), and which commands must never be run because they mutate things or need the owner's
credentials.

E2E tests run with `VITE_E2E_TEST_MODE=true`, which disables auth. `window.testHelpers` — owned by
`MapSurface` since `MAP-03`, because two surfaces cannot both register the same global without racing —
exposes `selectTrek`, `getTreks`, `selectDay`, `getCurrentDay`, `getCamps`, `isMapReady`, `isDataLoaded`
and `getMapState` for programmatic control. Specs live in [`e2e/`](./e2e). The journey specs need a minted
`VITE_MAPKIT_TOKEN` and are not registered without one; see [`playwright.config.ts`](./playwright.config.ts).

---

## Cost, and the exit

Running cost is close to zero by construction:

- Apple Developer Program **$99/yr**; `akashic.no` ~150–200 NOK/yr. Both already paid.
- CloudKit private-database storage is the **user's own iCloud quota** — a large photo archive
  may need an iCloud+ plan, which the onboarding says plainly because discovering it later is a
  refund and a one-star.
- Share participants consume nothing of their own.
- GitHub Pages/Actions are free for public repos; MapKit is free in native apps.
- The public showcase database is the one line billed to us (see above).

**The exit door is built in and shipped**, which is what makes accepting Apple lock-in
defensible (decision D10): any journey exports from the app as GPX + JSON + every original
photo, via [`apple/Akashic/Export/`](./apple/Akashic/Export). GPX and JSON open anywhere. The
data is portable formats all the way down; only the sync mechanism is Apple's.

---

## What this replaced (history)

Everything below is **historical**. It is here because it explains why several things are
shaped the way they are, and because the decommission is not finished — some of these services
are still switched on. None of it is current architecture.

Akashic was built twice before this. The relevant residue:

| Was | Became | Why the shape survives |
|---|---|---|
| Supabase PostgreSQL (`journeys`, `waypoints`, `photos`, `day_comments`, `journey_members`, `profiles`) | CloudKit record types | CloudKit field names still mirror the Postgres columns 1:1 — that is deliberate, and `MAPPING.md` is the mapping. The migrations are still in [`supabase/migrations/`](./supabase/migrations) as the reference for what the old schema *was* (`LEG-13` deletes them) |
| Supabase Auth (Google OAuth), `journey_members` + RLS policies | The device Apple ID; `CKShare` participants | The owner/editor/viewer trio in the UI is the old role model, kept because it survived contact with the family |
| Cloudflare R2 (`akashic-media`), paths `journeys/{journey_uuid}/photos/{photo_id}.jpg` | `CKAsset` on `Photo`/`PhotoMedia` | Record names are the **original Postgres UUIDs**. The importer preserved them precisely because they were the R2 path keys, and preserving them made the import idempotent |
| Cloudflare Worker `media-proxy` — Supabase JWT verification via JWKS, membership checks, public-journey bypass | Nothing. CloudKit asset URLs are pre-authenticated | The Worker's job does not exist any more; there is no proxy to replace it with |
| The same Worker's `/mcp` JSON-RPC endpoint (5 tools) | App Intents (D8) | The intents reproduce the wire shapes exactly, including snake_case keys and the string-typed stat fields, so an MCP bridge can be dropped in front of them |
| Auth0 | Supabase Auth, then nothing | Gone twice over |
| Netlify | Cloudflare Pages, then GitHub Pages | Gone twice over |

**The data rescue.** The Supabase project was *paused*, not deleted, and was resumed on
2026-07-21. A full export followed — Postgres (3 journeys, 18 waypoints, 1538 photos) plus a
complete R2 archive (8147 objects, 16.41 GB), verification passed, bundle held offline. The
tooling is [`scripts/export/`](./scripts/export) (do not run `verifyExport.ts`: it overwrites
the dated report inside the archive bundle). The archive being duplicated onto a second
physical medium (`LEG-02`) is a hard gate on every deletion.

**The import.** The family archive went into **Production** as 1559 `CKRecord`s of all types
(3 journeys + 18 waypoints + 1538 photos) carrying 3070 `CKAsset`s (1538 originals + 1529
thumbnails + 3 journey heroes), with 0 failures. Verified live and written up in
[`apple/Docs/sync-verification.md`](./apple/Docs/sync-verification.md); the browser-side
verification is [`docs/cloudkit-js-verification.md`](./docs/cloudkit-js-verification.md).

**Still running, still billable, awaiting an owner action** — the Cloudflare Worker, the R2
bucket, the Cloudflare Pages project, the Cloudflare DNS zone, the Supabase project and the
Google OAuth config. `LEG-01` (the Worker) is independent of every gate. The rest are ordered in
the ledger for a reason; the ordering is in the note at the top of this file.

---

## Related documents

- [`WORKPLAN.md`](./WORKPLAN.md) — the only authoritative statement of what is done
- [`CLAUDE.md`](./CLAUDE.md) — working agreement, verified commands, and the traps that have
  already cost real time
- [`APPLE-MIGRATION-PLAN.md`](./APPLE-MIGRATION-PLAN.md) — the target architecture and the
  numbered decisions D1–D10 referenced throughout this file
- [`APPLE-MIGRATION-TASKS.md`](./APPLE-MIGRATION-TASKS.md) — the migration task breakdown and
  what remains (operator work only)
- [`APPLE-MIGRATION-RUNBOOK.md`](./APPLE-MIGRATION-RUNBOOK.md) — the manual steps only the owner
  can do
- [`COMMERCIALIZATION-PLAN.md`](./COMMERCIALIZATION-PLAN.md) — the v1.0 product and business plan
- [`apple/README.md`](./apple/README.md) — the native app in detail
- [`apple/CloudKit/MAPPING.md`](./apple/CloudKit/MAPPING.md) — the authoritative schema mapping
- [`apple/Docs/DESIGN-PLAN.md`](./apple/Docs/DESIGN-PLAN.md) — the design and submission review
- [`docs/store/app-store-listing.md`](./docs/store/app-store-listing.md) — store metadata
- [`docs/history/ROADMAP.md`](./docs/history/ROADMAP.md) — the archived pre-migration roadmap
  (historical; superseded by `WORKPLAN.md`)
