# CloudKit Schema — import & verify

This directory holds the CloudKit schema for the Akashic Apple migration.

- **`schema.ckdb`** — CloudKit Schema Language definition of all record types.
- **`MAPPING.md`** — authoritative Postgres → CloudKit field mapping (read this first
  to understand *why* the schema looks the way it does).
- **`README.md`** — this file: how to import and verify the schema.

Container: **`iCloud.no.akashic`** · Record types: `Journey`, `Waypoint`, `Photo`,
`DayComment` (private + shared DB) and `PublicJourney`, `PublicPhoto` (public DB).

The schema was authored **offline** on a machine with no container/token. Nothing here
has been validated against a live container — the first real validation is the
`validate-schema` / `import-schema --validate` step below. See
[§4 Syntax to verify on first import](#4-syntax-to-verify-on-first-import).

`cktool` version this was written against: **1.0.23001**
(`xcrun cktool version`).

---

## 1. One-time: save a management token

Schema import needs a **management** token (not a user or server-to-server token).

1. CloudKit Console → your container `iCloud.no.akashic` → **Tokens** (or Apple
   Developer → CloudKit Console → Settings → Tokens) → create a **management token**.
2. Save it for `cktool` (stored in the login keychain by default):

   ```sh
   xcrun cktool save-token --type management
   # paste the token at the secure prompt (omit it from the command line so it
   # isn't captured in shell history)
   ```

   Alternative, file-based (writes `~/.config/cktool`), if you prefer not to touch
   the keychain:

   ```sh
   xcrun cktool save-token --type management --method file
   ```

   Once saved, the `--token` flag can be omitted from every command below; `cktool`
   reads the stored token automatically.

3. Find your **team id** (Apple Developer Program team identifier, 10 chars):

   ```sh
   xcrun cktool get-teams
   ```

---

## 2. Validate, then import to Development

Set these once in the shell (fill in the team id from step 1):

```sh
TEAM_ID=<your-10-char-team-id>
CONTAINER=iCloud.no.akashic
CKDB="$(git rev-parse --show-toplevel)/apple/CloudKit/schema.ckdb"
```

**Validate first (no changes made):**

```sh
xcrun cktool validate-schema \
  --team-id "$TEAM_ID" \
  --container-id "$CONTAINER" \
  --environment DEVELOPMENT \
  --file "$CKDB"
```

Fix any reported errors in `schema.ckdb` (see §4 for the lines most likely to need
adjusting), re-validate until clean.

**Import to the Development environment** (`--validate` re-runs validation as part of
the import):

```sh
xcrun cktool import-schema \
  --team-id "$TEAM_ID" \
  --container-id "$CONTAINER" \
  --environment DEVELOPMENT \
  --validate \
  --file "$CKDB"
```

CloudKit schema import is **additive** — it adds record types, fields and indexes but
does not drop columns you remove from the file. To start over in Development only:

```sh
xcrun cktool reset-schema --team-id "$TEAM_ID" --container-id "$CONTAINER"
# resets Development schema to match Production AND deletes all Development data
```

---

## 3. Promote Development → Production

Do this only after the schema is verified in Development and (per the migration plan,
Phase 2) real data has been imported and spot-checked.

There is no direct `cktool` "promote" subcommand — promotion is done from the
**CloudKit Console**:

1. CloudKit Console → container `iCloud.no.akashic` → **Schema** →
   **Deploy Schema Changes…** → deploy Development schema to Production.
2. Confirm the diff (added record types/fields/indexes) and deploy.

Programmatic alternative (export from Dev, import to Prod), if you want it scripted:

```sh
# capture exactly what Development ended up with (round-trips the DSL)
xcrun cktool export-schema \
  --team-id "$TEAM_ID" --container-id "$CONTAINER" \
  --environment DEVELOPMENT --output-file schema.prod.ckdb

xcrun cktool import-schema \
  --team-id "$TEAM_ID" --container-id "$CONTAINER" \
  --environment PRODUCTION --validate --file schema.prod.ckdb
```

Production schema changes are **additive and permanent** — you cannot delete a field
or record type from Production once deployed. Get Development right first.

---

## 4. Syntax to verify on first import

The schema was hand-authored from the CloudKit Schema Language grammar without a live
validator (`cktool` has no offline validator). These specific points are the most
likely to need a tweak — check them against the first `validate-schema` output. If a
line is rejected, the fix is local and obvious; the field/index *intent* is documented
in `MAPPING.md`.

1. **`STRING LIST` (list fields).** `Waypoint.highlights` is declared
   `highlights STRING LIST` (native multi-value list, mapping the PG `TEXT[]`). Verify
   the list keyword/position — if rejected, the fallback is to encode highlights as a
   JSON string field (`highlightsJSON STRING`) like the other array payloads.

2. **`"___recordID" REFERENCE QUERYABLE` (recordName index).** Each record type
   includes this line to make the record queryable by name — CloudKit requires the
   `recordName` metadata index for a type to be queried at all (the app's
   "list all journeys" and reference-equality queries depend on it). The
   triple-underscore system-field spelling is how `cktool export-schema` emits indexed
   metadata fields; if `import-schema` rejects the literal line, remove it and add the
   **recordName → QUERYABLE** index from the CloudKit Console → Schema → *(record type)*
   → Indexes (the Console auto-manages this index and it round-trips on the next
   export). Do **not** ship without recordName queryable, or `performQuery` calls fail.

3. **`LOCATION` fields.** Used for `centerLocation` / `coordinates`. Confirm the type
   keyword is `LOCATION` (vs any variant). Import stores `(lat, lng)` — see the
   coordinate swap warning in `MAPPING.md` §5.

4. **`TIMESTAMP` keyword.** Used for all date/time fields. Confirm it is `TIMESTAMP`
   (not `DATETIME`).

5. **`ASSET` / `INT64` / `DOUBLE` / `REFERENCE` / `STRING`** and the index keywords
   **`QUERYABLE` / `SEARCHABLE` / `SORTABLE`** — standard; low risk.

Things intentionally **not** in the schema (by design, not omission — see `MAPPING.md`):

- **Reference delete actions** (cascade / none) and **reference target types** — not
  expressible in `.ckdb`; set on the `CKReference` value at import/write time (§9).
- **NOT NULL, defaults, UNIQUE, CHECK/enum constraints** — CloudKit fields are all
  optional and unconstrained at the schema level; the importer and app enforce
  `slug` uniqueness, non-null coordinates, and the `rotation`/`location_source`/`role`
  value sets.
- **`created_at`/`updated_at` audit columns** for `Journey`/`Waypoint`/`Photo` — mapped
  to CloudKit system `createdTimestamp`/`modifiedTimestamp` (not preserved through
  migration; acceptable for audit fields). `DayComment.createdAt`/`modifiedAt` are
  explicit fields precisely because their values must survive migration (§10).

---

## 5. Verify in CloudKit Console

After import:

1. **Schema → Record Types**: confirm all six types exist with the expected fields.
2. **Indexes** per type — confirm the queries the app runs are backed by indexes:
   - `Journey`: `recordName` QUERYABLE, `name` SORTABLE/SEARCHABLE, `slug` QUERYABLE,
     `isPublic` QUERYABLE.
   - `Waypoint`: `journeyRef` QUERYABLE, `sortOrder` SORTABLE.
   - `Photo`: `journeyRef` QUERYABLE, `waypointRef` QUERYABLE, `sortOrder` SORTABLE,
     `takenAt` QUERYABLE/SORTABLE.
   - `DayComment`: `journeyRef` QUERYABLE, `waypointRef` QUERYABLE, `createdAt`
     QUERYABLE/SORTABLE.
   - `PublicJourney`: `slug` QUERYABLE. `PublicPhoto`: `journeySlug` QUERYABLE,
     `sortOrder` SORTABLE.
3. **Round-trip check** — export what actually landed and diff intent vs reality:

   ```sh
   xcrun cktool export-schema \
     --team-id "$TEAM_ID" --container-id "$CONTAINER" \
     --environment DEVELOPMENT --output-file schema.exported.ckdb
   diff schema.ckdb schema.exported.ckdb   # expect only formatting/ordering diffs
   ```

4. **Smoke test a query** (after the first records exist) from Console → *Data* →
   Query records, e.g. `Journey` where `slug == "kilimanjaro"`, and a `Photo` query
   filtered by `journeyRef` sorted by `sortOrder`, to confirm the indexes resolve.

Zones (`journey-<uuid>`) are **created at runtime** by the app/importer, not by the
schema — do not expect to see them in the schema view.
