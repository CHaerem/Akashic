# Akashic — iOS/iPadOS app

Native SwiftUI client for Akashic — the primary client, not a companion. The signature
globe → fly-in → day-navigation map experience, day content (weather, fun facts, POIs,
historical sites), photo grid/lightbox with map markers, interactive elevation profiles +
full stats, day comments, App Intents (D8), live Spotlight indexing, a stats widget
(dormant until the App Group is enabled), CKShare family sharing, per-journey export
(GPX + JSON + photos) and showcase publishing.

**Journeys can be created here**, from four route sources: GPX import (Strava/Garmin/
AllTrails/komoot), inference from photo GPS, **drawn by hand on the map**, or no route at
all. Days seed from GPX waypoints or photo-date clusters; place names, POIs and historical
weather are suggested and accepted one by one; **Akashic Intelligence** (on-device
Foundation Models, iOS 26 + Apple Intelligence + Complete) drafts day notes and day names
without a byte leaving the device. Everything is correctable after the fact — route, days,
day content, photo↔day assignment, and deletion.

> **Status (2026-07-25):** the migration is done. **D4: custom `CKRecord` sync via
> `CKSyncEngine`, one custom zone per journey, Core Data as the local store** (Option A in
> `CloudKit/MAPPING.md` §12), verified live against the real container
> (`Docs/sync-verification.md`), with the family archive imported into **Production**
> (1559 records / 3070 assets / 0 failures). Photo architecture v2 keeps first sync to
> thumbnails and streams originals on demand (97 MB fresh install, not 11.2 GB). Sync only
> *runs* in an entitled `*-CloudKit` build signed into iCloud — see
> [Activating CloudKit sync](#activating-cloudkit-sync).
>
> Product work is now v1.0 commercialization: free tier + one-time unlock (StoreKit 2),
> consumer onboarding, store assets. See [`COMMERCIALIZATION-PLAN.md`](../COMMERCIALIZATION-PLAN.md)
> and W7 in [`APPLE-MIGRATION-TASKS.md`](../APPLE-MIGRATION-TASKS.md). **560 unit tests, CI green.**

---

## Requirements

- Xcode 16 or newer (built and verified on Xcode 26.6 / iOS 26 SDK; deployment target **iOS 17.0**).
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) — `brew install xcodegen`.

The `.xcodeproj` is **generated** and git-ignored. `project.yml` is the source of truth.

## Generate & open

```bash
cd apple
xcodegen generate
open Akashic.xcodeproj
```

## Build & test from the CLI

Simulator builds require **no signing team** (`CODE_SIGNING_ALLOWED=NO`):

```bash
cd apple

# Build
xcodebuild -project Akashic.xcodeproj -scheme Akashic \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO build

# Unit tests (the AkashicTests suite: fixture decoding, per-day stats,
# Core Data round-trip, and App Intent wire shapes)
xcodebuild -project Akashic.xcodeproj -scheme Akashic \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO test
```

CI runs the same steps on every push/PR touching `apple/**` — see
[`.github/workflows/apple-ci.yml`](../.github/workflows/apple-ci.yml).

## Run on fixtures (default)

Just build & run the `Akashic` scheme on a simulator. The app boots in **Fixtures** mode:
an in-memory Core Data store seeded from `Fixtures/recovered/*.json` (Kilimanjaro, Mount
Kenya, Inca Trail). No account, network, or entitlements needed.

### Screenshot / UI-test seam

The app reads two launch environment variables (used for the screenshots in `Docs/`):

| Variable | Effect |
|----------|--------|
| `AKASHIC_TAB=0..2` | Select the tab: 0 Explore (globe) · 1 Stats · 2 Settings |
| `AKASHIC_EMPTY=1` | Start with no journeys — the state a new customer sees on first launch |
| `AKASHIC_OPEN=<slug or id>` | Open that journey's detail |
| `AKASHIC_FORCE_LOCAL=1` | Force the on-disk `.local` store before the store is built |
| `AKASHIC_IMPORT_ON_LAUNCH=1` | Run the export import at startup (see below) |
| `AKASHIC_IMPORT_PATH=<dir>` | Export bundle path (default `Config.importBundlePath`) |
| `AKASHIC_MEDIA_ROOT=<dir>` | Media root (default `<bundle>/r2/objects`) |
| `AKASHIC_IMPORT_RESET=1` | Clear the fixture seed before importing (clean demo) |
| `AKASHIC_SCREEN=photos` | Deep-link to the imported-photos journey list |
| `AKASHIC_SCREEN=photogrid` + `AKASHIC_PHOTOS_JOURNEY=<id>` | Deep-link to a journey's thumbnail grid |

