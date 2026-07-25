# Apple Migration — Operator Runbook

> **⏰ MORNING STEPS (written overnight 2026-07-22 → 23) — ~10 minutes total:**
>
> 1. **Re-enter your Apple ID password on the simulator** (iPhone 17 Pro). iOS
>    demanded account re-verification last night, which blocked every CloudKit
>    call ("iCloud temporarily unavailable" in the app's Settings — the status
>    row caught it). Simulator → Settings → tap the banner → password.
> 2. **Publish the showcase (first real run):** the Debug-CloudKit build is
>    already installed. Launch Akashic (it needs the CloudKit env; easiest from
>    terminal):
>    `SIMCTL_CHILD_AKASHIC_CLOUDKIT=1 SIMCTL_CHILD_AKASHIC_SYNC_LOG=1 xcrun simctl launch --terminate-running-process 5B09400C-4865-4044-8398-5BB050B762C9 no.akashic.app`
>    Then per journey: **Journeys → ⋯ → Showcase → Publish/Update**. Kilimanjaro
>    uploads 939 thumbs — expect a few minutes; watch the progress bar and the
>    result summary (published / skipped / removed / failed).
> 3. **See the public showcase:** open a private browser window on
>    `http://localhost:5173` (`npm run dev`) — the globe should show the
>    published journeys with days and thumbnails, **no sign-in**. Deep link:
>    `?journey=kilimanjaro`. That closes T3.3's acceptance.
> 4. **Verify the first-save fix while you're in the app:** edit any photo
>    caption. In the sync log, the save should succeed on the FIRST
>    `sentRecordZoneChanges` (no `code=14` line) followed by
>    `recordsDidSave: stored systemFields`.
> 5. Then the standing items: **merge PR #41**, add family TestFlight testers
>    (§4/§7), and answer whether anyone in the family uses Windows (decides the
>    web client's long-term scope, D6).

**Who this is for:** Christopher (chris.haerem@gmail.com), the owner. Every step below needs a
credential, an Apple/Cloudflare/GitHub account, or a physical device that an agent does **not**
have. Do these yourself, in order. Everything else in the migration (code, schema files, export
scripts, docs) is done by the agents.

**Companion docs:** [`APPLE-MIGRATION-PLAN.md`](./APPLE-MIGRATION-PLAN.md) (phases, decisions, DNS
records). Read Step 0 before anything else.

### Conventions

- **Hand back →** what to give the agent after a step. Put tokens/keys/IDs into `.env` (local) or
  GitHub Secrets/Variables **yourself**. **Never paste a secret into chat.** Tell the agent only
  *"done, `VITE_X` is set"* — the value stays out of the transcript.
- ☐ = a checkbox to tick as you go.

---

## STEP 0 — URGENT DATA TRIAGE — ✅ RESOLVED (2026-07-21 → 22)

> ### ✅ Outcome — data rescue complete
>
> The project was **paused, not deleted**. Christopher **resumed it ~23:00 on 2026-07-21** and the full rescue completed the same night:
> - **Supabase export:** 3 journeys · 18 waypoints · **1538 photos** · 3 profiles/members · **0 day_comments**.
> - **R2 archive:** **8 147 objects · 16.41 GB** pulled in full.
> - **Verification (`verifyExport`) PASSED:** **0 missing originals/thumbs**; 2 747 orphan R2 objects (old/pre-migration formats, spot-checked clean — harmless).
> - **Archive location:** `/Users/cher/Privat/AkashicExport-20260722` (duplicated offline).
> - **akashic.no re-verified live** (E2E: chromium 16 pass / mobile-chrome 23 pass).
>
> **Still in force:** keep Cloudflare (Worker, R2, Pages, DNS) and Supabase **read-only until the Phase 5 gate** — do not run any upload/delete script against R2, and do not delete anything until the family has used the native app ≥1 month.
>
> The original triage steps below are retained for the record; **no action is outstanding here.**

**Why this was first:** Tonight's recon found the Supabase project
`pbqvnxeldpgvcrdbxcvr.supabase.co` **no longer resolves in DNS (NXDOMAIN)**. The repo has been
dormant since **2025-12-26 (~7 months)**. Supabase free-tier projects pause after ~1 week idle and
become **eligible for deletion / data loss after ~90 days paused** — we are well past that window.
The public site `akashic.no` still serves (static assets on Cloudflare Pages), but **its data layer
is dead**.

**What is safe:** The Cloudflare Worker and the R2 bucket `akashic-media` are **alive** (verified
tonight). All photo and video **bytes** (~96 videos + photos) are safe in R2.

**What is at risk — lives ONLY in Postgres:** captions, `day_comments`, photo↔waypoint/day
assignments, the `weather` / `fun_facts` / `points_of_interest` / `historical_sites` JSONB payloads,
`journey_members`, profile display names, and **any route edits made after Nov 2025**.

**What we already salvaged:** a partial offline backup of pre-Supabase trek data (routes, camps,
descriptions **as of 2025-11-26**) is recovered from git history into
[`apple/Fixtures/recovered/`](./apple/Fixtures/recovered/). Anything entered *after* that date exists
only in the (currently unreachable) Postgres.

### Do this now, in order

☐ **1. Log in:** go to <https://supabase.com/dashboard> and sign in.

☐ **2. Find the project:** locate project **ref `pbqvnxeldpgvcrdbxcvr`** (org/project list, or open
   `https://supabase.com/dashboard/project/pbqvnxeldpgvcrdbxcvr` directly). Note its status.

☐ **3a. If status is "Paused" / "Inactive":**
   - Click **Restore / Resume project** immediately. Wait for it to come back online.
   - Open **Table Editor** and confirm rows exist in `journeys`, `waypoints`, `photos`,
     `day_comments`, `journey_members`, `profiles`.
   - **The same day**, run the export (see [`scripts/export/README.md`](./scripts/export/README.md)) to
     dump every table to JSON. *If the export scripts aren't in the repo yet* (parallel workstream),
     use the dashboard **SQL Editor** or `pg_dump` against the connection string in
     **Project Settings → Database** as an immediate fallback — get the data OUT today, tidy later.

☐ **3b. If the project is "Deleted" / missing:**
   - In the dashboard check **Project Settings → General → Backups / Restore** for any downloadable
     backup.
   - Open a support ticket at <https://supabase.com/dashboard/support/new> — recently-deleted
     projects have occasionally been recoverable. Do this ASAP; the window is short.

☐ **3c. If the data is truly gone:**
   - The salvage path [`scripts/export/salvageReconstruct.ts`](./scripts/export/salvageReconstruct.ts)
     rebuilds what it can from **R2 objects + photo EXIF + git history + `apple/Fixtures/recovered/`**.
     Captions and post-Nov-2025 edits are unrecoverable; coordinates, dates, routes, and camp
     structure are.

☐ **4. Freeze Cloudflare.** Do **NOT** delete or modify the Worker, R2 bucket, Pages project, or DNS
   until the migration completes (Phase 5 gate in the plan). Treat **R2 as read-only** from now on —
   do not run any upload/delete script against it.

**Hand back →** tell the agent the project status (paused/restored/deleted) and, if exported, that a
JSON dump exists and where you saved it (e.g. a local `export/` folder, kept offline).

---

## 1. CloudKit container + App ID — ✅ DONE (2026-07-22)

> **Outcome:** App ID `no.akashic.app` (+ `no.akashic.app.widgets`), container `iCloud.no.akashic`,
> and App Group `group.no.akashic` were registered on team **9LVCB72DT8** via Xcode automatic
> signing (Release-CloudKit config now carries `DEVELOPMENT_TEAM` in `project.yml`). Verified
> server-side with `cktool`. Note for future headless provisioning: `xcodebuild
> -allowProvisioningUpdates` cannot read the Xcode account session from a terminal — either use
> the Xcode GUI once per new capability, or create an App Store Connect API key and pass
> `-authenticationKeyPath/-authenticationKeyID/-authenticationKeyIssuerID`.

**Why:** Everything native and web-CloudKit hangs off the container `iCloud.no.akashic`. Nothing can
be built until it exists.

**Do:**
- ☐ <https://developer.apple.com/account> → **Certificates, Identifiers & Profiles** → **Identifiers**.
- ☐ **App IDs** → **+** → **App** → Bundle ID **explicit** `no.akashic.app`; under Capabilities tick
  **iCloud** (which enables **CloudKit**). Register.
- ☐ **Identifiers → iCloud Containers** → **+** → create container **`iCloud.no.akashic`**; associate
  it with the `no.akashic.app` App ID.
- ☐ Open **CloudKit Console** (<https://icloud.developer.apple.com>) → select `iCloud.no.akashic` →
  confirm the **Development** environment is present.

**Expected:** container `iCloud.no.akashic` visible in CloudKit Console with a Development env.

**Hand back →** confirm the exact bundle ID (`no.akashic.app`) and container ID (`iCloud.no.akashic`)
match what the agent has hardcoded; and your **Team ID** (Membership page) → agent puts it in project
config (not a secret, but keep it out of chat if you prefer — it's on the Membership page).

---

## 2. cktool management token + schema import — ✅ DONE (2026-07-22)

> **Outcome:** a management token was already saved on this machine. `schema.ckdb` was validated
> and imported to **Development**; round-trip `export-schema` confirms all record types live
> (`Journey`, `Waypoint`, `Photo`, `DayComment`, `PublicJourney`, `PublicPhoto`). One syntax fix:
> list fields are `LIST<STRING>`, not `STRING LIST`. Dev→Prod promotion remains a Phase-2 step.

**Why:** The CloudKit record types (Section 3 of the plan) are defined as a schema file the agent
generates. You import it with `cktool`; that needs a management token only you can mint.

**Do:**
- ☐ Create a management token in CloudKit Console (https://icloud.developer.apple.com →
  container `iCloud.no.akashic` → **Tokens & Keys** → new **Management Token**; see
  [`apple/CloudKit/README.md`](./apple/CloudKit/README.md) §1).
- ☐ Save it locally (`save-token` does **not** open a browser — paste the token at the
  secure prompt):
  ```
  xcrun cktool save-token --type management
  ```
- ☐ Import the schema into **Development** (see [`apple/CloudKit/README.md`](./apple/CloudKit/README.md)
  for the exact file name and any flags):
  ```
  xcrun cktool import-schema \
    --team-id <YOUR_TEAM_ID> \
    --container-id iCloud.no.akashic \
    --environment development \
    --file apple/CloudKit/schema.ckdb
  ```
- ☐ **Dev → Prod promotion (later, Phase 2 only):** in CloudKit Console → **Schema** →
  **Deploy Schema Changes to Production**, or re-run `import-schema` with
  `--environment production`. Do this only once Dev is proven.

**Expected:** record types (`Journey`, `Waypoint`, `Photo`, `DayComment`, `PublicJourney`) appear in
CloudKit Console → Development.

**Hand back →** confirm "schema imported to Development". This unblocks **Spike A** (test data),
the **web CloudKit adapter** (T3.2), and the **Phase-2 importer** (T2.5). Note it does **not** by
itself flip the native app to real CloudKit: the app's current `NSPersistentCloudKitContainer` mode
is a Phase-1 placeholder that would generate its *own* `CD_`-prefixed record types — the native
switch to these custom record types is the D4/T2.3 decision (see `apple/CloudKit/MAPPING.md`).
The management token is stored by `cktool` on your machine — do **not** share it.

---

## 3. CloudKit JS web API token (Spike A) — ✅ TOKEN CREATED (2026-07-22)

> **Outcome:** token created in CloudKit Console (Post Message callback, origin-locked) and stored
> locally in `spikes/cloudkit-js/config.local.js` + `.env.local` (both gitignored — never commit
> it; the public repo would expose it). Verified live: `setUpAuth()` accepts the token, and an
> anonymous **public-DB query succeeds** end-to-end (empty container ⇒ `count: 0`, no errors) —
> the anonymous-showcase half of D6 is proven. The web app in `VITE_DATA_BACKEND=cloudkit` mode
> loads CloudKit JS and renders Apple's sign-in button. **Remaining (needs your Apple ID):** the
> spike's signed-in panels — private-DB reads now, shared-DB reads + share-accept once shared
> data exists (Phase 2/3).

**Why:** The web thin-client (and Spike A) authenticates to CloudKit via a **CloudKit JS API token**
with Apple ID sign-in. Only you can create it.

**Do:**
- ☐ CloudKit Console → `iCloud.no.akashic` → **Tokens & Keys** (API Tokens) → **New Token**.
- ☐ Enable **Sign in with Apple ID**.
- ☐ Set **allowed origins** exactly:
  `http://localhost:8000`, `http://localhost:5173`, `https://akashic.no`.
- ☐ Copy the token. Put it in **two** places:
  - `spikes/cloudkit-js/index.html` → the `CONFIG` block (`apiToken` field).
  - `.env` → `VITE_CLOUDKIT_API_TOKEN=<token>`.
- ☐ Run **Spike A** end-to-end following [`spikes/cloudkit-js/README.md`](./spikes/cloudkit-js/README.md):
  sign in with Apple ID → read records from a shared zone → accept a share invitation on web.

**Expected:** Spike A checklist passes — proves decision **D6** (web on CloudKit JS is viable).

**Hand back →** confirm `VITE_CLOUDKIT_API_TOKEN` is set locally and that Spike A passed/failed
(and where it broke, if it did). A CloudKit JS API token is lower-risk than a service key but still
**never paste it into chat**.

---

## 4a. ⚠️ TestFlight talks to CloudKit **Production** — not Development

Discovered while uploading build 2 (2026-07-23). This is the single fact that
decides when the family can actually use the app.

A TestFlight build is signed with an **App Store distribution profile**, and such a
profile only ever carries the CloudKit **production** environment. The
`com.apple.developer.icloud-container-environment` entitlement can point a
*development* or *ad-hoc* build at either environment, but it cannot override this
for App Store / TestFlight. There is no flag, no build setting, no workaround.

Everything built and verified so far lives in **Development**:

| | Development | Production |
|---|---|---|
| Schema | 7 record types (incl. PublicJourney/PublicPhoto) | only the default `Users` |
| Records | 1559 (3 journeys / 18 days / 1538 photos), 5.41 GB | 0 |

So build 2 installs and runs, but on a device it finds an empty container with no
schema: no journeys, and sync errors surfaced in Settings. **The build is real; the
data is not there yet.**

To make TestFlight useful, two steps are needed, in order:

### Step 1 — promote the schema (Christopher; ~1 min) 🧑

`cktool` cannot do this: `import-schema --environment production` is refused with
*"endpoint not applicable in the environment 'production'"*. The Console is the only
path.

1. Open <https://icloud.developer.apple.com/dashboard/> and pick **iCloud.no.akashic**.
2. Make sure the environment selector says **Development**.
3. **Schema → Deploy Schema Changes…** → review → **Deploy**.

**This is irreversible.** A record type or field that reaches Production can never be
deleted, only added to — which is exactly why it waited until the schema stopped
changing. Verified before deploying (2026-07-23): the deployed Development schema is
field-for-field identical to `apple/CloudKit/schema.ckdb`, so nothing unintended gets
frozen. The six types promoted are `Journey`, `Waypoint`, `Photo`, `DayComment`,
`PublicJourney`, `PublicPhoto`.

Confirm it landed:

```bash
xcrun cktool export-schema --team-id 9LVCB72DT8 --container-id iCloud.no.akashic --environment production | grep "RECORD TYPE"
```

### Step 2 — import the archive into Production (Claude; ~1–2 h) 🤖

Runs from the **`Debug-Production`** build configuration, which is a
development-signed build carrying `icloud-container-environment = Production`
(`apple/Akashic/Support/Akashic-Production.entitlements`). That is the only way to
write Production from the simulator — a TestFlight build reads Production but cannot
be aimed anywhere else, and `Debug-CloudKit` always means Development.

Source: `/Users/cher/Privat/AkashicExport-20260722` (16 GB on disk; ~5.4 GB reaches
CloudKit as assets). Driven from the app's **Settings → CloudKit import** screen.
The importer is idempotent (`.allKeys` overwrite keyed by the original UUIDs) so a
re-run is safe, but it is **not resumable** — an interrupted run re-uploads
everything.

Until both steps are done, keep the family off the tester list — an empty app teaches
them the wrong thing about the migration.

## 4. Xcode signing + TestFlight — ✅ CREDENTIALS IN PLACE (2026-07-22)

> **Outcome:** signing team `9LVCB72DT8` is pinned in `project.yml` (both `*-CloudKit` configs);
> App Store Connect record **Akashic Journeys** (App ID 6793442859, bundle `no.akashic.app`,
> SKU `akashic-ios`, en-US) exists; an **App Store Connect API key** (Key ID `THX8B77MDH`, Admin)
> is stored at `~/.appstoreconnect/private_keys/AuthKey_THX8B77MDH.p8` (chmod 600) with
> `ASC_KEY_PATH` / `ASC_KEY_ID` / `ASC_ISSUER_ID` in the gitignored `.env`. Verified with
> `xcrun altool --list-apps`. This key also makes future provisioning headless — pass
> `-authenticationKeyPath/-authenticationKeyID/-authenticationKeyIssuerID` to `xcodebuild`
> instead of using the Xcode GUI.
>
> **Upload:** `apple/Scripts/testflight-upload.sh` (archives `Release-CloudKit`, exports, uploads).
> **Gate:** do not upload a build until the CloudKit sync layer's data-safety fixes are verified —
> TestFlight builds are entitled, so the sync engine actually runs on family devices.
>
> **Remaining 🧑:** add the family as **internal testers** in TestFlight once the first build
> finishes processing (~5–15 min after upload), and confirm every device runs iOS 17+.

**Why:** Building on a real device and distributing to the family both require your Apple Developer
identity and App Store Connect access.

**Do (signing):**
- ☐ Open the Xcode project at **`apple/Akashic.xcodeproj`** (the agent creates it;
  `apple/Spikes/MapKitGlobe/` is the existing Spike B project you can open today to validate signing).
- ☐ Target → **Signing & Capabilities** → set **Team** (your Apple Developer team) → let Xcode manage
  signing.
- ☐ Confirm the **CloudKit** capability is enabled and points at container `iCloud.no.akashic` in the
  relevant build config.
- ☐ **App Group (for the widget):** enable the **App Groups** capability with group
  **`group.no.akashic`** on **both** targets — `Akashic` **and** `AkashicWidgets`. The widget is built
  but **dormant** until this exists (it reads journey stats the app writes into the shared App Group
  container — see `apple/Akashic/App/AppGroup.swift`, `identifier = "group.no.akashic"`). Until enabled
  the widget shows placeholder data.
- ☐ **Universal Links (Team ID substitution):** once your **Team ID** is known (Membership page), tell
  the agent to replace the `<TEAMID>` placeholder in
  [`public/.well-known/apple-app-site-association`](../public/.well-known/apple-app-site-association)
  so the `appIDs` entry reads `<TEAMID>.no.akashic.app`. Also add the **Associated Domains** capability
  to the `Akashic` target with entry `applinks:akashic.no`. (Serving details:
  [`docs/github-pages-cutover.md`](../docs/github-pages-cutover.md) → "Universal Links".)
- ☐ Plug in a personal iPhone (iOS 17+), select it, **Run**. Trust the developer cert on-device if
  prompted.

**Do (TestFlight, Phase 2+):**
- ☐ <https://appstoreconnect.apple.com> → **Apps → +** → **New App**; platform iOS; bundle ID
  `no.akashic.app`; SKU + name.
- ☐ **TestFlight** tab → **Internal Testing** → create a group (e.g. "Family") → add internal testers
  by Apple ID email. Upload a build (Xcode → Archive → Distribute), then enable it for the group.

**Expected:** app runs on your device; family members receive a TestFlight invite and can install.

**Hand back →** confirm the App Store Connect app record exists (bundle `no.akashic.app`) and that a
build reached TestFlight, so the agent knows Phase 2 family testing is unblocked.

---

## 5. R2 read-only S3 credentials (archive pull)

**Why:** The reverse export ([`scripts/export/pullR2Archive.ts`](./scripts/export/pullR2Archive.ts))
pulls all photo/video bytes out of R2 for CloudKit import. It needs S3-style credentials — and per
Step 0, these must be **read-only** so the export can never mutate the live bucket.

**Do:**
- ☐ Cloudflare dashboard → **R2** → **Manage R2 API Tokens** → **Create API token**.
- ☐ Permission: **Object Read only** (NOT read/write). Scope to **bucket `akashic-media`** only.
- ☐ Save the generated **Access Key ID**, **Secret Access Key**, and your **account-id S3 endpoint**
  (`https://<account-id>.r2.cloudflarestorage.com`).
- ☐ Put into `.env` (or the shell env the script reads):
  ```
  CLOUDFLARE_ACCOUNT_ID=<account-id>
  R2_ACCESS_KEY_ID=<key-id>
  R2_SECRET_ACCESS_KEY=<secret>
  R2_BUCKET=akashic-media
  ```

**Expected:** `pullR2Archive.ts` lists and downloads objects; a write attempt would be denied
(that's intentional — the token is read-only).

**Hand back →** confirm the four vars (`CLOUDFLARE_ACCOUNT_ID` + the three `R2_*`) are set and that
the token is **read-only**. Never paste the secret access key into chat.

---

## 6. GitHub Pages hosting + DNS cutover

**Why:** The web app moves off Cloudflare Pages to free GitHub Pages (D7); at cutover, DNS moves to
the registrar (plan §5). Only you own the repo settings and the domain registrar login.

**Do (Pages, Phase 4):**
- ☐ Repo **Settings → Pages → Build and deployment → Source = GitHub Actions**.
- ☐ (Optional, Phase 4) repo **Variables** for the CloudKit web backend — the deploy workflow reads
  exactly these three from `vars`: `VITE_DATA_BACKEND=cloudkit`, `VITE_CLOUDKIT_ENV=production`,
  `VITE_CLOUDKIT_API_TOKEN`. (A CloudKit web API token is origin-locked and ends up in the shipped
  JS bundle anyway, so a repo Variable is acceptable. The container id `iCloud.no.akashic` is
  hardcoded in `src/lib/cloudkit.ts`; there is no container variable.)
- ☐ Settings → Pages → set **Custom domain** `akashic.no`, tick **Enforce HTTPS** (after the cert
  issues).

**Do (DNS cutover — only when the Pages build is green; see
[`docs/github-pages-cutover.md`](./docs/github-pages-cutover.md)):**
- ☐ At the Norid registrar (e.g. Domeneshop) lower TTL first, then set records from plan §5:
  ```
  akashic.no      A     185.199.108.153  185.199.109.153  185.199.110.153  185.199.111.153
  akashic.no      AAAA  2606:50c0:8000::153  8001::153  8002::153  8003::153
  www.akashic.no  CNAME chaerem.github.io.
  ```
- ☐ Verify HTTPS issuance, then (Phase 5 only) remove the Cloudflare zone.

**Expected:** `akashic.no` serves from GitHub Pages over HTTPS.

**Hand back →** confirm Pages source is "GitHub Actions", which repo Variables/Secrets you set, and
the timestamp of the DNS change (so the agent can watch propagation).

---

## 7. Family prerequisites

**Why:** CloudKit sharing requires every participant to be on Apple. This is a **hard constraint**
(D2) and gates the minimum OS choice (Open Question 1).

**Do:**
- ☐ Confirm **every** family member who needs access has an **Apple ID** and an Apple device.
- ☐ Check the **oldest device** in the family: it must run **iOS 17+** (iOS 17 is the app minimum;
  bump to 18 only if you decide to). Record the oldest model/OS.
- ☐ Confirm there are **no non-Apple participants** who must be first-class members. Per D2 that is
  out of scope — accept it explicitly before Phase 1.

**Expected:** a short list of family Apple IDs (for TestFlight in Section 4) and a confirmed minimum
iOS version.

**Hand back →** the confirmed **minimum iOS version** (resolves Open Question 1) and the list of
family Apple ID emails for TestFlight.

---

## 8. Security hygiene (secrets cleanup)

**Why:** A Supabase **service-role key** (full DB bypass) currently sits in local files. It stays
useful only until the export is done; after that it should die.

**Where it is (verified tonight, both are local, NOT git-tracked):**
- `/Users/cher/Privat/Akashic/.env` (the **main** checkout, not this worktree).
- `.claude/settings.local.json` — embedded inside stored Bash-permission strings.

**Do:**
- ☐ Until Step 0's export succeeds, **leave the key in place** (you may still need it to dump Postgres).
- ☐ Once Supabase is restored **and** exported: either **rotate** it (Supabase → Project Settings →
  API → roll `service_role`) or simply let it **die with the project** when you delete Supabase in
  **Phase 5**. Then scrub it from both local files above.
- ☐ Leave the `VITE_*` **GitHub Secrets** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) in place until **Phase 5 cleanup** — the current
  site still builds with them. Prune them then.

**Expected:** no live service-role key remains after Phase 5; GitHub secrets pruned at decommission.

**Hand back →** confirm (yes/no) whether the service key was rotated or retired, so the agent can
mark the Phase 5 security item done. Do not paste any key.

---

## 9. Who blocks what

| # | Your action | Unblocks (repo tasks / phases) |
|---|-------------|--------------------------------|
| **0** | ✅ **DONE (2026-07-21 → 22)** — Supabase resumed + exported; R2 archived; verified | **All data migration** unblocked. Archive at `/Users/cher/Privat/AkashicExport-20260722`. No longer a blocker. |
| 1 ✅ | CloudKit container + App ID — done 2026-07-22 | Native app build, cktool import, CloudKit JS — everything Apple |
| 2 ✅ | cktool management token + schema import (Dev) — done 2026-07-22 | **Spike A** data; web CloudKit adapter (T3.2); Phase-2 importer (T2.5). Native app needs the D4/T2.3 decision too |
| 3 | CloudKit JS web API token | **Spike A** (proves D6); Phase 4 web-on-CloudKit adapter |
| 4 | Xcode Team signing + **App Group `group.no.akashic`** (both targets) | On-device builds; Phase 1 MVP; **activates the journey-stats widget** (dormant until the App Group exists) |
| 4 | App Store Connect + TestFlight group | **Family testing** (Phase 2); needs Section 7 Apple IDs |
| 5 | R2 read-only S3 token | **Archive pull** (`pullR2Archive.ts`); photo/video import to CKAsset (Phase 2) |
| 6 | GitHub Pages source = Actions | Pages deploy workflow (Phase 4) |
| 6 | Registrar DNS records | `akashic.no` cutover off Cloudflare (Phase 4) |
| 7 | Family Apple IDs + oldest-device check | Resolves minimum-iOS (Open Q1); gates Phase 1 target; feeds TestFlight |
| 8 | Rotate/retire service key; prune secrets | Phase 5 decommission close-out |

---

### Fastest path

Step 0 tonight → then **1 → 2 → 3** (container, schema, JS token) unblock the most work in parallel.
Sections 4–8 follow their phases.
