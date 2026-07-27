# GitHub Pages Cutover Checklist

Phase 4 / D7 of [APPLE-MIGRATION-PLAN.md](../APPLE-MIGRATION-PLAN.md): move web
hosting for **akashic.no** from Cloudflare Pages to GitHub Pages, with **zero
downtime** and a fast rollback.

The new workflow — [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml) —
is intentionally **manual-only** (`workflow_dispatch`) during prep. The existing
Cloudflare workflow (`.github/workflows/deploy.yml`) keeps deploying `main` the
whole time, so users are never affected until the single DNS flip in Stage 3.

---

## Key facts before you start

- **Owner / repo:** `CHaerem/Akashic` (a **project** Pages site, not a user
  site). Its default Pages URL is therefore `https://chaerem.github.io/Akashic/`
  — note the `/Akashic/` **subpath**.
- **`vite.config.js` sets `base: "/"`.** That is correct for serving at the
  **root** of a custom domain (`https://akashic.no/`), but it means the raw
  `chaerem.github.io/Akashic/` subpath URL will **not render correctly** —
  hashed asset URLs resolve to `chaerem.github.io/assets/...` (404). Do **not**
  change `base`; instead verify against the custom domain (see Stage 1). Leaving
  `base: "/"` is the right choice because the destination is the apex domain.
- **`public/CNAME`** contains exactly `akashic.no`. Vite copies `public/` into
  `dist/`, so the deployed artifact carries this marker. **Implication:** the
  first Pages deploy that includes a `CNAME` file makes GitHub **auto-populate
  the custom-domain field** in Settings → Pages with `akashic.no`. That is
  desired — but it also means that once a custom domain is set, the plain
  `github.io` URL 301-redirects to `https://akashic.no`, so you cannot smoke-test
  at the `github.io` URL after the first deploy (another reason to use the
  hosts-override method in Stage 1).
- **`404.html`** is created in CI only (`cp dist/index.html dist/404.html`); it
  is never committed. It is a static safety net for stray/mistyped paths and
  hard refreshes — the app has no client-side router, navigation is query-param
  deep links.
- **TLS:** GitHub issues a free Let's Encrypt cert for akashic.no only **after**
  public DNS points the domain at Pages. Expect cert warnings during any
  pre-cutover test that fakes DNS locally.

---

## GitHub Pages server addresses (for DNS)

Apex `akashic.no` — four **A** records:

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

Apex `akashic.no` — four **AAAA** records:

```
2606:50c0:8000::153
2606:50c0:8001::153
2606:50c0:8002::153
2606:50c0:8003::153
```

`www.akashic.no` — one **CNAME** record → `chaerem.github.io.` (trailing dot).

> `.no` domains are registered at Norid-accredited registrars (Cloudflare
> Registrar does not support `.no`), so only **DNS hosting** moves. The domain
> registration itself does not move.
>
> **Destination: GoDaddy** (2026-07-27) — the owner already hosts other domains
> there. DNS hosting is independent of registration, so this works even though
> the `.no` registration stays where it is: change the **nameservers at the Norid
> registrar** to GoDaddy's, then create the records below in GoDaddy.
>
> One thing to confirm in GoDaddy's control panel first: some providers only host
> DNS for domains registered with them. If GoDaddy will not accept an externally
> registered `.no`, fall back to the registrar's own DNS — any host that supports
> four apex A records, four apex AAAA, and a `www` CNAME is sufficient. Nothing
> about GitHub Pages needs a premium DNS feature.

---

## Recommended cutover sequence (zero-downtime)

### Stage 0 — Prep on GitHub (no DNS change; users still served by Cloudflare)

1. **Merge** the branch that adds `deploy-pages.yml` and `public/CNAME` to
   `main`. `deploy.yml` is untouched, so Cloudflare keeps serving akashic.no.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Set the custom domain BEFORE the first deploy.** In Settings → Pages →
   *Custom domain*, enter `akashic.no` and Save. GitHub runs a DNS check that
   will report *"not properly configured / unavailable"* — **expected**, because
   DNS still points at Cloudflare. This is harmless prep; nothing user-facing
   changes.
   - Equivalent alternative: skip this and let the first deploy's `CNAME` file
     auto-populate the field. Either order ends in the same state; setting it
     explicitly first just makes the intent obvious and avoids surprise.
4. **Run the workflow manually:** Actions tab → *Deploy to GitHub Pages* → *Run
   workflow*. This builds and publishes the artifact (with `CNAME` + `404.html`)
   to the `github-pages` environment. The `deploy` job prints a `page_url`.

### Stage 1 — Verify the Pages build before touching public DNS

Because a custom domain is now configured, `chaerem.github.io/Akashic/`
redirects to `https://akashic.no` (which still resolves to Cloudflare), and the
subpath URL wouldn't render anyway (`base: "/"`). So verify the **Pages origin
directly** without moving public DNS, using a local hosts override:

