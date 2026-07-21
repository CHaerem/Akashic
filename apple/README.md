# Akashic — iOS/iPadOS app

Native SwiftUI client for Akashic (Phase 1 of [`APPLE-MIGRATION-PLAN.md`](../APPLE-MIGRATION-PLAN.md)).
Read-only MVP: journey list, per-day detail, stats, and a flat route map — running on the
recovered trek fixtures until CloudKit is wired up.

> **Status:** Phase 1 scaffold. Read-only. Fixtures by default. CloudKit sync compiled but
> not yet activated. App Intents (D8) mirror the MCP tool surface (see below). Photo pipeline,
> sharing, and editing are later phases.

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
| `AKASHIC_TAB=0..3` | Select Journeys / Map / Stats / Settings |
| `AKASHIC_OPEN=<slug or id>` | Open that journey's detail |

```bash
UDID=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)
SIMCTL_CHILD_AKASHIC_OPEN=kilimanjaro \
  xcrun simctl launch --terminate-running-process "$UDID" no.akashic.app
xcrun simctl io "$UDID" screenshot Docs/screenshot-journey-detail.png
```

Screenshots live in [`Docs/`](Docs).

## Switch persistence modes

The store mode resolves from `Config.resolvedPersistenceMode`:

1. A **debug override** in `UserDefaults` (Settings tab → Persistence mode). Applies on relaunch.
2. Otherwise `FeatureFlags.cloudKitEnabled` → `.cloudKit`, else `.fixtures`.

| Mode | Store | Seeded? |
|------|-------|---------|
| `.fixtures` | in-memory SQLite (`/dev/null`) | yes, from fixtures |
| `.local` | on-disk SQLite | seeded once if empty |
| `.cloudKit` | `NSPersistentCloudKitContainer` → `iCloud.no.akashic` (private DB) | no — data arrives via sync |

## Flipping on CloudKit later

CloudKit code is present and compiles today; it is inert until an Apple Developer team +
entitlements are configured.

> [!WARNING]
> **The shipped `NSPersistentCloudKitContainer` (NSPCKC) mode is a Phase-1 _placeholder_, not
> the migration path.** On first run against a real container it would auto-generate its **own**
> schema — `CD_CDJourney`, `CD_CDWaypoint`, `CD_CDPhoto`, … record types with `CD_`-prefixed
> fields, all in the single default zone `com.apple.coredata.cloudkit.zone`. **That is not the
> migration schema.**
>
> The migration target is the **hand-authored custom records** — `Journey` / `Waypoint` /
> `Photo` / `DayComment` — in **per-journey custom zones** named `journey-<journey-uuid>`,
> defined by [`CloudKit/schema.ckdb`](CloudKit/schema.ckdb) and
> [`CloudKit/MAPPING.md`](CloudKit/MAPPING.md). Letting NSPCKC create its `CD_` schema would
> **invalidate both `schema.ckdb` _and_ the web adapter's queries** (which expect the
> `Journey`/`Waypoint`/`Photo`/`DayComment` types with the MAPPING.md field names).
>
> Which sync strategy to ship is the **open D4 / T2.3 decision** in
> [`APPLE-MIGRATION-TASKS.md`](../APPLE-MIGRATION-TASKS.md): **(a)** custom `CKRecord` sync
> (`CKSyncEngine` or hand-rolled) honoring `schema.ckdb` + per-journey zones + `CKShare` —
> matching everything authored so far; or **(b)** accept NSPCKC's generated schema — which then
> forces rewriting `schema.ckdb`, the web adapter, and D3's zone-per-journey sharing model to the
> `CD_` shapes. **Until D4 is decided, do NOT flip `.cloudKit` mode against the real
> `iCloud.no.akashic` container** — a first sync would bake the `CD_` schema into Development.

To activate (once D4 lands, and — for option (a) — a custom-record sync layer replaces the
placeholder NSPCKC wiring):

