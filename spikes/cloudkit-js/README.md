# Spike A — CloudKit JS

A single self-contained static page (`index.html`, no build step, no framework) that de-risks
**decision D6** from `APPLE-MIGRATION-PLAN.md`:

> **D6 — Web = read-mostly CloudKit JS client.** CloudKit JS supports Apple ID sign-in, private *and*
> shared DB access, and share acceptance — but the library is aging.

The page proves (or disproves) that Apple's CloudKit JS SDK, in a normal browser, can:

1. **Sign in with an Apple ID** (Apple's own popup, via `apiTokenAuth.signInButton`).
2. Read records from a zone **SHARED** with the signed-in user (the *shared* database) — the critical test.
3. **Accept a `CKShare` invitation** on the web.
4. Read **public**-database records **without** sign-in (API token only).

Everything runs client-side against `https://cdn.apple-cloudkit.com/ck/2/cloudkit.js`. No other dependency.

---

## What Christopher must do in CloudKit Console first

The page cannot run until these exist. This is the gating checklist.

1. **Container.** In the [CloudKit Console](https://icloud.developer.apple.com/dashboard/) (requires a paid
   Apple Developer account), confirm the container **`iCloud.no.akashic`** exists. Work in the
   **Development** environment first.

2. **A toy schema with some data** (so there is something to read):
   - Record type **`Journey`** (and optionally `Waypoint`, `Photo`, `DayComment`) in the **private** DB.
   - Create at least one **custom record zone** (e.g. `journey-test`) and add a `Journey` record to it.
   - Record type **`PublicJourney`** in the **public** DB, with at least one record, so panel 4 has data.
   - Make sure any field you want to query/sort on is marked **Queryable** in the schema (indexes).
     A brand-new record type often needs the **`recordName` → Queryable** index before `performQuery`
     returns anything; add indexes in Console → Schema → Indexes if a query returns an
     `queryable`/index error.

3. **An API token** (Console → **Tokens & Keys → New API Token** — this is a *web token*, not the
   server-to-server key):
   - **Sign in with Apple ID must be allowed** for the token (the token's sign-in option enabled).
   - **Allowed origins / URLs:** add the *exact* origin you will serve this page from. For local testing
     that is **`http://localhost:8000`** (scheme + host + port must match; `127.0.0.1` is a *different*
     origin than `localhost`). CloudKit JS refuses to sign in from an origin the token does not whitelist.
   - Copy the generated token.

4. **A share to test panel 3** (and a second Apple ID):
   - From a native app / device signed in as the **owner**, share a journey zone (`ShareLink` /
     `UICloudSharingController`) with a **second** Apple ID and copy the `https://www.icloud.com/share/…`
     URL. For panel 2 you then sign into *this page* as that **second** Apple ID (the recipient) — the
     shared zone shows up in that user's **shared** database.
   - (During the spike you can also create a share by hand in Console, but the realistic path is a native
     share to a real second iCloud account.)

5. Paste the container id, environment, and token into the **`CONFIG`** object at the top of the
   `<script>` in `index.html` (marked **FILL IN**).

---

## How to run it

CloudKit JS requires the page's **origin to match the token's allowed origins**, and Apple ID sign-in
needs a **real, interactive browser window** (it opens Apple's popup — not headless, not an iframe).

```bash
cd spikes/cloudkit-js

# Serve on the origin you whitelisted in the token (http://localhost:8000):
python3 -m http.server 8000
#   – or –
npx serve -l 8000
```

Then open **http://localhost:8000** in Chrome/Safari/Firefox and **allow popups** for the origin.

> Notes
> - Serve over the **exact** whitelisted origin. If you whitelist `http://localhost:8000`, do not open via
>   `http://127.0.0.1:8000` or a different port — CloudKit will reject the sign-in.
> - `file://` will **not** work (no origin to match, popup blocked).
> - Sign-in state is kept in a cookie (`persist:true`); a private/incognito window gives you a clean slate.

---

## Click-through test checklist (maps 1:1 to the four panels)

Run top to bottom. Each panel shows a **PASS/FAIL** badge and dumps request/response JSON into the log
pane on the right so a non-expert can follow along.

| # | Panel | Steps | PASS looks like |
|---|-------|-------|-----------------|
| 0 | **Identity** | Click the Apple **Sign in** button, complete Apple's popup. (Optionally "Request name permission".) | Badge → `signed in`; `userRecordName` shown. |
| 1 | **Private DB** | "List private zones", then set a record type + zone and "Query private records". | Badge `PASS · N`; your own `Journey` record(s) in the log. |
| 2 | **Shared DB** *(critical)* | Signed in as the **recipient** Apple ID: "List shared zones" (auto-fills zone name + owner), then "Query shared records". | Badge `PASS · N`; records from the **other** account's shared journey. **This is the make-or-break result for D6.** |
| 3 | **Share acceptance** | Paste the `icloud.com/share/…` URL → "Inspect share API surface" (see what the lib exposes) → "Fetch share metadata" → "Accept share". | Badge `metadata OK` then `ACCEPTED`; afterwards the zone appears in panel 2. |
| 4 | **Public DB** | Without signing in (works immediately on load), set record type `PublicJourney` and "Query public records". | Badge `PASS · N`; public records with only the API token. |

Errors are surfaced in full — CloudKit's `ckErrorCode`, `serverErrorCode`, `reason`, `retryAfter`.
Common ones: `AUTHENTICATION_REQUIRED` (not signed in / wrong DB), `BAD_REQUEST` with a `queryable`
message (missing schema index), `ZONE_NOT_FOUND` (wrong zone name / owner record name).

---

## What the result proves / disproves for D6

- **Panels 1, 2 and 4 all PASS →** D6 holds. The web can be a read-mostly CloudKit JS client: sign in with
  Apple ID, read the user's private data, read journeys **shared** to them, and serve public journeys
  anonymously. Green-light the `src/lib/cloudkit.ts` adapter (Plan §5).
- **Panel 2 FAILS** (sign-in and private/public work, but shared reads don't) → the core of D6 is in doubt.
  Shared-journey viewing is the whole point of the web client; without it the web falls back to
  **public-showcase-only**, and family collaboration stays native-only. This is the single most important
  cell in the table.
- **Panel 3 (share acceptance) FAILS but panel 2 PASSES** → acceptable degradation: shares can be accepted
  on a device (native), and the web still *reads* already-accepted shares. Web-side acceptance becomes a
  "nice to have", not a blocker. (See the caveat below — a FAIL here is as likely to be a thin-API problem
  as a real capability gap, so read the log before concluding.)
- **Panel 4 FAILS →** the anonymous public showcase can't be served by CloudKit JS; `akashic.no`'s public
  pages would need a different mechanism (e.g. a tiny cache/proxy or server-to-server export).

---

## Known CloudKit JS risks to watch during the spike

- **The library is old.** CloudKit JS v2 has not had a meaningful update in years; its docs and the actual
  runtime API have drifted. Treat any convenience method as "verify live". The page **feature-detects**
  share methods and has an **"Inspect share API surface"** button that dumps exactly which methods this
  build exposes.
- **Web share acceptance is the soft spot.** Natively, the OS produces a `CKShareMetadata` from the share
  URL; on the web there is no OS to do that. The documented CloudKit JS path is thin and version-dependent,
  so panel 3 tries, in order: `fetchShareMetadata` + `acceptShareMetadata`, then `acceptShares`/`acceptShare`,
  then a **best-effort REST call** to `…/shared/records/accept` (which it also logs verbatim so you can
  replay it via curl if the browser fetch is blocked by CORS). A red badge here may mean "API too thin",
  not "capability missing" — read the log.
- **Session-persistence quirks.** There are long-standing forum reports of CloudKit JS silently dropping
  the web-auth session / needing re-sign-in. `persist:true` is set; still, watch for a reload landing you
  back at "not signed in". The app must handle re-auth gracefully (the plan already scopes the web as
  read-mostly, and the family primarily uses the native app).
- **Server-to-server tokens only reach the public DB.** The API token used here is a *web* token (Apple ID
  sign-in). Do **not** confuse it with a server-to-server key — those can only read/write the **public**
  database and cannot touch private/shared data. This also constrains the one-time data migration
  (Plan §6: the import must run in a user context, not via a server-to-server token).
- **Origin allow-listing is strict.** Every origin you test from (localhost:8000, a staging URL,
  akashic.no) must be added to the token's allowed origins, or sign-in fails before it starts.
