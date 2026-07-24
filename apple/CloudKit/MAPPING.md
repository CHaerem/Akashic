# Postgres → CloudKit Mapping (authoritative)

Source of truth for the field-by-field migration of the Akashic Supabase/Postgres
schema into CloudKit. The `.ckdb` schema in this directory is authored from this
table. Where the two disagree, **this document wins** — fix the `.ckdb` to match.

Schema basis: the effective Postgres schema after all 17 migrations
(`supabase/migrations/`), **not** the stale block in `ARCHITECTURE.md`. See the
recon reports in the scratchpad for the authoritative column list.

Databases:
- **Private DB** (owner) — `Journey`, `Waypoint`, `Photo`, `DayComment`, one custom
  zone per journey. This is the real archive.
- **Shared DB** (family) — the same record types, reached through a `CKShare` on
  each journey zone. No separate schema; shared records use the private-DB types.
- **Public DB** (world-readable showcase) — `PublicJourney`, `PublicPhoto`. A
  thumbnail-and-metadata mirror written by the owner's app when a journey is public.

---

## 1. Zones, record names, and stable identity

**Zone-per-journey.** Each journey and all its children (waypoints, photos,
comments) live in one custom record zone in the owner's private DB. Sharing a
journey = putting a `CKShare` on its zone (D3).

**Zone name:** `journey-<journey.id>` — the original Postgres journey UUID,
unchanged.

**Record names (all keep the original Postgres UUID):**

| Record | recordName | zoneName |
|--------|-----------|----------|
| Journey (zone root) | `<journeys.id>` | `journey-<journeys.id>` |
| Waypoint | `<waypoints.id>` | `journey-<journeys.id>` |
| Photo | `<photos.id>` | `journey-<journeys.id>` |
| DayComment | `<day_comments.id>` | `journey-<journeys.id>` |

**Why keep the UUIDs (do not regenerate):** the R2 object layout is
`journeys/{journeyId}/photos/{photoId}.{ext}` and the `photos` primary key **is**
the `{photoId}` in that path (and the CKAsset filename). Reusing the same UUIDs as
CloudKit record names means the importer can map every CloudKit `Photo` record to
its exact R2 object to fetch bytes for the `original`/`thumb` assets, and any
external link, MCP response, or historical-site reference that embeds these IDs
stays valid through the cutover. Stable identity end-to-end.

---

## 2. `journeys` → `Journey` (private DB, zone root)

| Postgres column | Type | CloudKit field | CloudKit type | Notes |
|---|---|---|---|---|
| `id` | UUID | *(recordName + zoneName)* | — | see §1 |
| `created_by` | UUID | *(dropped)* | — | ownership = private-DB owner / zone owner; see §7. Nullable in PG (orphan journeys) — import assigns to the importing owner |
| `name` | TEXT | `name` | STRING | QUERYABLE SEARCHABLE SORTABLE (app lists journeys `.order('name')`) |
| `slug` | TEXT UNIQUE | `slug` | STRING | QUERYABLE SORTABLE (app `.eq('slug')` everywhere). Uniqueness not enforceable in CloudKit — importer guarantees it |
| `description` | TEXT | `description` | STRING | SEARCHABLE (App Intents / MCP `search_journeys`) |
| `country` | TEXT | `country` | STRING | QUERYABLE SEARCHABLE |
| `journey_type` | TEXT (def `trek`) | `journeyType` | STRING | QUERYABLE. No CHECK in PG; free text |
| `summit_elevation` | INTEGER | `summitElevation` | INT64 | |
| `total_distance` | NUMERIC | `totalDistance` | DOUBLE | |
| `total_days` | INTEGER | `totalDays` | INT64 | |
| `date_started` | DATE | `dateStarted` | TIMESTAMP | SORTABLE. DATE → midnight-UTC timestamp |
| `date_ended` | DATE | `dateEnded` | TIMESTAMP | DATE → midnight-UTC timestamp |
| `hero_image_url` | TEXT (R2 path) | `heroImage` | ASSET | bytes fetched from R2 at import; path itself dropped |
| *(derived)* | — | `heroThumb` | ASSET | 400px thumbnail of the hero (same pipeline as photo thumbs) |
| `gpx_url` | TEXT | **dropped: no data** | — | NULL for every journey. Route geometry lives in `route` (below); GPX, if ever needed, is regenerated on-device from `routeJSON` |
| `center_coordinates` | JSONB `[lng,lat]` | `centerLocation` | LOCATION | see coordinate rule §5 |
| `default_zoom` | NUMERIC | `defaultZoom` | DOUBLE | |
| `is_public` | BOOLEAN | `isPublic` | INT64 (0/1) | QUERYABLE. CloudKit has no bool; 0/1. Drives the public mirror (§8) |
| `created_at` | TIMESTAMPTZ | *(system `createdTimestamp`)* | — | audit only; **not preserved** — reflects CloudKit write (migration) time |
| `updated_at` | TIMESTAMPTZ | *(system `modifiedTimestamp`)* | — | audit only; not preserved |
| `route` | JSONB LineString | `routeJSON` | ASSET | JSON serialized to a small file asset — see §6 for the ASSET-vs-STRING decision |
| `stats` | JSONB | `statsJSON` | STRING | ~180 B; inline JSON string — see §6 |
| `preferred_bearing` | NUMERIC | `preferredBearing` | DOUBLE | map camera |
| `preferred_pitch` | NUMERIC (def 60) | `preferredPitch` | DOUBLE | map camera |