5. Temporarily add to `/etc/hosts` (any one of the four A IPs):
   ```
   185.199.108.153  akashic.no
   ```
6. Load `https://akashic.no` — it now resolves to GitHub Pages **only for you**.
   Accept the TLS warning (cert isn't issued until real DNS points at Pages).
   Confirm: globe renders, journeys/photos/stats load, PWA installs, and an
   unknown path (e.g. `/nope`) serves the app shell via `404.html`.
7. Remove the `/etc/hosts` line when done.

> Alternative verify method: use `curl --resolve akashic.no:443:185.199.108.153
> https://akashic.no -k` to hit Pages without editing hosts.

### Stage 2 — Lower TTL (still on Cloudflare, still zero downtime)

8. At the current DNS host (Cloudflare), lower the **TTL to 300s** on the
   existing `akashic.no` A/AAAA and `www` records. Wait for the *old* TTL to
   expire so the Stage 3 flip propagates in minutes, not hours. **Record the
   current Cloudflare values first** — you'll need them for rollback.

### Stage 3 — DNS cutover (the single user-facing moment)

9. Move DNS hosting to the registrar (if not already) and create the records
   from *GitHub Pages server addresses* above: four apex **A**, four apex
   **AAAA**, and the `www` **CNAME** → `chaerem.github.io.`. Remove the old
   Cloudflare A/AAAA/CNAME for akashic.no.
10. Wait for propagation (fast, thanks to the lowered TTL). GitHub detects the
    domain now resolves to Pages and begins issuing the Let's Encrypt cert
    (usually minutes, up to ~1 hour).
11. **Flip the trigger:** edit `deploy-pages.yml` — replace `workflow_dispatch:`
    with `push: { branches: [main] }` — so future pushes deploy to Pages
    automatically. (Full Phase 5 cleanup below.)

### Stage 4 — Enforce HTTPS and finalize

12. When Settings → Pages shows the certificate **issued**, tick **Enforce
    HTTPS**.
13. Final check: `https://akashic.no` and `https://www.akashic.no` both load and
    redirect correctly; PWA still installs; service worker updates.

---

## Rollback plan — WAIVED (2026-07-27)

The owner does not want a rollback path, so the plan below is recorded as history rather than as
something to keep alive. **What that changes:** `deploy.yml` and the Cloudflare secrets no longer wait
for a stability month (LEG-10), and the Pages project and DNS zone go as soon as the cutover is
verified (LEG-11A). What it does NOT change is the R2 bucket and the Supabase project (LEG-11B) —
those hold the only copy of the family archive until LEG-02 verifies a second physical medium, and
that gate has nothing to do with rollback.

If the cutover misbehaves, the recovery is forward rather than backward: fix the build and re-run
`deploy-pages.yml`. The site may be down while you do. That is the trade being made deliberately.

<details><summary>The original rollback plan, for the record</summary>

Re-point DNS back to Cloudflare using the values recorded in Stage 2. Because TTL is already low,
users return to the Cloudflare Pages site within one TTL window (~5 min). `deploy.yml` is still
present and still deploying `main`, so the Cloudflare site never went stale — rollback is purely a DNS
revert. If needed, also clear the custom domain in Settings → Pages to stop the `github.io` →
akashic.no redirect.

</details>

**Still record the Cloudflare DNS values in Stage 2 anyway** — not for rollback, for reconstruction.
Once the zone is deleted (LEG-11A) anything you forgot to recreate in GoDaddy is gone with it.

Measured 2026-07-27, which makes this cheaper than it sounds: `akashic.no` has **no MX and no TXT
records at all** (`dig +short akashic.no MX` and `... TXT` both return nothing, and `_dmarc` is empty).
So the zone carries nothing but the website's A/AAAA/CNAME, there is no mail to break, and the GoDaddy
zone only needs the records listed above. Re-check before deleting in case something was added since.

---

## Phase 5 — what gets deleted (only after ≥1 month stable on Pages)

- **`.github/workflows/deploy.yml`** — the Cloudflare Pages workflow. Still
  present today, and it is the only workflow that consumes the two Cloudflare
  secrets below (`deploy.yml:45-46`).
- **GitHub secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Also
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` **if they are still set** — the
  web client is CloudKit-only and no workflow references either key any more
  (`grep -rn SUPABASE .github/` returns nothing), so they can be pruned in the
  same pass rather than deferred. The only remaining Supabase references are the
  one-shot legacy scripts `scripts/migrateR2Photos.js` and
  `scripts/backfillThumbnails.ts`, which read their own local env vars, never CI
  secrets.
- **Cloudflare resources** (per plan Phase 5): the `akashic` Pages project, the
  `akashic-media` Worker + R2 bucket, and the Cloudflare DNS zone.
- **`deploy-pages.yml` trigger:** ensure it's on `push: [branches: main]` and
  drop the `workflow_dispatch`-only header note.

---

## Universal Links (`apple-app-site-association`)

To let `https://akashic.no/?journey=<slug>` open a shared journey directly in the
native app (plan Open Q5), the site must serve an Apple App Site Association
(AASA) file. It already lives in the repo at
[`public/.well-known/apple-app-site-association`](../public/.well-known/apple-app-site-association)
(no file extension, JSON body). Vite copies `public/` into `dist/` verbatim, so the
deployed artifact carries it at `https://akashic.no/.well-known/apple-app-site-association`.

**Status of the two prerequisites (see runbook §4):**

1. ✅ **Done.** The Team ID placeholder is already filled — `appIDs` reads
   `9LVCB72DT8.no.akashic.app` in the committed file. Nothing to replace.
2. ⬜ **Still outstanding.** Add the **Associated Domains** capability to the
   `Akashic` app target with the entry `applinks:akashic.no`. Verify with
   `grep -rn applinks apple/` — it returns **no hits today**, so neither
   `apple/project.yml` nor any of the three entitlements files under
   `apple/Akashic/Support/` declares it, and Universal Links cannot work until
   this lands.

The AASA uses the modern `components` matcher (iOS 14+; the app minimum is iOS 17):
it matches path `/` with a non-empty `journey` query value (`"?": { "journey": "?*" }`),
which mirrors the web app's query-param deep links (there is no client-side router).

### Serving requirements on GitHub Pages (content-type caveat)

Apple's **hard** requirements — all satisfiable on GitHub Pages:

- Served over **HTTPS** with a valid cert (Pages issues Let's Encrypt after cutover). ✅
- Reachable at `/.well-known/apple-app-site-association` **with no redirect** (no 3xx). ✅
  — confirm the path returns `200` directly; a *missing* file would fall through to
  `404.html` (a 404, not a redirect), so verify the file is actually in the artifact.
- **Valid JSON**, **no `.json` extension**. ✅ (both true for the committed file)

The **content-type** is the one soft spot:

- Apple's documentation says to serve the file as **`application/json`**.
- **GitHub Pages serves extensionless files as `application/octet-stream`** and gives
  you **no way to override response headers** for a static file.
- Historically this has been **tolerated**: since iOS 14 the device does not fetch the
  AASA file directly — Apple's CDN (`https://app-site-association.cdn-apple.com/a/v1/akashic.no`)
  fetches and caches it, and that fetcher accepts `application/octet-stream` as long as
  the **body parses as JSON**. Universal Links have worked from Pages this way for years.
- **State it conservatively:** octet-stream is *tolerated in practice, not promised by
  Apple's docs*. Treat it as "very likely fine, must be verified," not guaranteed.

> **Jekyll note:** this repo deploys a prebuilt Vite `dist/` artifact via
> `deploy-pages.yml` (GitHub Actions), so **Jekyll never runs** — the dot-directory
> `.well-known/` is served as-is. (Jekyll's historical habit of ignoring dot/underscore
> paths does not apply to Actions-artifact deploys.)

### Verify after deploy

- `curl -sI https://akashic.no/.well-known/apple-app-site-association` → expect
  `HTTP/2 200`, **no** `Location:` redirect. (Content-Type will read
  `application/octet-stream` on Pages — expected.)
- `curl -s https://akashic.no/.well-known/apple-app-site-association | python3 -m json.tool`
  → must pretty-print (valid JSON) and show the real Team ID, not `<TEAMID>`.
- After the app is signed and installed, check
  `https://app-site-association.cdn-apple.com/a/v1/akashic.no` (Apple's cached copy) and
  test a `?journey=` link from Notes/Messages; on macOS `swcutil dl -d akashic.no`
  dumps what Apple resolved.
- **Fallback only if the CDN ever rejects octet-stream:** serve the AASA from a host
  where you control headers. Avoid reintroducing the Cloudflare Worker (it is retired in
  Phase 5) — prefer confirming validation on Pages first; do not move hosting on a hunch.

---

## Staging preview: loss and alternatives

Cloudflare's shared **`staging.akashic.pages.dev`** preview (produced by
`deploy.yml` on every PR) **goes away** with the Cloudflare deploy.

- **Interim:** `.github/workflows/test.yml`'s `build` job already runs
  `npm run build` on every PR and uploads the `dist/` artifact as
  **`build-output`** (1-day retention, `test.yml:133-138`). Download it, unzip,
  and serve locally for QA:
  ```
  npx serve dist   # or: python3 -m http.server -d dist
  ```
- **Later (optional):** add a second GitHub Pages site or a per-PR preview
  action if a hosted preview URL is genuinely missed (see plan Section 5 and the
  "Losing PR staging previews" risk row). Not required for cutover.