```bash
UDID=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)
SIMCTL_CHILD_AKASHIC_OPEN=kilimanjaro \
  xcrun simctl launch --terminate-running-process "$UDID" no.akashic.app
xcrun simctl io "$UDID" screenshot Docs/screenshot-journey-detail.png
```

Screenshots live in [`Docs/`](Docs). The real-data screenshots are `Docs/screenshot-real-{list,detail,photos}.png`.

## Import real data from a Supabase export (T2.12; groundwork for the CloudKit importer T2.5)

The `Import/` module reads a Supabase JSON export (the `supabase/*.json` dump + the R2 media
tree) and upserts it into the **local Core Data store**, preserving every original Postgres
UUID. It is the tonight/on-device counterpart to the CloudKit importer (T2.5), which reuses
the same reader + transform behind a different write sink.

**Pipeline (all in `Akashic/Import/`):**

```
ExportBundle  →  ExportMapper       →  ImportSink            →  ImportReport
(read *.json)    (rows → Journey/     (CoreDataImportSink now;
                  Photo, sink-free)    CloudKitImportSink T2.5)
```

- **`ExportBundle`** — tolerant `Decodable` structs for the 6 tables (`profiles`, `journeys`,
  `journey_members`, `waypoints`, `photos`, `day_comments`). Unknown columns are ignored;
  dates stay ISO strings; `GeoCoordinate` normalizes the **two** coordinate encodings (GeoJSON
  `Point` object *and* bare `[lng, lat]` array). Decoded with `.convertFromSnakeCase`.
- **`ExportMapper`** — pure rows → domain `Journey`/`Camp`/`Photo`. Recomputes per-day route
  stats via `DayStats`. Resolves each photo's R2 path (`journeys/{jid}/photos/{pid}.jpg`) to an
  on-disk file under the **media root** (existence-checked; missing bytes tolerated).
- **`LocalImporter`** — idempotent orchestrator (`run(exportRoot:mediaRoot:)`): journeys +
  waypoints first, then photos linked to them. Re-running updates in place (no duplicates) and
  returns an `ImportReport` (journeys/waypoints/photos created·updated·skipped, thumbs/originals
  on disk, missing-media count). The `ImportSink` protocol is the only piece the CloudKit
  importer must replace.
- **`PhotoDayMatcher`** — the web's `usePhotoDay.ts` 4-tier day matcher, ported 1:1: explicit
  `waypoint_id` → date-vs-`dateStarted` → route proximity (< 2 km) → nearest camp (< 5 km).
- **Core Data** — `CDPhoto` gained `localOriginalPath` / `localThumbPath` (optional strings,
  CloudKit-compatible) holding the resolved on-disk paths so views build a file `URL` without
  knowing where the export lives (`Photo.thumbnailFileURL` / `.originalFileURL`).

**From the app:** Settings → *Import from export bundle* — set the export path + media root
(defaults work in the Simulator, which reads host paths directly), tap Import, watch progress,
and browse the imported photo grid. For results that persist and show photos, switch the store
to **Local** first and relaunch.

**Headless / scriptable demo** (imports the real export, then screenshots):