---

## 3. `waypoints` → `Waypoint` (private DB, journey zone)

| Postgres column | Type | CloudKit field | CloudKit type | Notes |
|---|---|---|---|---|
| `id` | UUID | *(recordName)* | — | |
| `journey_id` | UUID FK | `journeyRef` | REFERENCE | QUERYABLE. `.none` — the journey zone is the cascade boundary; an owning ref hits CloudKit's ~750 cap (§9) |
| `name` | TEXT | `name` | STRING | QUERYABLE SEARCHABLE |
| `waypoint_type` | TEXT (def `camp`) | `waypointType` | STRING | QUERYABLE. Free text (`camp`/`summit`/…), no CHECK |
| `day_number` | INTEGER | `dayNumber` | INT64 | SORTABLE |
| `coordinates` | JSONB (NOT NULL) | `coordinates` | LOCATION | QUERYABLE. Coordinate rule §5. NOT NULL not enforceable — importer guarantees |
| `elevation` | INTEGER | `elevation` | INT64 | kept as its own field, **not** folded into LOCATION altitude (integer semantics, avoids float drift) |
| `description` | TEXT | `description` | STRING | |
| `highlights` | TEXT[] | `highlights` | STRING LIST | native CloudKit multi-value list (not JSON) |
| `arrival_time` | TEXT | `arrivalTime` | STRING | free-text time label, kept verbatim |
| `departure_time` | TEXT | `departureTime` | STRING | |
| `date_visited` | DATE | `dateVisited` | TIMESTAMP | |
| `sort_order` | INTEGER | `sortOrder` | INT64 | SORTABLE (app `.order('sort_order')`) |
| `route_distance_km` | NUMERIC | `routeDistanceKm` | DOUBLE | |
| `route_point_index` | INTEGER | `routePointIndex` | INT64 | index into journey route coords |
| `weather` | JSONB | `weatherJSON` | STRING | JSON string, §6 |
| `fun_facts` | JSONB[] | `funFactsJSON` | STRING | JSON string, §6 |
| `points_of_interest` | JSONB[] | `pointsOfInterestJSON` | STRING | JSON string, §6 |
| `historical_sites` | JSONB[] | `historicalSitesJSON` | STRING | JSON string, §6 (⚠ embeds `image_urls`) |
| `created_at` | TIMESTAMPTZ | *(system `createdTimestamp`)* | — | audit only |

---

## 4. `photos` → `Photo` (private DB, journey zone)

Bytes live in R2 today; the importer fetches each object and attaches it as a CKAsset.

