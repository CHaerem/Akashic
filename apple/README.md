# Akashic — iOS/iPadOS app

Native SwiftUI client for Akashic — the primary client, not a companion. The signature
globe → fly-in → day-navigation map experience, day content (weather, fun facts, POIs,
historical sites), photo grid/lightbox with map markers, interactive elevation profiles +
full stats, day comments, App Intents (D8), live Spotlight indexing, a stats widget
(built but not shipped in v1.0 — see [Widgets](#widgets-widgetkit--spotlight)), CKShare
family sharing, per-journey export (GPX + JSON + photos) and showcase publishing.

**Journeys can be created here**, from four route sources: GPX import (Strava/Garmin/
AllTrails/komoot), inference from photo GPS, **drawn by hand on the map**, or no route at
all. Days seed from GPX waypoints or photo-date clusters; structural facts derived from your own
photos — route, country, dates — are applied by default and reversibly, while enrichment
(place names, POIs, historical weather, grounded facts) stays accept-per-row; **Akashic Intelligence** (on-device
Foundation Models, iOS 26 + Apple Intelligence + Complete) drafts day notes and day names
without a byte leaving the device. Everything is correctable after the fact — route, days,
day content, photo↔day assignment, and deletion.

A journey can be **read as a story** — cover, one chapter per day, photos inline, with the
day's own notes first-class — which is the thing you hand to someone. A `.gpx` shared from
Files, Mail or Strava opens straight into creation. A fresh install ships one **sample
journey** so the app is never empty. The app follows the **system appearance** (light, dark,
or an Appearance picker in Settings), honours Reduce Motion, Reduce Transparency and Increase
Contrast, and lays out properly on iPad — where the day panel floats beside a live map rather
than covering it.

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
> and W7 in [`APPLE-MIGRATION-TASKS.md`](../APPLE-MIGRATION-TASKS.md). **608 unit tests, CI
> green** — reproduce the count with `grep -rn 'func test' apple/AkashicTests | wc -l` (run it
> rather than trusting this number; it has drifted twice).

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

# Both test suites: AkashicTests (fixture decoding, per-day stats, Core Data
# round-trip, App Intent wire shapes) and AkashicUITests (see below)
xcodebuild -project Akashic.xcodeproj -scheme Akashic \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO test

# One suite at a time — the UI tests launch the app per test and take ~3 min
xcodebuild ... -only-testing:AkashicTests test      # ~8 s, 787 tests
xcodebuild ... -only-testing:AkashicUITests test    # ~3 min, 14 tests
```

CI runs the same steps on every push/PR touching `apple/**` — see
[`.github/workflows/apple-ci.yml`](../.github/workflows/apple-ci.yml).

### `AkashicUITests` — the UI test target (QUA-10 / QUA-29)

A `bundle.ui-testing` target that drives the app through the accessibility tree. Three files,
all in the shared scheme's test action so plain `xcodebuild test` (and therefore CI) runs them:

| File | What it covers |
|---|---|
| `AccessibilityAuditTests` | `XCUIApplication.performAccessibilityAudit()` over the globe (with and without journeys), a day view, the paywall, both phases of the create-journey flow, Settings and Stats |
| `CreateJourneyUITests` | `NewJourneySheet` end to end via the name-only path: chooser → review → validity gate → Create → the journey on the globe; plus Cancel leaving nothing behind |
| `PaywallUITests` | The `.settings` and `.journeyLimit` entry points, the unreachable-store surface and its retry, restore, the legal links, and that an entitled customer is never shown a buy button |

Three things about it are worth knowing before changing it:

- **It cannot import the app.** A UI test bundle runs out of process, so `A11yID`, `Journey` and
  `EntitlementPolicy` are all invisible to it. `AkashicUITests/Support/` restates the handful of
  identifiers it needs; that duplication is deliberate and documented there.
- **Elements are found by `accessibilityIdentifier`, not by label.** See `Akashic/App/A11yID.swift`
  for the rule. A label query would break on any copy edit and on every non-English run — and a UI
  test that stops finding its element does not fail, it silently taps nothing and passes.
- **The audit enforces four of its seven checks and reports the other three.**
  `AccessibilityAuditTests.audit(_:screen:)` explains exactly which, with the measured contrast
  ratios behind the decision and the condition for promoting each reported type to enforced. The
  reported findings are printed in full on every run; the log is the backlog.

Two paths are deliberately **not** covered, both because they are out-of-process system UI rather
than Akashic: the `PhotosPicker` and `.fileImporter` cards in the create chooser (asserted present
and hittable, never opened), and StoreKit's purchase confirmation sheet — see `PaywallUITests`'
class comment for why the paywall's priced state is unreachable under `xcodebuild test` at all.

## Run on fixtures (default)

Just build & run the `Akashic` scheme on a simulator. The app boots in **Fixtures** mode:
an in-memory Core Data store seeded from `Fixtures/recovered/*.json` (Kilimanjaro, Mount
Kenya, Inca Trail). No account, network, or entitlements needed.

### Screenshot / UI-test seam

The app reads **around thirty** `AKASHIC_*` launch environment variables (used for the
screenshots in `Docs/`). The load-bearing ones are below; for the complete list run
`grep -rho 'AKASHIC_[A-Z_]*' apple/Akashic --include='*.swift' | sort -u`.

| Variable | Effect |
|----------|--------|
| `AKASHIC_TAB=0..2` | Select the tab: 0 Explore (globe) · 1 Stats · 2 Settings |
| `AKASHIC_EMPTY=1` | Start with no journeys — the state a new customer sees on first launch. Deliberately takes precedence over the demo seed *without* consuming the once-ever seed decision |
| `AKASHIC_OPEN=<slug or id>` | Open that journey's detail |
| `AKASHIC_SKIP_ONBOARDING=1` | Bypass the onboarding flow |
| `AKASHIC_FORCE_LOCAL=1` | Force the on-disk `.local` store before the store is built |
| `AKASHIC_CLOUDKIT=1` | Select `.cloudKit` mode for one run without flipping the build flag |
| `AKASHIC_COMPLETE=1` | Simulate the "Akashic Complete" entitlement (paywall / paid-tier screens) |
| `AKASHIC_DISABLE_AI=1` | Kill switch for Akashic Intelligence — every AI entry point disappears |
| `AKASHIC_SYNC_LOG=1` | Stream the sync layer's diagnostic log (see `Sync/SyncLog.swift`) |
| `AKASHIC_IMPORT_ON_LAUNCH=1` | Run the export import at startup (see below) |
| `AKASHIC_IMPORT_PATH=<dir>` | Export bundle path (default `Config.importBundlePath`) |
| `AKASHIC_MEDIA_ROOT=<dir>` | Media root (default `<bundle>/r2/objects`) |
| `AKASHIC_IMPORT_RESET=1` | Clear the fixture seed before importing (clean demo) |
| `AKASHIC_SCREEN=photos` | Deep-link to the imported-photos journey list |
| `AKASHIC_SCREEN=photogrid` + `AKASHIC_PHOTOS_JOURNEY=<id>` | Deep-link to a journey's thumbnail grid |
| `AKASHIC_SCREEN=widgets` | The widget-design harness (see Widgets below) |
| `AKASHIC_SCREEN=editsheet` + `AKASHIC_EDIT_SCREENSHOT=photo\|waypoint\|journey\|import` | The edit-sheet screenshot harness (`Views/Edit/EditScreenshotHarness.swift`) |

```bash
UDID=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)
SIMCTL_CHILD_AKASHIC_OPEN=kilimanjaro \
  xcrun simctl launch --terminate-running-process "$UDID" no.akashic.app
xcrun simctl io "$UDID" screenshot Docs/screenshot-journey-detail.png
```

Screenshots live in [`Docs/`](Docs). The real-data screenshots are `Docs/screenshot-real-{list,detail,photos}.png`.

## Import real data from a Supabase export

The `Import/` module reads a Supabase JSON export (the `supabase/*.json` dump + the R2 media
tree) and upserts it into the **local Core Data store**, preserving every original Postgres
UUID. It is the on-device counterpart to the CloudKit importer (`CloudKitImportSink.swift`,
also shipped), which reuses the same reader + transform behind a different write sink. The
family archive has already been imported into Production through it; the module stays as the
reproducible path, not as pending work.

**Pipeline (all in `Akashic/Import/`):**

```
ExportBundle  →  ExportMapper       →  ImportSink            →  ImportReport
(read *.json)    (rows → Journey/     (CoreDataImportSink or
                  Photo, sink-free)    CloudKitImportSink)
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

All 14 files in the directory are listed. The table previously showed 7, and the omissions
mattered: `PublicMirrorPublisher.swift` is the **entire** public-showcase publish path, and
`CloudKitJourneySharing.swift` is CKShare — the family product.

| File | Responsibility |
|------|----------------|
| `Sync/RecordCoder.swift` | Bidirectional domain ↔ `CKRecord` mapping, **exactly** per `schema.ckdb`/`MAPPING.md`: field names, `LOCATION` `[lng,lat]`→`(lat,lng)` swap, `routeJSON` ASSET, JSON-string payloads, `highlights` `LIST<STRING>`, reference delete actions, recordNames = original UUIDs, zone `journey-<uuid>`. **Shared with the importer** (`Import/CloudKitImportSink.swift`) as the one (de)serialization contract. |
| `Sync/AkashicSyncEngine.swift` | The coordinator (a `CKSyncEngineDelegate`) behind a `SyncEngineProtocol` seam. Account-gated activation, initial upload, pending-change enqueue, fetched-change apply, zone-deletion, and conflict handling. Delegate callbacks are thin adapters over plain, unit-tested methods. |
| `Sync/SyncSeam.swift` | `SyncEngineProtocol` (mockable engine) + `CKSyncEngineAdapter` (real) + `SyncLocalStore` (mockable local store) + `LocalChange`. |
| `Sync/SyncScheduler.swift` | Observes `NSManagedObjectContextDidSave` and forwards local writes as pending changes — zero edits to the persistence write methods. Suppresses the echo while remote changes are applied. |
| `Sync/PersistenceController+Sync.swift` | `SyncLocalStore` conformance: materialize a `CKRecord` from a stored row; apply a fetched record (server-authoritative, **per record** — never cascading to siblings, unlike the importer's whole-journey upsert). Also carries the fresh-install demo-journey seed hook. |
| `Sync/SyncStatus.swift` | Observable status the UI can surface + the `AccountStatusProviding` seam. |
| **`Sync/PublicMirrorPublisher.swift`** | **The public showcase.** Publishes a thumbnail-and-metadata mirror of a journey to `CKContainer.publicCloudDatabase` — `PublicJourney` (recordName = slug) + one `PublicPhoto` per photo — so the signed-out web can read it without an Apple ID. Record building is pure and unit-tested. Enforces the thumbnails-only rule strictly (a photo with no real thumb bytes is skipped, never silently published at full resolution), reconciles stale mirror records on re-publish, and sweeps every candidate slug on unpublish. **Note this writes to the developer-billed public database — see `COMMERCIALIZATION-PLAN.md` §2.** |
| **`Sync/CloudKitJourneySharing.swift`** | The real `CKShare` implementation: create/fetch a per-journey share, participant lookup, role and permission changes, revocation. |
| **`Sync/JourneySharing.swift`** | The `JourneySharingService` seam plus the design rationale: the whole **zone** is shared, not a hierarchical share rooted at the journey record — CloudKit caps owning references at ~750 per record and Kilimanjaro has 939 photos. Also the role policy (owners cannot be demoted or removed; nobody removes themselves here). |
| **`Sync/SyncMediaStaging.swift`** | **Data-safety critical.** Moves fetched `CKAsset` bytes *out* of CloudKit's temporary staging area into the app's own media root under the same key scheme `PhotoIngestService` uses. Persisting CloudKit's temp path instead would let the cache purge take the photo — and, worse, the next local edit would re-encode the record with `nil` assets and delete the only remaining copy server-side. |
| **`Sync/PersistenceController+Media.swift`** | Photo architecture v2 (MAPPING §13), the media-zone side of the store: `MediaRepackStore` conformance and the ingest/delete hooks (pure Core Data, compiled everywhere and unit-tested), plus the CloudKit factories reached only in an entitled `*-CloudKit` build. |
| **`Sync/NetworkPolicy.swift`** | The **Wi-Fi-only download policy**. First sync pulls gigabytes; on a metered connection that is a real bill and the classic "this app ate my data plan" review. Heavy transfers are Wi-Fi-only by default with an explicit cellular opt-in and an honest waiting status; both the engine's automatic fetches and the explicit activation pull consult it. |
| **`Sync/SyncDownloadPrompt.swift`** | The honest **pre-fetch size estimate** for the first-sync prompt — a concrete number before a single asset byte is fetched, always worded as "about …" because the per-photo average (~3.5 MB) is an estimate. |
| **`Sync/SyncLog.swift`** | Structured sync logging behind one seam, so diagnosis does not need `print`. |

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

### Two-simulator round-trip test

Sync itself is verified live against the real container (`Docs/sync-verification.md`). This is
the local repro, and it is also the shape of the one remaining unprovable piece — **push
delivery needs two devices on two Apple IDs**, which two simulators on one account cannot
show; see the push-sync trap in the root `CLAUDE.md`.

1. Boot two simulators; sign **both** into the **same** iCloud account.
2. Install the `Debug-CloudKit` build on both; launch both with `AKASHIC_CLOUDKIT=1`.
3. On sim A, import the export (or make an edit — e.g. rename a journey / add a day comment).
4. Wait for sim A's status to read `Syncing with iCloud`, then foreground sim B and pull to
   refresh / relaunch. The change should appear on B (server-authoritative apply).
5. Make a conflicting edit to the same record on both while briefly offline, then reconnect: the
   later write wins (last-writer-wins rebase). Inspect records in the CloudKit Console
   (`iCloud.no.akashic` → Data → the `journey-<uuid>` zone) to confirm field values + zones.

## Project layout

All 15 directories under `Akashic/` are listed — the tree previously omitted `Export/`,
`Intelligence/`, `Media/` and `Store/`, which between them hold the export feature, the
paid-tier differentiator, the photo-media layer and the paywall's entitlement policy.

```
apple/
  project.yml                     XcodeGen spec (source of truth)
  Akashic/
    App/                          @main app, Config (modes/flags), JourneyStore, AppGroup,
                                  OnboardingState, A11yID (the accessibility identifiers
                                  AkashicUITests drives — and the rule for adding one)
    Models/                       Domain value types, flexible decoding, DayStats (per-day route math)
    Export/                       Per-journey archive (the exit door): JourneyExporter,
                                  ExportArchive (zip), GPXBuilder
    Fixtures/                     FixtureModels + FixtureLoader (old camp shape -> domain),
                                  FixtureMedia (DIFF-10: bundled photographs -> media library)
                                  NOTE: no photo path — fixtures carry metadata only
    Import/                       ExportBundle reader, ExportMapper, LocalImporter (+ sink seam),
                                  CloudKitImportSink, PhotoDayMatcher, ImportBrowserView
    Intelligence/                 Akashic Intelligence (paid tier, iOS 26 + Apple Intelligence):
                                  DayNoteDrafter, FactDrafter, DayNamer, KnowledgeRetrieval,
                                  IntelligenceAvailability (the runtime gate + kill switch)
    Intents/                      App Intents (D8): 5 MCP-parity intents, JourneyEntity, stats calc
    Media/                        Photo architecture v2 — thumbnails first, originals on demand:
                                  MediaDatabase, MediaFetcher, MediaRepackJob, PhotoMediaService,
                                  MediaShareAutoAccepter
    Persistence/                  PersistenceController (modes incl. CloudKit; the once-ever demo
                                  journey seed), Core Data <-> domain mapping, JSON coders
      Akashic.xcdatamodeld        Core Data model (CloudKit-compatible; CDPhoto local media paths)
    Services/                     PhotoIngestService (EXIF + 400 px thumbs), PlaceEnrichment,
                                  WeatherEnrichment, RouteInference/RouteDrawing/RouteCorrection,
                                  JourneyDraft, JourneySuggestions, CommentService, PhotoEditService,
                                  SpotlightIndexer, WidgetSnapshot(+Journey)/WidgetDataStore/
                                  JourneyStatsWidgetView, WidgetGallery harness
    Store/                        StoreKit 2 paywall backing: Entitlements.swift (the free/Complete
                                  policy — 1 owned journey, 100 photos), Akashic.storekit
    Sync/                         D4 CloudKit sync — 14 files, see the table above
    Views/                        SwiftUI. 11 root files (RootView, JourneyListView,
                                  JourneyDetailView, StatsView, SettingsView, OnboardingView,
                                  MapView, Theme, Formatters, …) plus 13 subdirectories:
                                  Charts/ Comments/ Day/ Edit/ Export/ Map/ NewJourney/ Photos/
                                  Route/ Sharing/ Showcase/ Store/ Story/
    Resources/                    Assets.xcassets: AppIcon (finished — a filled globe in the app
                                  accent on a #0B0B19 ground, with dark and tinted variants;
                                  the three SVG sources are committed beside the 1024 PNGs and
                                  rasterised by `generate.mjs`), AccentColor
    Support/                      Akashic.entitlements (Release-CloudKit only)
  AkashicWidgets/                 WidgetKit extension: JourneyStatsWidget + placeholder snapshot +
                                  AkashicWidgets.entitlements (reference only — not wired into any
                                  config). BUILT on every app build, NOT embedded (QUA-09)
  AkashicTests/                   XCTest: fixtures, day-stats, Core Data round-trip, import, day
                                  matcher, sync/mirror, entitlements, intelligence, Spotlight,
                                  widget snapshot/data-store
  AkashicUITests/                 XCUITest (QUA-10/QUA-29): performAccessibilityAudit over the main
                                  screens, the create-journey flow end to end, the paywall's
                                  states. Runs OUT of process — cannot import the app; see the
                                  section above and Support/AkashicUITestCase.swift
  CloudKit/                       schema.ckdb (hand-authored) + MAPPING.md — the record contract
  Docs/                           Screenshots, DESIGN-PLAN.md, sync-verification.md, sharing.md
  Fixtures/recovered/             Input JSON (owned elsewhere; read-only here) — metadata only,
                                  no photos. Photographs live in Fixtures/demo-media/
                                  instead, so this archive stays byte-identical
  Fixtures/demo-media/            DIFF-10: three JPEGs (~474 KB) + demo-photos.json, the
                                  sidecar manifest mapping them to journey slugs and days
  Spikes/                         MapKitGlobe / Mapbox evaluation spikes behind decision D5
  Scripts/                        testflight-upload.sh + ExportOptions.plist (owner-only;
                                  needs credentials — do not run)
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
- **Photos** — the recovered fixtures under `Fixtures/recovered/` still carry no photos, but
  there IS a photo path now (DIFF-10): `Fixtures/FixtureMedia.swift` reads the
  `Fixtures/demo-media/demo-photos.json` manifest and stages the bundled JPEGs into the media
  library at the same `journeys/<jid>/photos/<pid>.jpg` layout an ingested photo uses, so every
  consumer reads them through the existing paths. Caveat worth knowing: those three images are
  re-encoded hero artwork, not trek photographs — the repo contains no real photographs at all.
  Swapping real ones in is a file copy plus a manifest edit, no code change.
- **Item ids** — `journey/<id>` and `journey/<id>/day/<n>`; both decode back to the journey id.
- **Deep-link** — `AkashicApp` handles `onContinueUserActivity(CSSearchableItemActionType)` and
  records the tapped journey on `JourneyStore.pendingJourneySelection`; `GlobeExperienceView`
  observes it (`.onChange(of: store.pendingJourneySelection)`) and flies the globe to the
  journey. Fully wired — tapping a Spotlight result opens the app on that journey.
- Pure item-building + id parsing are unit-tested (`AkashicTests/SpotlightIndexerTests.swift`);
  the `CSSearchableIndex` writes are skipped under XCTest.

### Widgets — built on every build, deliberately NOT embedded for v1.0

`AkashicWidgets/` is a WidgetKit extension with `JourneyStatsWidget` (small: name + flag +
km/days/summit; medium: adds a mini stats row and a self-contained elevation sparkline drawn
with `Path`). It renders from a `WidgetSnapshot` — a tiny precomputed Codable value (display
strings, flag, downsampled elevation profile, optional thumbnail path) — never from Core Data.

> [!IMPORTANT]
> **`embed: false` (QUA-09, 2026-07-26).** The target compiles as part of every app build —
> so the code cannot rot and its tests keep running — but it is **not packaged into the app**
> and does not reach a customer. Two independent reasons, both of which must be fixed before
> embedding is worth it:
>
> 1. It has **no App Group entitlement in any configuration**, so `AppGroup.containerURL`
>    never resolves and it cannot read a snapshot. `AkashicWidgets/AkashicWidgets.entitlements`
>    **already exists** and is kept as the reference, but no config points
>    `CODE_SIGN_ENTITLEMENTS` at it — adding the capability needs Xcode's GUI, because
>    `xcodebuild -allowProvisioningUpdates` refuses to mint the extension's profile from an App
>    Store Connect API key, and carrying an unusable entitlement blocked archiving outright.
> 2. **Nothing calls `WidgetSnapshot.publish`** anywhere in the app. Its only caller is
>    `WidgetGalleryHarness`, which exists for screenshots.
>
> Embedded as-is it would appear in every customer's widget gallery rendering its bundled
> Kilimanjaro placeholder — a stranger's trek, permanently, on the home screen of someone who
> paid. See the comments at `project.yml:110` and `:263` for the authoritative version.

Widgets run in a separate process, so the only channel is a **shared App-Group container**:

```
app  → WidgetPublisher.publish(journeys) → WidgetSnapshot JSON in group.no.akashic container
widget ← WidgetDataStore.load() ← same container   (falls back to bundled placeholder if empty)
```

**In every configuration today there is no App Group**, so `AppGroup.containerURL == nil` — the
publisher writes nothing and the widget shows its bundled placeholder
(`AkashicWidgets/Resources/placeholder-snapshot.json`). That, plus the fact that nothing calls
the publisher, is why the target is not embedded; see the runbook below for the order to fix
it in.

Preview the widget designs without the (non-scriptable) long-press Add-Widget flow via the
debug harness — launch the app with `AKASHIC_SCREEN=widgets` (renders the real fixture data;
see `Docs/screenshot-widgets.png`).

#### Runbook — ship the widget with real data (Christopher, post-v1.0)

Four steps, in this order. Steps 1 and 3 are the two blockers above; **do not set
`embed: true` until both are done**, or customers get the placeholder.

1. **Add the App Groups capability in Xcode's GUI** — open `Akashic.xcodeproj`, select the
   **AkashicWidgets** target → Signing & Capabilities → App Groups → `group.no.akashic`. This
   cannot be done from the CLI (see the note above). Do **not** create an entitlements file:
   `AkashicWidgets/AkashicWidgets.entitlements` **already exists** with exactly the right
   `com.apple.security.application-groups` array, and the app's
   `Support/Akashic.entitlements` already carries the same group. What is missing is only the
   `CODE_SIGN_ENTITLEMENTS` setting on the widget's two signed configs in `project.yml` —
   restore it there once the capability exists.
2. Build the `Release-CloudKit` configuration with `DEVELOPMENT_TEAM` set (same team as
   CloudKit) and confirm the widget's profile is minted.
3. **Wire `WidgetSnapshot.publish` into `JourneyStore`'s reload path.** Today nothing calls it
   outside the screenshot harness, so even with the App Group the container stays empty.
4. Flip `embed: false` → `true` at `project.yml:133`. Then `AppGroup.containerURL` resolves,
   the publisher writes on every store load, and `WidgetCenter.reloadAllTimelines()` refreshes
   with live journey data (a hero thumbnail is also copied into the shared container for a
   future photo-bearing widget design; the current widget renders stats and the elevation
   sparkline only).

## What remains

**Corrected 2026-07-26 (DOC-18).** This section used to be titled "later phases" and
listed five items as future work. **All five have shipped.** They are recorded below as
*where they landed*, because the old text was actively misleading — one entry was flatly
false — and a reader planning against it would rebuild the app.

| Was listed as future | Reality |
|---|---|
| **Real MapKit spike** — the entry claimed the globe/fly-in/3D-terrain choreography lived only in `apple/Spikes`, and that this app shipped nothing but a flat stand-in map | **That was false from 2026-07-22**, when decision **D5 ratified MapKit** (`APPLE-MIGRATION-PLAN.md` D5, `APPLE-MIGRATION-TASKS.md` T2.6). The real experience is in `Akashic/Views/Map/`: `GlobeExperienceView`, `DayNavigationView`, `TrekCameraController`, `GlobeMapComponents`, `MapGeoMath`. There is no placeholder map anywhere in the app. |
| **Photo pipeline** — `PhotosPicker` → EXIF → thumbnails → `CKAsset` | Shipped. `Services/PhotoIngestService.swift` (400 px max, JPEG q0.8, orientation-corrected), `PhotoDayMatcher` for EXIF day-matching, and the whole `Akashic/Media/` layer for photo-architecture v2 (thumbnails first, originals streamed on demand). `GetJourneyPhotosIntent` returns real photos. |
| **Editing & collaboration** | Shipped. `Views/Edit/` (journey, waypoint, photo, comment edits), `Views/Comments/`, and `Sync/JourneySharing.swift` + `CloudKitJourneySharing.swift` for CKShare member management with roles. |
| **Sync activation (live test)** | The layer is live and the family archive is in **Production** (1559 records / 3070 assets / 0 failures). CKShare zone-per-journey sharing is built, not "next phase". **What genuinely remains is one owner task:** push-delivery verification needs two devices on two Apple IDs — see the push-sync trap in the root `CLAUDE.md`. |
| **Data migration** | Done. The archive is imported; `Akashic/Import/` remains as the reproducible path. |

Anything still ahead is tracked in the root **[`WORKPLAN.md`](../WORKPLAN.md)**, which is
generated from `docs/workplan/tasks.json` and is the only non-drifting statement of status.
Do not treat this README as a plan.

One deliberate non-ship worth knowing about here: **the widget target is built on every app
build but is NOT embedded** (`embed: false`, QUA-09) — see [Widgets](#widgets-widgetkit--spotlight).
