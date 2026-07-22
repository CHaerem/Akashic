# CloudKit JS adapter — live verification (T3.2)

What the web adapter does against the **real** `iCloud.no.akashic` development
container, and the six ways it was wrong before anyone pointed a browser at it.

Every fault below produced an **empty or null result, never an error**. That is the
theme: the adapter was written against mocks that answered whatever it asked, so
nothing distinguished "the query was rejected" from "there is nothing there".

## Verified (2026-07-22, development container)

| Path | Result |
| --- | --- |
| `fetchJourneys` | 3 journeys, 18 waypoints, routes intact (188 / 144 / 274 points) |
| `fetchPhotos` | **1538** photos — 318 Mount Kenya, 281 Inca Trail, 939 Kilimanjaro |
| Photo assets | every one a signed `cvws.icloud-content.com` URL; images render in the grid and as map markers |
| `taken_at` | 264/318, 276/281, 849/939 — the remainder genuinely lack EXIF dates |
| Day matching | Kilimanjaro spreads 839 photos across all 8 days; Inca across all 5 |
| Caption edit | write → read-back → restore, round-trip confirmed |
| Comments | create → list → update → delete, round-trip confirmed |

## The six faults

### 1. Filtering a reference by a slug

Callers pass `TrekConfig.id`, which is the **slug** (`kilimanjaro`). `journeyRef` holds
a **reference to a UUID**. `filterBy: [{ fieldName: 'journeyRef', fieldValue: { value:
journeyId } }]` therefore compared a reference against a string; CloudKit answered
`could not decode reference object`, `catch(() => [])` swallowed it, and a journey with
939 photos rendered as having none.

**Fix:** one journey owns one zone (D3), so scoping the query to the zone *is* the
filter. `journeyZones.ts` maps slug → zone, populated as a side effect of
`fetchJourneys`.

### 2. Reference predicates need a reference, not a string

Where a predicate genuinely is needed (`waypointRef`), the value must be
`{ value: { recordName, zoneID }, type: 'REFERENCE' }`. A bare string is rejected.

### 3. Dates are TIMESTAMPs, not ISO strings

Every date in the schema is a CloudKit `TIMESTAMP` — epoch **milliseconds as a
number**. Reading them with a string accessor returned null for all of them, silently:

- journeys lost their date ranges;
- **all 1538 photos lost `taken_at`** — and `usePhotoDay` matches a photo to its day
  from `taken_at`, so every photo fell through to the coarser route-proximity tiers.

### 4. The zone belongs in the options argument

`saveRecords(record)` with `zoneID` set *on the record* is accepted without complaint
and ignored: the save is aimed at the default zone, where the record does not exist,
and returns `recordChangeTag specified, but record not found`. It must be
`saveRecords([record], { zoneID })`. The same is true of `performQuery`,
`fetchRecords` and `deleteRecords`.

### 5. Writes were aimed at the shared database unconditionally

Every write went to `getSharedDatabase()`. For a journey the signed-in user owns, that
fails with `zoneID needs to have ownerRecordName field for calls to sharedb`. The
database follows the zone: private when owned, shared when invited.

### 6. `hasErrors` is not optional

CloudKit JS resolves the promise on a rejected write and reports it in
`response.hasErrors` / `response.errors`. Not checking it turns a failed save into a
silent no-op — which is how the caption edit looked like it worked while changing
nothing.

## Known, not bugs

- **`waypointRef` is unset on every migrated photo.** Day assignment was derived from
  `taken_at` under Postgres too; `usePhotoDay` still does it. `getPhotosForWaypoint`
  legitimately returns nothing for imported photos.
- **`recordName` is not a queryable field.** Fetch a record by name; you cannot filter
  by it.
- **A query issued immediately after an identical one can serve a stale result.** A
  freshly created comment was missing from a re-query that repeated one made moments
  earlier, then appeared on the next call. The UI should insert optimistically rather
  than refetch to confirm a write it already knows succeeded.

## Data discrepancy worth a human decision

**Mount Kenya is dated a year before its own photos.** The journey record says
`2023-10-10`; the 264 dated photos run `2024-10-10` → `2024-10-17` — same day and
month, one year apart. That looks like a typo in the journey record rather than bad
EXIF, but only Christopher knows which year he climbed it. Until it is settled, date
matching finds no day for any Mount Kenya photo and they fall through to route
proximity.

## Running it

```bash
VITE_DATA_BACKEND=cloudkit npm run dev
```

with `VITE_CLOUDKIT_API_TOKEN` and `VITE_CLOUDKIT_ENV=development` in `.env.local`.
Sign in with the Apple ID that owns the container.

Note that the **test suite pins `VITE_DATA_BACKEND=supabase`** (`vite.config.js`).
Without that pin the suite read whatever was in a developer's `.env.local`, and running
the app against CloudKit locally made 33 Supabase-mode tests fail with no change to
the code.