| Postgres column | Type | CloudKit field | CloudKit type | Notes |
|---|---|---|---|---|
| `id` | UUID | *(recordName)* | — | = R2 `{photoId}` (§1) |
| `journey_id` | UUID FK | `journeyRef` | REFERENCE | QUERYABLE. `.none` — zone cascades (§9) |
| `waypoint_id` | UUID FK (ON DELETE SET NULL) | `waypointRef` | REFERENCE | QUERYABLE. **action NONE** — deleting a waypoint must orphan the photo, not delete it. Note the behavioural gap: PG `SET NULL` clears the FK; CloudKit `NONE` leaves a **dangling** reference. App treats a reference whose target is missing as "unassigned"; ideally the waypoint-delete flow clears `waypointRef` explicitly to mirror SET NULL (§9) |
| `url` | TEXT (R2 path) | `original` | ASSET | fetch bytes from `journeys/{jid}/photos/{pid}.{ext}`; path dropped |
| `thumbnail_url` | TEXT (R2 path) | `thumb` | ASSET | fetch bytes from `..._thumb.jpg`; path dropped |
| `caption` | TEXT | `caption` | STRING | SEARCHABLE |
| `coordinates` | JSONB | `coordinates` | LOCATION | QUERYABLE. Coordinate rule §5 (two source encodings!) |
| `taken_at` | TIMESTAMPTZ | `takenAt` | TIMESTAMP | QUERYABLE SORTABLE (app `.order('taken_at')`) |
| `is_hero` | BOOLEAN | `isHero` | INT64 (0/1) | QUERYABLE |
| `sort_order` | INTEGER | `sortOrder` | INT64 | SORTABLE (app `.order('sort_order')`) |
| `rotation` | INTEGER (0/90/180/270) | `rotation` | INT64 | **must survive** — display transform; images render wrong without it. CHECK not enforceable in CloudKit; validate in app |
| `media_type` | TEXT (`image`/`video`) | `mediaType` | STRING | QUERYABLE |
| `duration` | INTEGER (sec) | `duration` | DOUBLE | video length. Widened to DOUBLE (harmless; PG stores integer seconds) |
| `location_source` | TEXT (`exif`/`estimated`/`manual`) | `locationSource` | STRING | CHECK not enforceable in CloudKit; validate in app |
| `uploaded_by` | UUID FK | *(system `creatorUserRecordID`)* | — | see §7. ⚠ migration sets creator = importing owner for **all** rows (originals not preserved); `uploaded_by` is not surfaced in the app, so acceptable |
| `created_at` | TIMESTAMPTZ | *(system `createdTimestamp`)* | — | audit only |

---

## 5. Coordinate normalization rule (critical)

Point coordinates (`journeys.center_coordinates`, `waypoints.coordinates`,
`photos.coordinates`) become CloudKit `LOCATION` fields. Source data has **two
encodings** that the importer must normalize:

1. GeoJSON Point object — `{ "type": "Point", "coordinates": [lng, lat] }`
   (bulk-script / `bulkUploadR2.ts` ingested photos).
2. Bare array — `[lng, lat]` (browser-upload `src/lib/exif.ts` photos, and
   `journeys.center_coordinates`, `waypoints.coordinates`).

Normalization at import:

```
function toLocation(raw):
    pair = raw.coordinates ?? raw          # unwrap GeoJSON Point, else bare array
    lng  = pair[0]; lat = pair[1]
    return CLLocation(latitude: lat, longitude: lng)   # NOTE THE SWAP
```

⚠ **Order swap.** Postgres/GeoJSON store **[lng, lat]**; CloudKit `LOCATION`
(and `CLLocationCoordinate2D`) is **(lat, lng)**. The importer must swap. Getting
this wrong silently places every point in the wrong hemisphere — a classic bug.

Elevation is **not** stored in the LOCATION: waypoint altitude stays in the
integer `elevation` field; route/photo elevation is not modeled per-point on these
records (route elevation lives inside `routeJSON`).

---

## 6. JSONB encoding decisions + size analysis

CloudKit hard limit: a single **record** is capped at ~1 MB across all its fields;
CKAssets are separate and large-file friendly. Decision per payload:

