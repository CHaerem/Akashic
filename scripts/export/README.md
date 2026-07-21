# Akashic export / salvage tooling

Data-freeze + export for the Apple/CloudKit migration (APPLE-MIGRATION-PLAN.md
**Section 6 — Data Migration**). Produces one canonical JSON shape (the effective
Postgres schema, snake_case) plus a local copy of every R2 object, so the native
"Import" screen has a single input format regardless of how the data was rescued.

> **Golden rule (plan §6):** keep **R2 and Supabase READ-ONLY** until
> `verifyExport.ts` reports **PASS**. These scripts only ever `SELECT` / `List` /
> `Head` / `Get` — they never write back to either source.

---

## ⚠️ Read this first — is Supabase even alive?

As of the migration audit, the Supabase host
`pbqvnxeldpgvcrdbxcvr.supabase.co` **did not resolve (NXDOMAIN)**. Supabase free
tier **pauses** dormant projects and eventually **deletes** them. The Cloudflare
Worker + R2 bucket (`akashic-media`) are still alive.

So there are two paths. Pick with this decision tree:

```
Can you open the Supabase dashboard and the project still exists?
│
├─ YES ─ Is it just PAUSED?  ── Restore it (dashboard → Restore), wait for the
│         host to resolve, then run PATH A (full-fidelity dump). Also run the
│         R2 pull. This is the complete, lossless export.
│
└─ NO / DELETED ─ Supabase data is gone. Run PATH B (salvage): reconstruct from
          the R2 bucket + EXIF + the recovered git fixtures. Lossy but recovers
          the journeys, routes, waypoints, and every photo/video.
```

**Questions only Christopher can answer (check the Supabase dashboard):**

1. Does the project `pbqvnxeldpgvcrdbxcvr` still exist in the dashboard, or is it
   gone? (Paused → PATH A after restore. Deleted → PATH B.)
2. If it exists: is it **Paused** or **Active**? If paused, restore and confirm
   `https://pbqvnxeldpgvcrdbxcvr.supabase.co` resolves before running PATH A.
3. Do you still have the **service-role key** (dashboard → Project Settings → API)?
   PATH A needs it (it bypasses RLS for a complete dump).
4. Do you have **R2 S3 API credentials** (Cloudflare dashboard → R2 → Manage API
   Tokens: Account ID + Access Key ID + Secret)? Both paths need these for the
   photo/video bytes.

---

## Runtime — no build step, no new deps

Scripts are TypeScript run directly. Two options:

- **Node ≥ 23.6** (this machine has v23.6.1) — native type-stripping, nothing to install:
  ```bash
  node scripts/export/exportFromSupabase.ts
  ```
  (Node prints one `ExperimentalWarning: Type Stripping` line — harmless.)
- **Or `tsx`** if you prefer (fetched on demand, not added to package.json):
  ```bash
  npx tsx scripts/export/exportFromSupabase.ts
  ```

Only dependencies already in `package.json` are used: `@supabase/supabase-js`,
`@aws-sdk/client-s3`, `exifr`. **`package.json` is intentionally not modified** —
invoke via the full path as shown.

Output goes to `./export/` by default (override with `--out <dir>` or `EXPORT_DIR`).

---

## PATH A — Supabase is restorable (full fidelity)

```bash
# 1. Full DB dump  (needs the project live + service-role key)
SUPABASE_URL="https://pbqvnxeldpgvcrdbxcvr.supabase.co" \
SUPABASE_SERVICE_KEY="<service-role-key>" \
node scripts/export/exportFromSupabase.ts

# 2. Pull every R2 object locally
CLOUDFLARE_ACCOUNT_ID="<account-id>" \
R2_ACCESS_KEY_ID="<r2-access-key-id>" \
R2_SECRET_ACCESS_KEY="<r2-secret>" \
node scripts/export/pullR2Archive.ts

# 3. Verify (must say PASS before you import anything)
node scripts/export/verifyExport.ts
```

Produces:

```
export/
  supabase/         profiles.json journeys.json journey_members.json
                    waypoints.json photos.json day_comments.json   (raw truth)
  normalized/       photos.json   (coordinates unwrapped to [lng,lat])
  manifest.json     row counts, per-file sha256, exported_at, project_url
  r2/
    inventory.json  every object: key, size, etag, customMetadata (from HeadObject)
    inventory-summary.json
    objects/<key>   every downloaded original + thumbnail (paths preserved)
  verification-report.md
```

## PATH B — Supabase is gone (salvage)