1. In **`project.yml`**, set `DEVELOPMENT_TEAM` under the `Release-CloudKit` config (or pass
   `DEVELOPMENT_TEAM=XXXXXXXXXX` on the `xcodebuild` command line), then `xcodegen generate`.
2. Build the **`Release-CloudKit`** configuration — it is the only config that references
   `Akashic/Support/Akashic.entitlements` (CloudKit + Push). Debug/Release stay team-free so
   CI and local simulator builds never need signing.
3. Create the CloudKit container `iCloud.no.akashic` (Development env) in the Apple Developer
   portal / CloudKit Console, and import the custom schema with `cktool` (see
   [`CloudKit/README.md`](CloudKit/README.md)) — do **not** rely on NSPCKC to generate it.
4. Set `FeatureFlags.cloudKitEnabled = true` (or use the Settings override) and relaunch on a
   device signed into iCloud.

## Project layout

```
apple/
  project.yml                     XcodeGen spec (source of truth)
  Akashic/
    App/                          @main app, Config (modes/flags), JourneyStore
    Models/                       Domain value types, flexible decoding, DayStats (per-day route math)
    Intents/                      App Intents (D8): 5 MCP-parity intents, JourneyEntity, stats calc
    Fixtures/                     FixtureModels + FixtureLoader (old camp shape -> domain)
    Persistence/                  PersistenceController, Core Data <-> domain mapping, JSON coders
      Akashic.xcdatamodeld        Core Data model (CloudKit-compatible)
    Views/                        SwiftUI: list, detail, stats, map, settings, theme
    Resources/                    Assets.xcassets (AppIcon placeholder, AccentColor)
    Support/                      Akashic.entitlements (Release-CloudKit only)
  AkashicTests/                   XCTest: fixtures, day-stats, Core Data round-trip
  Docs/                           Screenshots
  Fixtures/recovered/             Input JSON (owned elsewhere; read-only here)
```

## Data model notes (Core Data ↔ CloudKit)

The Core Data model mirrors the **real Postgres schema** (see `report-db-schema.md`), designed
for `NSPersistentCloudKitContainer`:

- Every attribute is **optional or has a default**; **no unique constraints**; every
  relationship has an **inverse**; to-one relationships are optional. These are CloudKit's
  hard requirements.
- Delete rules mirror Postgres FKs: `journey → waypoints/photos/dayComments` **cascade**;
  `waypoint → photos` **nullify** (`photos.waypoint_id ON DELETE SET NULL`).
- JSONB payloads (`route`, `stats`, `center_coordinates`, `coordinates`, `weather`,
  `fun_facts`, `points_of_interest`, `historical_sites`, `highlights`) are stored as **Binary**
  attributes holding JSON.
- **External binary storage is intentionally _not_ enabled.** Core Data's "Allows External
  Storage" flag is incompatible with `NSPersistentCloudKitContainer` (store load fails
  validation). Large binaries — notably long-trek `route` JSON that may exceed 1 MB — are kept
  as inline Binary; `NSPersistentCloudKitContainer` automatically promotes oversized values to
  `CKAsset` on mirroring, which is the CloudKit-native equivalent of the plan's
  "route JSON → Binary external storage" decision. `heroAssetData` / `thumbData` /
  `assetData` are placeholders for the eventual photo/hero `CKAsset`s.
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

## What remains (later phases)

- **Sync activation** — turn on `.cloudKit` mode with entitlements; CKShare zone-per-journey.
- **Photo pipeline** — `PhotosPicker` → EXIF → thumbnails → `CKAsset` (Phase 3). Wiring
  `CDPhoto` into `JourneyQuery.photos` lights up `GetJourneyPhotosIntent` with real data.
- **Editing & collaboration** — journey/waypoint/comment edits, member management (Phase 3).
- **Real MapKit spike** — globe → fly-in → 3D terrain camera choreography (owned by
  `apple/Spikes`; this app ships only the flat placeholder map).
- **Data migration** — import real journeys/photos/comments from the Supabase/R2 export
  (Phase 2).