| Payload | Encoding | Measured / bounded size | Reason |
|---|---|---|---|
| `journeys.route` (LineString) | **`routeJSON` ASSET** | 3.5–4.3 KB today (144–188 pts, recovered fixtures); a raw/unsimplified multi-day GPX could reach 10²–10³ KB and approach the 1 MB record ceiling | Two reasons: (1) future-proofs against full-fidelity/raw-GPX imports near the ceiling; (2) — the decisive one — `fetchJourneys()` loads **all** journeys for the list/globe; an inline route would drag every route blob on every list load. As an ASSET the bytes are lazy (`downloadURL`) and fetched only when a map/detail view needs them, keeping `Journey` records tiny and list queries fast |
| `journeys.stats` | **`statsJSON` STRING (inline)** | ~170–180 B, fixed 5-key object | trivially small, always loaded with the journey |
| `waypoints.weather` | **`weatherJSON` STRING** | ~150 B, fixed 6-field object | small, atomic with the waypoint |
| `waypoints.fun_facts` | **`funFactsJSON` STRING** | array of `{id,content,category,source?,learn_more_url?,icon?}`; per-waypoint realistically < 5 KB | small; schema-less optional keys map poorly to fixed fields |
| `waypoints.points_of_interest` | **`pointsOfInterestJSON` STRING** | array of `{id,name,category,coordinates,elevation?,description?,tips[]?,…}`; per-waypoint realistically < 20 KB | same |
| `waypoints.historical_sites` | **`historicalSitesJSON` STRING** | array of `{id,name,coordinates,summary,description?,period?,significance?,image_urls[]?,links[{label,url}]?,tags[]?}`; heaviest per-waypoint payload but text/URLs only (no bytes) — realistically < 30 KB | same. **⚠ `image_urls` may point at R2**, which is decommissioned in Phase 5 — at import, keep URLs that resolve to stable external hosts (e.g. Wikimedia) and flag/re-point any that resolve to R2. These are references *inside* text, not CKAssets |

**Waypoint record total:** sum of the four JSON strings + `highlights` list +
scalars. Even a content-rich waypoint stays well under 50 KB — comfortably below
the 1 MB record limit — so inline STRING is safe and preserves the exact nested
structure for round-trip (the app consumes them as parsed JSON in `transforms.ts`).

**Why JSON-in-STRING and not child records** for these four: they are read/written
atomically with the waypoint, are small, have variable optional shapes, and the app
already treats them as opaque parsed JSON. Modeling them as CloudKit records would
add query fan-out for zero benefit.

---

## 7. Identity: `profiles` + `journey_members` → CloudKit (both dropped)

Neither table exists in CloudKit.

### `profiles` → **dropped**
User identity comes from CloudKit, not a stored table:
- **Author of a record** = system `creatorUserRecordID` (set by CloudKit on write).
- **Display name / avatar** = the participant's `CKShare.Participant.userIdentity`
  (`nameComponents`, and a `lookupInfo` email/phone), surfaced *with the user's
  permission* — the same identity Apple shows in Shared Albums / Notes. Not stored
  by us. `profiles.email` / `profiles.display_name` / `profiles.avatar_url` have no
  CloudKit column.

⚠ **Migration attribution caveat.** The import runs entirely in the **owner's**
context, so `creatorUserRecordID` on every migrated record is the owner — original
authorship of family-written `day_comments` would be lost. To preserve it for
display, `DayComment` carries an explicit **`authorDisplayName` STRING**, populated
at import from the old `profiles.display_name` (joined via
`day_comments.user_id → profiles.id`). New comments written natively leave it empty
and fall back to `creatorUserRecordID`'s participant identity. This field exists
purely to keep historical attribution readable after migration.

### `journey_members` → **dropped**, replaced by `CKShare` participants
| Postgres | CloudKit |
|---|---|
| `journey_members.role = owner` | zone / private-DB **owner** (exactly one; cannot be removed — CloudKit enforces the old `prevent_last_owner_removal()` trigger for free) |
| `journey_members.role = editor` | `CKShare.Participant` permission **`.readWrite`** |
| `journey_members.role = viewer` | `CKShare.Participant` permission **`.readOnly`** |
| `journey_members.invited_by` | the ShareLink/`UICloudSharingController` invitation flow (who sent the invite); not a stored field |
| `add_journey_creator_as_owner()` trigger | implicit — the zone owner is the creator |
| UNIQUE(journey_id, user_id) | implicit — one participant entry per identity per share |

Access control that was RLS on `journey_members` is now enforced by CloudKit:
database scope (private vs shared) + the `CKShare` participant permission. The
per-record `GRANT` roles in the schema are the CloudKit defaults and are inert
inside the private/shared DBs (they matter only for the public DB, §8).

---

## 8. `is_public` + public showcase publishing

Public DB is world-readable (`GRANT READ TO "_world"`); the web reads it via
CloudKit JS + a public API token, **no sign-in required** (D6/D9).