```bash
# 1. Pull R2 (inventory + all objects). --inventory-only if you only want the list first.
CLOUDFLARE_ACCOUNT_ID="..." R2_ACCESS_KEY_ID="..." R2_SECRET_ACCESS_KEY="..." \
node scripts/export/pullR2Archive.ts

# 2. Reconstruct. First run writes export/salvage/slugMap.json (a template).
node scripts/export/salvageReconstruct.ts

# 3. Fill in export/salvage/slugMap.json — map each journey UUID to a slug:
#      "kilimanjaro" | "mount-kenya" | "inca-trail"
#    (UUID↔slug cannot be derived from R2 alone.) Then re-run:
node scripts/export/salvageReconstruct.ts

# 4. Verify.
node scripts/export/verifyExport.ts
```

Produces `export/salvage/{journeys,waypoints,photos}.json` in the **same shape**
as PATH A's tables, plus `export/salvage/manifest.json` with a **`SALVAGE-GAPS`**
section spelling out what was recovered (and from where) vs. what is lost.

### What salvage recovers vs. loses

| Recovered | From |
|---|---|
| photo/video files, ids, journey grouping, thumbnail pairing | R2 key scheme `journeys/{uuid}/photos/{id}[_thumb].{ext}` |
| photo `taken_at` + GPS (images) | EXIF (`exifr`) on downloaded originals |
| video `taken_at` (fallback) | R2 `customMetadata.uploadedAt` |
| photo `uploaded_by` (if present) | R2 `customMetadata.uploadedBy` |
| routes, stats, summit, dates, descriptions, highlights, waypoint coords/day/elevation | `apple/Fixtures/recovered/*.json` + `trekConfig` |

| Lost if Supabase is truly gone |
|---|
| photo **captions**, photo↔waypoint **assignments**, `is_hero`, video `duration`, non-zero `rotation` |
| **`day_comments`** (the whole family-written table) |
| **`journey_members` / `profiles`** (sharing roles + author identities → rebuilt as CKShare participants anyway) |
| `weather`, `fun_facts`, `points_of_interest`, `historical_sites` (post-Nov-2025 enrichment) |
| `arrival_time` / `departure_time`; any edits made after the recovered fixtures were captured |
| exact waypoint UUIDs (regenerated as deterministic synthetic ids), exact `sort_order` / `created_at` (approximated) |

---

## Scripts

| Script | Path | What it does |
|---|---|---|
| `exportFromSupabase.ts` | A | Every table → `supabase/<table>.json` (pretty, sorted by id) + `manifest.json` (counts, sha256) + `normalized/photos.json`. Paginates >1000 rows via PostgREST range headers. Env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. |
| `pullR2Archive.ts` | A+B | `ListObjectsV2` + `HeadObject` (concurrency 8) → `r2/inventory.json`; downloads all objects → `r2/objects/<key>` with **resume** (skip same-size files), progress, per-journey byte summary. Env: `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (default `akashic-media`). `--inventory-only` to skip downloads. |
| `salvageReconstruct.ts` | B | R2 inventory + EXIF + fixtures → `salvage/{journeys,waypoints,photos}.json` + `SALVAGE-GAPS` manifest. Uses `slugMap.json`. `--repo <root>` if not auto-detected. |
| `verifyExport.ts` | A+B | DB↔R2 both directions (missing/orphan), thumbnail coverage, byte totals, md5-vs-ETag spot checks, coordinate-encoding stats → `verification-report.md`. Exit **2** if any hard check fails. |
| `lib.ts` | — | Pure helpers (coordinate unwrap, R2-key parse, thumb pairing, fixture→snake_case, hashing). No I/O. |
| `io.ts` | — | fs/env/CLI helpers. |
| `smoke.ts` | — | Unit smoke test for `lib.ts`. |

Env aliases accepted for R2 (compat with the older repo scripts):
`R2_ACCESS_KEY_ID` = `CLOUDFLARE_R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` = `CLOUDFLARE_R2_SECRET_ACCESS_KEY`,
`R2_BUCKET` = `CLOUDFLARE_R2_BUCKET_NAME`.

---

## Expected sizes & runtime

- **3 journeys**, **18 waypoints**, **~96 videos** (Kilimanjaro 84, Inca 7, Kenya 5)
  plus photos. DB dump is small (seconds, a few MB of JSON).
- The R2 pull is dominated by video bytes — expect it to take a while and consume
  the corresponding disk space under `export/r2/objects/`. Re-running resumes
  (same-size files are skipped), so an interrupted pull is safe to restart.
- Two encodings live in `photos.coordinates`: GeoJSON `{type:'Point',coordinates:[lng,lat]}`
  (bulk-upload path) **and** bare `[lng,lat]` (browser-upload path). Everything here
  handles both; `verifyExport.ts` tallies them.

## Develop / test

```bash
# Typecheck (strict)
npx tsc --noEmit -p scripts/export/tsconfig.json

# Pure-function smoke test
node scripts/export/smoke.ts
```