```bash
UDID=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)
# 1. Force local, wipe the fixture seed, import the real export at launch:
SIMCTL_CHILD_AKASHIC_FORCE_LOCAL=1 SIMCTL_CHILD_AKASHIC_IMPORT_ON_LAUNCH=1 \
SIMCTL_CHILD_AKASHIC_IMPORT_RESET=1 \
SIMCTL_CHILD_AKASHIC_IMPORT_PATH=/Users/cher/Privat/AkashicExport-20260722 \
  xcrun simctl launch --terminate-running-process "$UDID" no.akashic.app
# 2. Deep-link to a journey's real photo grid:
SIMCTL_CHILD_AKASHIC_FORCE_LOCAL=1 SIMCTL_CHILD_AKASHIC_SCREEN=photogrid \
SIMCTL_CHILD_AKASHIC_PHOTOS_JOURNEY=e27c89f6-8d7f-4b30-a0c9-54fe44e01a9b \
  xcrun simctl launch --terminate-running-process "$UDID" no.akashic.app
xcrun simctl io "$UDID" screenshot Docs/screenshot-real-photos.png
```

`ImportTests` covers the reader + importer against tiny inline fixtures and (filesystem-gated,
skipped when absent) the real export dir; `PhotoDayMatcherTests` covers all four matching tiers.

## Switch persistence modes

The store mode resolves from `Config.resolvedPersistenceMode`:

1. A **debug override** in `UserDefaults` (Settings tab → Persistence mode). Applies on relaunch.
2. Otherwise `FeatureFlags.cloudKitEnabled` → `.cloudKit`, else `.fixtures`.

| Mode | Store | Seeded? |
|------|-------|---------|
| `.fixtures` | in-memory SQLite (`/dev/null`) | yes, from fixtures |
| `.local` | on-disk SQLite | seeded once if empty |
| `.cloudKit` | on-disk SQLite (same as `.local`) **+ `AkashicSyncEngine` (`CKSyncEngine`)** → `iCloud.no.akashic` private DB, one custom zone per journey | no — data arrives via import + sync |

## The sync layer (`Akashic/Sync/`)

D4 is **decided**: custom `CKRecord` sync via **`CKSyncEngine`** (iOS 17+), one custom zone per
journey, Core Data as the local store — Option A in
[`CloudKit/MAPPING.md`](CloudKit/MAPPING.md) §12. The retired
`NSPersistentCloudKitContainer` (NSPCKC) placeholder is gone; NSPCKC would have generated an
incompatible `CD_`-prefixed schema in the single default zone, invalidating `schema.ckdb` and
the web adapter's queries. The layer is built to the hand-authored
[`schema.ckdb`](CloudKit/schema.ckdb) (verified byte-for-byte against the live Development
container).