**Publish flow (owner's native app), triggered when `Journey.isPublic` flips true:**
1. Upsert a **`PublicJourney`** record (public DB) = journey metadata +
   `heroThumb` + `routeJSON` + `statsJSON` + `waypointsJSON`. **No `original`
   photos, ever.**

   `waypointsJSON` (added 2026-07-22, T3.3) carries the full day/camp payload —
   names, notes, highlights, weather, fun facts, POIs, historical sites. This
   content was always public: the old akashic.no shipped it as fixtures in a
   public repo, and without it the signed-out showcase loses the entire day
   experience. D9's quota concern was full-resolution *photos*, which stay
   private. As an ASSET it is fetched lazily, so the metadata record stays tiny.
2. Upsert one **`PublicPhoto`** per journey photo = **`thumb` only** (400px, q80),
   plus `journeySlug` (QUERYABLE, the join key the web queries on), `caption`,
   `takenAt`, `coordinates`, `dayNumber` (for day-grouping the showcase without
   exposing private `Waypoint` records), `sortOrder`.
3. When `isPublic` flips false, delete that journey's `PublicJourney` + all its
   `PublicPhoto` records.

**Why a separate `PublicPhoto` record type instead of one `PublicJourney` with an
ASSET-list of thumbs (D9 quota reasoning):**
- Public-DB quota scales per active user and is small for a family app; the guard
  that matters is keeping public records *lean*. A single journey record holding an
  ASSET list of 84+ thumbnails would be a heavy record dragged on every metadata
  read. Separate `PublicPhoto` records let the web query thumbs lazily by
  `journeySlug` and page them, keeping the `PublicJourney` metadata record tiny and
  fast to load for the globe/showcase.
- Thumbnails only (~20–50 KB each). The real archive is 1538 photos across 3
  journeys ⇒ ~1538 `PublicPhoto` + 3 `PublicJourney` records, roughly 30–75 MB of
  asset storage — well inside the public-DB baseline, and full-resolution
  originals never leave the private DB. (An earlier draft said ~96 photos; that
  predated the full import.)

All 3 current journeys are `is_public = true`, so the first publish creates 3
`PublicJourney` + ~1538 `PublicPhoto` records.

Public identity/write model: only the owner writes the public mirror
(`GRANT WRITE TO "_creator"`); the world only reads it.

---

## 9. Reference delete actions (not in schema — set at write time)

CloudKit does **not** express reference delete actions in the `.ckdb` schema, and a
`REFERENCE` field cannot constrain its target record type. Both are properties of
the `CKReference` **value** created at record-write/import time:

| Reference | PG behaviour | CloudKit action (set on the value) |
|---|---|---|
| `Waypoint.journeyRef → Journey` | ON DELETE CASCADE | `.none` — the zone cascades (see below) |
| `Photo.journeyRef → Journey` | ON DELETE CASCADE | `.none` — the zone cascades (see below) |
| `Photo.waypointRef → Waypoint` | ON DELETE **SET NULL** | `.none` (orphan; see §4 dangling-ref note) |
| `DayComment.journeyRef → Journey` | ON DELETE CASCADE | `.none` — the zone cascades (see below) |
| `DayComment.waypointRef → Waypoint` | ON DELETE CASCADE | `.deleteSelf` (cascade) |

**The zone is the cascade boundary.** Every child lives in the journey's zone, so
deleting a whole journey = deleting the zone, which removes all children regardless
of reference action. `journeyRef` therefore uses `.none`.

This is not merely a simplification — an owning (`.deleteSelf`) reference to the
journey is actively **wrong at our scale**. CloudKit caps the number of owning
references pointing at a single record at roughly **750**; the first real import hit
`CKError "Limit Exceeded" (27/2023) — "Limit exceeded for number of owning references
to single record"` on the Kilimanjaro zone, whose Journey record is the parent of 939
photos. 197 photo records failed to save (939 − ~742). Using `.none` removes the cap
entirely without losing any delete semantics.

`.deleteSelf` survives only on `DayComment.waypointRef`, where it does real work
(deleting one waypoint should take its comments with it) and the fan-out per waypoint
stays far below the cap.

---

## 10. `day_comments` → `DayComment` (private DB, journey zone)

| Postgres column | Type | CloudKit field | CloudKit type | Notes |
|---|---|---|---|---|
| `id` | UUID | *(recordName)* | — | |
| `waypoint_id` | UUID FK CASCADE | `waypointRef` | REFERENCE | QUERYABLE. `.deleteSelf` (§9) |
| `journey_id` | UUID FK CASCADE | `journeyRef` | REFERENCE | QUERYABLE. `.none` — zone cascades (§9) |
| `user_id` | UUID FK → profiles | *(system `creatorUserRecordID`)* + `authorDisplayName` | — / STRING | author identity (§7); `authorDisplayName` preserves migrated attribution |
| `content` | TEXT (CHECK 1–2000) | `content` | STRING | length CHECK not enforceable in CloudKit; validate in app |
| `created_at` | TIMESTAMPTZ | `createdAt` | TIMESTAMP | QUERYABLE SORTABLE — **explicit field, not the system timestamp**: the app sorts comments by `created_at` and the import writes them all at once, which would collapse system `createdTimestamp` to migration time. The explicit field preserves original order |
| `updated_at` | TIMESTAMPTZ | `modifiedAt` | TIMESTAMP | explicit, populated from PG (system `modifiedTimestamp` also exists but reflects CloudKit writes) |

---

## 11. Export/import order

Respect the dependency graph (zone root first, then children, comments last):

`Journey` (create zone + root) → `Waypoint` → `Photo` → `DayComment`,
then per-journey `CKShare`, then (for public journeys) `PublicJourney` +
`PublicPhoto`. `profiles` / `journey_members` are consumed during import (for
`authorDisplayName` and share-participant setup) but produce no records.

---

## 12. Zone & sync-strategy trade-off (the open D4/T2.3 decision)

Everything in this document assumes **custom CKRecords** (`Journey`/`Waypoint`/
`Photo`/`DayComment`) in **per-journey zones** — that is what `schema.ckdb`, the
web adapter (`src/lib/journeys/adapters/cloudkit/`), and the Phase-2 importer
design all consume.

The scaffolded app's `.cloudKit` persistence mode is a **placeholder** built on
`NSPersistentCloudKitContainer`, and NSPCKC does **not** produce this schema. On
first launch against a real container it generates its own record types —
`CD_CDJourney`, `CD_CDWaypoint`, `CD_CDPhoto`, `CD_CDDayComment` with
`CD_`-prefixed fields — inside the single managed zone
`com.apple.coredata.cloudkit.zone`. The two worlds do not interoperate.

**Option A — custom CKRecord sync (recommended by this document's design):**
implement sync with `CKSyncEngine` (iOS 17+) against the hand-authored schema:
per-journey zones, `CKShare` on the zone, recordNames = original UUIDs. Pros:
schema.ckdb + web adapter + importer all work as designed; sharing model maps
1:1 to `journey_members`; full control. Cons: hand-rolled sync state machine
(engine callbacks, change tokens, conflict handling) — the cost D4 flagged.

**Option B — accept NSPCKC's generated schema:** keep Core Data + NSPCKC and let
it own the container. Pros: sync, offline, and asset promotion come "for free";
sharing via `NSPersistentCloudKitContainer.share(_:to:)` (zone management is
Apple's). Cons: `schema.ckdb` becomes dead weight; the web adapter must be
rewritten to query `CD_CDJourney`-style types (CloudKit JS *can* read them, but
field names/types are compiler-shaped, `CD_`-prefixed, and include NSPCKC
bookkeeping); the importer must write through Core Data rather than CKRecords;
per-journey zone naming and recordName=UUID stability are lost (NSPCKC manages
zones/record metadata itself).

**Decision gate:** pick A or B in T2.3 (= decision D4) *before* importing
`schema.ckdb` into Production or building the Phase-2 importer. Everything
shipped tonight is Option-A-shaped; choosing B invalidates §§1–11's zone and
naming guarantees and the web adapter's record queries. Do not flip the app's
`.cloudKit` mode against the real container until this is decided.

---

## 13. Photo architecture v2 — thumbnails-first sync, originals on demand

**Supersedes the §4 single-record design** (`original` + `thumb` both ASSETs on
the one `Photo` record). That design made first sync ≈ 5.4 GB: `CKSyncEngine`
materializes every asset in the zones it fetches, so pulling the journey zones
pulled every full-resolution original. v2 keeps the product's real shape — a
curated shared archive whose originals stream on demand — and brings first sync
to ≈ 75 MB (metadata + thumbnails).

### The split

- **`Photo` record (journey zone, unchanged location):** metadata + `thumb`
  ASSET only. `original` is **no longer written** by ingest or native edits
  (`RecordCoder.record(for:)` defaults `includeOriginal: false`; the field stays
  in the schema and is left untouched on edits — never nil-assigned — so a
  momentary read failure can't delete a server copy). The migration importer is
  the one exception (`includeOriginal: true`); the repack below clears those.
- **New record type `PhotoMedia`:** fields `photoId` STRING QUERYABLE,
  `journeyId` STRING QUERYABLE, `original` ASSET. `recordName = media-<photoId>`.
- **Media zone:** `PhotoMedia` records live in a per-journey **media zone**,
  `zoneName = journey-<uuid>-media` (the journey's zone name + `-media`), in the
  same database/owner as the journey zone.
- **`Journey.mediaShareURL` STRING:** the media zone's `CKShare` URL, set by the
  owner when the journey is shared, so participants auto-accept the media share.

### Engine fetch exclusion

Both engines exclude every `-media` zone from their fetch scope
(`nextFetchChangesOptions → .allExcluding(mediaZoneIDs)`), derived **dynamically**
from the local journeys, so a journey created after the engine was built is
covered without a rebuild. It composes with the Wi-Fi cellular gate (both mutate
the same options). A media-zone deletion event is routed separately
(`journeyID(fromZoneID:)` returns nil for media zones): the owner re-uploads that
journey's `PhotoMedia` from local bytes (`onMediaZoneLost` → `healMediaZone`); a
participant, holding no originals, just keeps streaming what remains.

### Send path (the deliberate choice)

`PhotoMedia` saves/deletes go **DIRECT via `CKDatabase`** (chunked `modifyRecords`,
`.allKeys`), **not** through `CKSyncEngine`. Reason: the engines deliberately
never *fetch* the media zones, so routing media *sends* through the engine would
leave it tracking change tags for records it never fetches back, on every device
— dead, asymmetric bookkeeping. Direct DB writes keep the engine's world purely
metadata, mirror the importer's proven batching, and are the natural counterpart
to the on-demand `records(for:)` read. See `MediaDatabase` / `PhotoMediaService`.
User-initiated ingest media uploads are **not** Wi-Fi-gated (one ~4 MB original
the user just added); the batch repack **is**.

### On-demand originals

`MediaFetcher.originalURL(for:)`: local hit first (the same stale-path-tolerant
`resolveMedia`), else fetch `media-<id>` with `records(for:)` from the correct
database (owner → private; shared-in → shared, routed via the stored zone owner),
copy the bytes into the media root under the photo's canonical key (a local hit
forever after), return the file URL. Single in-flight fetch per photo id. A single
on-demand original is allowed on cellular (the user tapped it); batch
prefetch/export goes through the same fetcher and can be Wi-Fi-gated at the call
site.

### The automatic one-time repack

`MediaRepackJob` runs on launch in `.cloudKit` mode, **owner only**. It finds
migrated photos that still carry `original` locally-known bytes but have no
confirmed `PhotoMedia`, uploads each from **local bytes** (never downloaded,
chunked like the importer), then clears `Photo.original` via the engine (a normal
local edit whose encode omits the field once the `media-<id>` completion is
recorded — see `makeRecord`). It is:

- **resumable** — completion is a `CDSyncRecordMeta` row keyed `media-<photoId>`,
  persisted per record; **no Core Data migration was needed** for progress. A
  kill mid-run resumes from the remainder.
- **idempotent** — a second run finds nothing pending.
- **skip-when-bytes-missing** — a photo with no local original is never pending,
  so a participant / partial store neither loops nor errors.
- **Wi-Fi-gated + throttled** — pauses on cellular and resumes on a cheap path;
  yields between batches so it never starves interactive use.
- **surfaced** — `SyncStatus.repackSummary` → "Optimizing photo storage · 412/1538".

### Sharing

Creating a journey's data share also ensures its media zone + a `CKShare` on it and
publishes the URL onto `Journey.mediaShareURL` (synced via the engine). On the
participant, a shared journey arriving with a `mediaShareURL` it hasn't accepted
triggers `MediaShareAutoAccepter` — a background `CKFetchShareMetadataOperation` →
`container.accept`, silent and retry-tolerant; a failure **degrades to
thumbnails** with a quiet log, never a dialog. Unshare stops the media share and
clears the URL.