| File | Responsibility |
|------|----------------|
| `Sync/RecordCoder.swift` | Bidirectional domain ↔ `CKRecord` mapping, **exactly** per `schema.ckdb`/`MAPPING.md`: field names, `LOCATION` `[lng,lat]`→`(lat,lng)` swap, `routeJSON` ASSET, JSON-string payloads, `highlights` `LIST<STRING>`, reference delete actions, recordNames = original UUIDs, zone `journey-<uuid>`. **Shared with the importer** (`Import/CloudKitImportSink.swift`) as the one (de)serialization contract. |
| `Sync/AkashicSyncEngine.swift` | The coordinator (a `CKSyncEngineDelegate`) behind a `SyncEngineProtocol` seam. Account-gated activation, initial upload, pending-change enqueue, fetched-change apply, zone-deletion, and conflict handling. Delegate callbacks are thin adapters over plain, unit-tested methods. |
| `Sync/SyncSeam.swift` | `SyncEngineProtocol` (mockable engine) + `CKSyncEngineAdapter` (real) + `SyncLocalStore` (mockable local store) + `LocalChange`. |
| `Sync/SyncScheduler.swift` | Observes `NSManagedObjectContextDidSave` and forwards local writes as pending changes — zero edits to the persistence write methods. Suppresses the echo while remote changes are applied. |
| `Sync/PersistenceController+Sync.swift` | `SyncLocalStore` conformance: materialize a `CKRecord` from a stored row; apply a fetched record (server-authoritative, **per record** — never cascading to siblings, unlike the importer's whole-journey upsert). |
| `Sync/SyncStatus.swift` | Observable status the UI can surface + the `AccountStatusProviding` seam. |

**Conflict policy (chosen):** *last-writer-wins, server-authoritative.* Fetched server records
overwrite the local copy; on a send conflict (`serverRecordChanged`) the local edit is **rebased
onto the server record** (our field values copied onto it) so the resend carries the correct
change tag and our latest values win. Future refinement (documented TODO, not built): field-level
merge keyed on the domain edit timestamps the app already keeps (`DayComment.modifiedAt`,
`Journey.updatedAt`).

> [!IMPORTANT]
> **A `CKContainer` instantiated in a binary WITHOUT the `com.apple.developer.icloud-services`
> entitlement traps (SIGTRAP).** So the runtime account check cannot be the first safety gate —
> the entitlement is. Every `CKContainer`/`CKSyncEngine` touchpoint is behind
> `#if AKASHIC_CLOUDKIT_BUILD`, a compilation condition defined **only** by the signed
> `Debug-CloudKit` / `Release-CloudKit` configs. In the default Debug/Release build the sync
> layer compiles but never constructs a container: `startSync()` no-ops, the status row shows
> "Rebuild with the CloudKit configuration to sync", and `.cloudKit` mode just runs on the local
> store. This holds even if the user selects `.cloudKit` in Settings.

## Activating CloudKit sync

The layer runs only in an **entitled** build signed into iCloud. Nothing is tested end-to-end
until an iCloud account is signed into a simulator — the steps below are the activation path.

1. **Set a signing team.** `project.yml` already pins `DEVELOPMENT_TEAM: 9LVCB72DT8` on the
   `*-CloudKit` configs; override with `DEVELOPMENT_TEAM=XXXXXXXXXX` on the CLI if needed. Then
   `xcodegen generate`.
2. **Import the schema** to the container's Development environment (once):
   ```sh
   xcrun cktool import-schema --team-id 9LVCB72DT8 --container-id iCloud.no.akashic \
     --environment DEVELOPMENT --validate --file CloudKit/schema.ckdb
   ```
   (Already imported for `iCloud.no.akashic`; see [`CloudKit/README.md`](CloudKit/README.md).)
3. **Sign the Simulator into iCloud:** boot the sim → Settings app → *Sign in to your iPhone* →
   sign in with an Apple Account. (Simulator builds honor entitlements without provisioning, so
   no device is required.)
4. **Build the `Debug-CloudKit` configuration** and launch with `AKASHIC_CLOUDKIT=1`:
   ```sh
   UDID=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)
   xcodebuild -project Akashic.xcodeproj -scheme Akashic -configuration Debug-CloudKit \
     -destination "platform=iOS Simulator,id=$UDID" build
   xcrun simctl install "$UDID" "<DerivedData>/Build/Products/Debug-CloudKit-iphonesimulator/Akashic.app"
   SIMCTL_CHILD_AKASHIC_CLOUDKIT=1 \
     xcrun simctl launch --terminate-running-process "$UDID" no.akashic.app
   ```
   `AKASHIC_CLOUDKIT=1` selects `.cloudKit` mode for the run without flipping the build flag
   (permanent activation: `FeatureFlags.cloudKitEnabled = true`).
5. **What to expect.** On first launch with an available account, `AkashicSyncEngine.activate()`
   creates one custom zone per local journey (`journey-<uuid>`) and enqueues an initial upload of
   every `Journey`/`Waypoint`/`Photo`/`DayComment`. Local edits (via the existing edit UI) enqueue
   incremental changes automatically. The Settings status row reflects state
   (`Checking iCloud account…` → `Syncing with iCloud`). With **no** account signed in, the engine
   stays off and the app keeps working locally (status: `Sign in to iCloud to sync`).

### Two-simulator round-trip test (T2.4, later)

To verify real sync once accounts are available:

1. Boot two simulators; sign **both** into the **same** iCloud account.
2. Install the `Debug-CloudKit` build on both; launch both with `AKASHIC_CLOUDKIT=1`.
3. On sim A, import the export (or make an edit — e.g. rename a journey / add a day comment).
4. Wait for sim A's status to read `Syncing with iCloud`, then foreground sim B and pull to
   refresh / relaunch. The change should appear on B (server-authoritative apply).
5. Make a conflicting edit to the same record on both while briefly offline, then reconnect: the
   later write wins (last-writer-wins rebase). Inspect records in the CloudKit Console
   (`iCloud.no.akashic` → Data → the `journey-<uuid>` zone) to confirm field values + zones.

## Project layout

```
apple/
  project.yml                     XcodeGen spec (source of truth)
  Akashic/
    App/                          @main app, Config (modes/flags), JourneyStore, AppGroup
    Models/                       Domain value types, flexible decoding, DayStats (per-day route math)
    Import/                       T2.4: ExportBundle reader, ExportMapper, LocalImporter (+ sink
                                  seam), PhotoDayMatcher, ImportBrowserView (photo grid)
    Intents/                      App Intents (D8): 5 MCP-parity intents, JourneyEntity, stats calc
    Services/                     SpotlightIndexer, WidgetSnapshot(+Journey)/WidgetDataStore/
                                  WidgetPublisher, JourneyStatsWidgetView, WidgetGallery harness
    Fixtures/                     FixtureModels + FixtureLoader (old camp shape -> domain)
    Persistence/                  PersistenceController (modes incl. CloudKit), Core Data <-> domain mapping, JSON coders
      Akashic.xcdatamodeld        Core Data model (CloudKit-compatible; CDPhoto local media paths)
    Sync/                         D4 CloudKit sync: RecordCoder (domain<->CKRecord contract),
                                  AkashicSyncEngine (CKSyncEngine + seams), SyncScheduler, SyncStatus
    Views/                        SwiftUI: list, detail, stats, map, settings, theme
    Resources/                    Assets.xcassets (AppIcon placeholder, AccentColor)
    Support/                      Akashic.entitlements (Release-CloudKit only)
  AkashicWidgets/                 WidgetKit extension: JourneyStatsWidget + provider + placeholder
                                  (shares the WidgetSnapshot/view files from Akashic/Services)
  AkashicTests/                   XCTest: fixtures, day-stats, Core Data round-trip, import, day matcher,
                                  Spotlight items, widget snapshot/data-store
  Docs/                           Screenshots (incl. screenshot-widgets.png)
  Fixtures/recovered/             Input JSON (owned elsewhere; read-only here)
```

## Data model notes (Core Data ↔ CloudKit)

The Core Data model mirrors the **real Postgres schema** (authoritative mapping:
[`CloudKit/MAPPING.md`](CloudKit/MAPPING.md), derived from `supabase/migrations/`). The local
store is plain Core Data; `RecordCoder` maps each row to/from its custom `CKRecord` for sync:

- Every attribute is **optional or has a default**; **no unique constraints**; every
  relationship has an **inverse**; to-one relationships are optional (kept as CloudKit-friendly
  invariants).
- Delete rules mirror Postgres FKs: `journey → waypoints/photos/dayComments` **cascade**;
  `waypoint → photos` **nullify** (`photos.waypoint_id ON DELETE SET NULL`). The matching
  CloudKit `CKReference` delete actions are set by `RecordCoder` at write time
  (`.deleteSelf` / `.none`, per `MAPPING.md` §9).
- JSONB payloads (`route`, `stats`, `center_coordinates`, `coordinates`, `weather`,
  `fun_facts`, `points_of_interest`, `historical_sites`, `highlights`) are stored as **Binary**
  attributes holding JSON locally; `RecordCoder` re-encodes them per schema — `routeJSON` as a
  `CKAsset` (temp-file JSON), the rest as inline STRING fields, `highlights` as a native
  `LIST<STRING>`.
- The `route` JSON can exceed inline limits for a long trek; as a `CKAsset` its bytes stay lazy
  (`downloadURL`), keeping `Journey` records tiny so the list/globe query never drags every route
  blob. `heroAssetData` / `thumbData` / `assetData` are local staging for the photo/hero
  `CKAsset`s the importer attaches from R2.
- A few **display-only extras** beyond Postgres (`waypoint.terrain`, `timeFromPrevious`,
  `dateLabel`) carry the richer fixture demo data. They are additive and CloudKit-compatible.

Per-day distance / ascent / descent are **recomputed** from the route geometry
(`DayStats`, ported from the web's `transforms.ts`), never trusted from stored values, so the
numbers stay consistent across fixtures and sync.

## App Intents (MCP tool parity — D8)

`Akashic/Intents/` mirrors the legacy MCP Worker's 5-tool surface 1:1 as App Intents, so
Siri / Shortcuts and a future **system-MCP bridge** hit the same query surface. Each intent
runs through `JourneyStore` → `PersistenceController` (Fixtures today, CloudKit later) — never
straight to Core Data.

| Intent | MCP tool | Params (defaults / clamps) |
|--------|----------|-----------------------------|
| `ListJourneysIntent` | `list_journeys` | `limit` 20/max 100, `offset` 0, `country` filter |
| `SearchJourneysIntent` | `search_journeys` | `query` (required), `limit` 10/max 50 |
| `GetJourneyDetailsIntent` | `get_journey_details` | `journey` (UUID or slug) |
| `GetJourneyStatsIntent` | `get_journey_stats` | `journey` (UUID or slug) |
| `GetJourneyPhotosIntent` | `get_journey_photos` | `journey`, `waypointID`, `limit` 50/max 200 |

Each `perform()` returns **both** a human-readable `IntentDialog` and a machine-readable JSON
`String` (`ReturnsValue<String>`) whose Codable models (`IntentModels.swift`) reproduce the
MCP wire shapes exactly — snake_case keys (`journey_id`, `thumbnail_url`, `total_days`, …) via
`CodingKeys`, camelCase where the MCP used it (`dayNumber`, `avgDailyDistance`), and the
string-typed `ExtendedStats.avgDailyDistance` / `estimatedTotalTime` (`"25h 50min"`). Tool
failures throw `AkashicIntentError` carrying the MCP's plain-text message
(`"Journey not found: x"`), which a bridge maps to `{ content: [...], isError: true }`.

- **`JourneyEntity` + `JourneyEntityQuery`** — an `AppEntity` with `EntityStringQuery` so Siri /
  Shortcuts auto-complete journeys by name/slug; `entities(for:)` does the UUID-or-slug
  resolution (`resolveJourneyId` in the worker).
- **`AkashicShortcuts`** — `AppShortcutsProvider` with natural phrases
  ("List my journeys in Akashic", "Show journey details for … in Akashic", plus a few
  Norwegian variants).
- **`ExtendedStatsCalculator`** — the worker's stats math ported verbatim (Haversine;
  per-segment gain/loss between consecutive camp route indices; time model
  `(km/5)*60 + gain/10 + loss/20` minutes; Easy/Moderate/Hard/Extreme thresholds).
- **JSON normalisation** — payloads are compact with `.sortedKeys` (deterministic), vs the
  worker's pretty-printed insertion-order output. Keys/values/types are identical; only key
  order and whitespace differ. Foundation omits `nil` optionals rather than emitting explicit
  `null` (the fixtures never produce a null field, so this does not manifest today).
- **Access model** — local mode has no membership layer (every journey in the private store is
  accessible), so the worker's `"Access denied"` branch collapses into `"Journey not found"`
  for an unresolved id/slug.
- **Photos** — the recovered fixtures carry **no** photos, so `get_journey_photos` returns the
  correct empty shape `{"photos":[],"total":0}` (unit-tested). Real photos arrive with the
  Phase 2 data import (`CDPhoto` → `MCPPhoto`).

Tests live in `AkashicTests/IntentModelTests.swift`, `IntentQueryTests.swift`,
`IntentStatsTests.swift` (21 tests): wire-shape golden encode/decode, the Kilimanjaro
`ExtendedStats` numbers (70 km, avg `"10.0"` km/day, `Xh Ymin`, difficulty `Hard`), limit
clamps (500 → 100 / 50 / 200), and UUID-or-slug resolution.

## Widgets (WidgetKit) & Spotlight

Two "extras" from Phase 6, pulled forward. Both are additive — the default unsigned simulator
build keeps working with no team, and the app scheme builds/embeds the widget automatically.

### Spotlight — works tonight, no entitlement

`Services/SpotlightIndexer.swift` indexes every journey **and each of its days** into
`CSSearchableIndex` (`CoreSpotlight` needs no App Group or signing, so this is live on the
plain simulator build). It runs from the store's load path (`JourneyStore.reload()`), so it
**de-indexes + re-indexes idempotently on every load / import**.

- **Item ids** — `journey/<id>` and `journey/<id>/day/<n>`; both decode back to the journey id.
- **Deep-link** — `AkashicApp` handles `onContinueUserActivity(CSSearchableItemActionType)` and
  records the tapped journey on `JourneyStore.pendingJourneySelection`; `GlobeExperienceView`
  observes it (`.onChange(of: store.pendingJourneySelection)`) and flies the globe to the
  journey. Fully wired — tapping a Spotlight result opens the app on that journey.
- Pure item-building + id parsing are unit-tested (`AkashicTests/SpotlightIndexerTests.swift`);
  the `CSSearchableIndex` writes are skipped under XCTest.

### Widgets — build tonight, real data needs an App Group

`AkashicWidgets/` is a WidgetKit extension with `JourneyStatsWidget` (small: name + flag +
km/days/summit; medium: adds a mini stats row and a self-contained elevation sparkline drawn
with `Path`). It renders from a `WidgetSnapshot` — a tiny precomputed Codable value (display
strings, flag, downsampled elevation profile, optional thumbnail path) — never from Core Data.

Widgets run in a separate process, so the only channel is a **shared App-Group container**:

```
app  → WidgetPublisher.publish(journeys) → WidgetSnapshot JSON in group.no.akashic container
widget ← WidgetDataStore.load() ← same container   (falls back to bundled placeholder if empty)
```

**Tonight (unsigned simulator build): there is no App Group**, so
`AppGroup.containerURL == nil` — the publisher writes nothing and the widget shows its bundled
placeholder (`AkashicWidgets/Resources/placeholder-snapshot.json`). This is by design and
requires no code change to light up.

Preview the widget designs without the (non-scriptable) long-press Add-Widget flow via the
debug harness — launch the app with `AKASHIC_SCREEN=widgets` (renders the real fixture data;
see `Docs/screenshot-widgets.png`).

#### Runbook — enable real widget data (Christopher, once a signing team exists)

1. In the signing config, turn on the **App Groups** capability with `group.no.akashic` on
   **BOTH** the `Akashic` app target and the `AkashicWidgets` extension.
   (The app's `Support/Akashic.entitlements` already carries
   `com.apple.security.application-groups → group.no.akashic`; give the widget its own
   entitlements file with the same group and reference it from the widget's signed config.)
2. Build the `Release-CloudKit` configuration with `DEVELOPMENT_TEAM` set (same team as CloudKit).
3. That's it — `AppGroup.containerURL` now resolves, `WidgetPublisher` writes on every store
   load, and `WidgetCenter.reloadAllTimelines()` refreshes the widget with live journey data
   (a hero thumbnail is also copied into the shared container for a future photo-bearing
   widget design; the current widget renders stats and the elevation sparkline only).

## What remains (later phases)

- **Sync activation (live test)** — the `CKSyncEngine` layer (`Akashic/Sync/`) is built and
  unit-tested against a mocked engine; end-to-end sync needs an iCloud account on a simulator
  (see [Activating CloudKit sync](#activating-cloudkit-sync)). CKShare zone-per-journey sharing
  is the next phase.
- **Photo pipeline** — `PhotosPicker` → EXIF → thumbnails → `CKAsset` (Phase 3). Wiring
  `CDPhoto` into `JourneyQuery.photos` lights up `GetJourneyPhotosIntent` with real data.
- **Editing & collaboration** — journey/waypoint/comment edits, member management (Phase 3).
- **Real MapKit spike** — globe → fly-in → 3D terrain camera choreography (owned by
  `apple/Spikes`; this app ships only the flat placeholder map).
- **Data migration** — import real journeys/photos/comments from the Supabase/R2 export
  (Phase 2).
