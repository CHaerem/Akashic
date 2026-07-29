# Akashic — Commercialization Plan

*Drafted 2026-07-24, at the end of the family migration (see APPLE-MIGRATION-PLAN.md).
Status: proposal for decision, not a commitment. Nothing here changes what the family
uses today.*

---

## 1. The thesis

Akashic can be sold as a product **without acquiring the costs that normally kill
photo-heavy apps**, because of one architectural property we already have:

> **Every family's data — especially the photos — lives in that family's own
> iCloud.** The vendor stores nothing, serves nothing, and pays for nothing per
> user.

That holds for the **private** database, which is the whole product for a family
that never publishes. It does **not** hold for the **public** database behind the
showcase (§6), which is billed to the developer and is the one real per-view cost
line in the model — see §2. It is a cost line, not a threat to the thesis: the
private-database property is what kills the storage bill, and that is the part
that normally kills photo apps.

This is not a hack; it is CloudKit's intended multi-tenant model. One container,
and every Apple ID that signs in gets its own isolated private database inside it.
What we built for one family — owner's private DB, zone-per-journey, CKShare to
family members, public showcase mirror — replicates per customer with **zero
changes to the storage architecture**. A new family starts empty in *their* cloud
and does exactly what we did, minus the migration.

What is being sold is therefore **the app, not a service**: the globe, the day
experience, the photo pipeline, sharing, stats, export. Price it once or small;
almost every krone is margin because there is no backend to feed — the one
deduction being showcase egress (§2), which is small per customer and lumpy per
viral moment.

The honest constraint that comes with the deal: **Apple-only, forever** (or until
a real backend is added — see §9). Every owner and every participating family
member needs an Apple ID. Android relatives can only view the public web showcase.

---

## 2. Why the economics are unusual

| Cost line | Typical photo app | Akashic |
|---|---|---|
| Storage — **private** DB (the killer) | $ per GB per user, forever | **$0** — the owner's own iCloud quota |
| Bandwidth — **private** DB (app usage) | $ per view | **$0** — served from the owner's quota via `CKAsset` URLs |
| Storage + bandwidth — **public** DB (the showcase) | $ per view | **Billed to us.** Free tier first, then metered — see below |
| Auth / accounts | Build + run auth infra | **$0** — Apple ID |
| Payments | Stripe + tax handling | Apple IAP (StoreKit, App Store handles VAT) |
| Servers | 24/7 ops | **None**. Web showcase = static page on Pages |
| Fixed costs | — | Apple Developer $99/yr, domain, moderation time |

Apple's cut: 30 %, or **15 % under the Small Business Program** (< $1M/yr — which
is us). At, say, 79 kr one-time: ~67 kr net per sale, against near-zero marginal
cost *for the app itself* — the showcase is the exception, below.

### The one real per-view cost: the public database

This document previously said bandwidth was flatly "$0 — Apple's CDN". That is
true of the private database and **false of the public one**, and the distinction
matters because the public database is exactly where the growth strategy lives.

- `apple/CloudKit/schema.ckdb` grants `READ TO "_world"` on six record types, and
  publishing writes two of them: `PublicJourney` (route/waypoints/stats assets +
  hero thumb) and `PublicPhoto` (**one thumbnail per photo**), via
  `apple/Akashic/Sync/PublicMirrorPublisher.swift`. A CloudKit **public** database
  is the developer's container, on the developer's quota — not on any customer's
  iCloud. Every signed-out visitor who scrolls a showcase page spends *our* egress.
- The same schema grants `CREATE TO "_icloud"` on **all seven** record types. That
  is any signed-in iCloud user, not just a paying customer — and since 2026-07-25
  publishing is deliberately in the free tier (§5), the write side is unpaid by
  design too.

**The arithmetic, using the app's own numbers.**
`Views/Showcase/JourneyShowcaseSheet.swift:66` budgets a published thumbnail at
~60 KB, and Kilimanjaro — a real journey — has **939 photos**. So one fully
scrolled showcase view of that journey moves roughly **56 MB**. Against CloudKit's
free public tier (order of 2 GB of transfer plus a small per-active-user
increment), that is on the order of **45 full journey views a day at 1 000
customers** before overage begins. Overage is roughly **$0.10/GB transfer,
$0.03/GB assets, $3/GB database**, so a 50 000-visitor spike — the Product Hunt /
HN outcome §6 is aiming for — is about **2.7 TB, or ~$270 in a day.**

**Read that in proportion.** It is a real cost line on the one feature the growth
strategy depends on, not an existential threat: the sums are hundreds of dollars
in a *good* week, not thousands a month at steady state, and a spike that costs
$270 is a spike that should also sell app units. What makes it worth writing down
is the shape — **the success mode and the cost-blowup mode are the same event**,
and this is the only line in the model where usage we do not control bills us.

**There is nothing in the repo that limits it today.** Verified: no publish cap,
no per-slug or per-account throttle, no egress or quota alert anywhere under
`apple/`, `src/`, `scripts/` or `.github/`. `Store/Entitlements.swift` caps a free
user at 1 owned journey and 100 photos in it, which incidentally bounds a free
account's *upload*, but nothing bounds **reads** — and a paid account publishes
unlimited journeys of unlimited size. The mitigations are cheap and none is built:
a thumbnail dimension/quality reduction (400 px q0.8 today, per
`Services/PhotoIngestService.swift:149`), a per-journey published-photo cap, lazy
paging in the web showcase, or simply a CloudKit-dashboard usage check on a
calendar reminder. Worth doing before, not after, the first spike.

The flip side, stated plainly: because we hold no *private* data, we can never do
cross-user features, server-side search, usage analytics on content, or "we can
restore your account" support. Some of that is a selling point ("we never see
your memories"), some is a real limitation (§8).

---

## 3. Asset inventory — what already exists and carries over

Everything below is built, tested (**608 native tests** as of 2026-07-26, plus the
web suite, CI green), and verified against the production CloudKit environment.
**Run the counts, don't read them** — this line has gone stale three times:
`grep -rn 'func test' apple/AkashicTests | wc -l` for the native count,
`npx vitest --run` for the web count.

- **The app**: MapKit globe with day/night terrain, journey detail, day-by-day
  experience (weather, fun facts, POIs, history), photo grid/lightbox/map
  markers, elevation profiles, stats, Spotlight, widgets (dormant), App Intents
  (Siri/Shortcuts).
- **Sync**: CKSyncEngine layer, hardened by three adversarial review rounds
  (zone loss recovery, account switching, share revocation, out-of-order
  delivery, first-save conflicts — all pinned by tests).
- **Sharing**: per-journey CKShare with roles — this *is* the family product.
- **Editing**: journey metadata, day/waypoint editing, photo import from
  Photos.app with EXIF day-matching, captions, comments.
- **Export (the exit door)**: per-journey zip — GPX + JSON + original photos.
  A genuine trust feature for paying customers: no lock-in of the data itself.
- **Public showcase**: owner-controlled publish of thumbnail+metadata mirrors to
  the public DB; signed-out web viewing on akashic.no. Doubles as *marketing* —
  every family that publishes creates shareable public pages.
- **Ops**: XcodeGen project, CI, headless TestFlight upload script, runbook.

## 4. Product gaps — the real work before v1.0

In order of size. Estimates are focused build-days, not calendar time.

### 4.1 Journey creation from scratch — **the big one** (~5–8 days)
Today a journey can only *arrive* (migration import or sync). A new family opens
an empty app and cannot make anything. v1.0 needs:
- "New journey" flow: name, country, dates, hero photo.
- **Route ingestion**: GPX *import* (we already export GPX; parse the same format
  — from Strava, Garmin, AllTrails, komoot) + a simple "draw on map" fallback +
  "no route yet" as a valid state (photos-only journeys must work).
  **Done** — all four sources now exist: GPX import (M1), inference from photo GPS
  (M9), **draw-on-map** (`RouteDrawing` + `RouteDrawingSheet`, in both creation and
  the M10 correction path), and no route at all. Drawn routes carry no elevation, and
  the UI says so before the user commits rather than showing wrong ascent numbers.
- Day/camp builder: add days manually, or seed them from photo dates (the
  PhotoDayMatcher logic in reverse — cluster photos by day, propose camps).
- Auto-computed stats where possible (distance/elevation from route).

### 4.2 First-run experience (~2–3 days)
- Onboarding: what Akashic is, where data lives ("your photos stay in *your*
  iCloud — we never see them"), iCloud sign-in state handling.
- A bundled **demo journey** (we have three gorgeous ones; ship one as read-only
  sample content, deletable) so the empty state sells the vision.
- **iCloud storage honesty**: photos count against the *owner's* iCloud quota.
  Onboarding must say so and link to iCloud+ upsell realities (50 GB tier
  handles most; our 5.4 GB family archive fits the free-ish tiers poorly but a
  200 GB plan trivially). Surprising people about storage is the #1 review-killer
  for this category.

### 4.3 De-scaffold the app (~1–2 days)
The Settings screen that confused even the owner: migration import, dry runs,
persistence-mode overrides, environment rows — all behind a hidden developer
gate (or compiled out of Release). Consumer Settings keeps: sync status, storage
usage, sharing management, export, "your name" for comments.

### 4.4 Paywall + pricing (~2–3 days)
StoreKit 2. See §5 for the model. Includes App Store receipt-free trial logic
(free tier limits enforced locally — acceptable; this is not a fraud target).

### 4.5 Public showcase moderation (~1–2 days + ongoing)
Once strangers can publish world-readable content to *our* public database, we
own moderation. v1: publishing gated behind a review-lite flow (report button on
web, a takedown script using the owner's CloudKit dashboard, clear terms). The
public DB's free quota scales with active users, and thumbnails-only keeps the
*per-photo* cost small — but see §2: it does **not** keep us "far inside" the
quota, because a 939-photo journey is ~56 MB per fully-scrolled view and reads
are unbounded. Moderation and cost share one control surface here: whatever caps
or gates publishing also caps egress, so build them once.

### 4.6 Store presence (~2–3 days)
App Store listing (screenshots, preview video of the globe), privacy policy
(short and genuinely true: "we collect nothing"), terms, support page on
akashic.no, age rating, the review process itself.

**Total to v1.0: roughly 3–4 focused weeks.** Nothing in the sync/storage layer.

---

## 5. Business model

### Decided (revised 2026-07-25): free core + one-time unlock ("Akashic Complete") at **kr 149**

- **Free**: 1 journey, full experience, sharing included, 100-photo cap — and
  **that journey is fully finishable: publishing and export included.**
- **One-time IAP kr 149** (`no.akashic.app.complete`, non-consumable): unlimited
  journeys and photos, plus Akashic Intelligence — which is **already built and
  already gated behind Complete**, not a v1.1 promise (§10). **Family Sharing ON**
  — one purchase covers the household, which matches the product's soul.

**Why the free tier now includes finishing.** The old line put the wall on the
*finish* ("publishing is part of Complete"), which withheld the exact moment that
creates the desire to pay — and strangled §6, where the showcase *is* the funnel:
gating publishing meant only people who had already paid could market the app. The
wall now falls purely on **"your second journey"**, which is also the photo-book
unit of value. Accepted trade: free publishing means the developer-billed public
database (§2) can be written to — and read from — without payment, so the
report/takedown machinery (§4.5) carries the abuse load alone and the egress bill
has no revenue attached to it. It is capped at one journey of ≤100 photos per free
Apple ID, and re-gating is an app update if abuse or cost appears.

**Why the price moved from 99 to 149.** kr 99 was anchored against *apps*. The
buyer's real alternative is a photo book: kr 400–1200, per trip. kr 149 once, for
every trip the family ever takes, for everyone in the family, is under half of one
book — and that sentence belongs in the paywall. kr 179 is defensible; kr 99 is
now under-priced against the product's own positioning. Price is changeable in
App Store Connect at any time, but raising it later looks worse than launching
there, so launch at the price we believe in.

**Why not subscription** — better reasons than the old cost argument (which priced
by *our* costs, and at near-zero marginal cost would argue for near-zero; note
that the showcase's public-DB egress in §2 is a *usage*-driven cost a one-time
price does not recover, which is an argument for capping the usage, not for
billing monthly): lapse semantics
collide with "memories are never hostages" — either a lapsed user keeps everything
(so why subscribe?) or loses access to their own memories, which is this
category's cardinal sin. Churn and billing support land on a solo maintainer, and
the shipped paywall already promises "one-time purchase, no subscription".

**Why not per-journey (consumable), despite it matching the unit of value best:**
consumables **cannot be Family-Shared**, which is fatal when the payer is often
not the author (Dad pays, Mum builds the journey). They also don't appear in
`Transaction.currentEntitlements`, so "which journeys are unlocked" becomes state
*we* must persist and restore — precisely the vendor-side liability this whole
architecture exists to avoid. Per-trip value is captured in the price level, not
the purchase unit.

### Revenue arithmetic (corrected — the old numbers ignored VAT)

Apple takes its commission **after** VAT is removed, and Norway charges 25 % VAT
on digital services. So the old "99 kr → ≈ 84 kr net" was wrong:

| Price | Net per household (÷1.25 VAT, ×0.85) |
|---|---|
| kr 99 | ≈ **kr 67** (not 84) |
| **kr 149** | ≈ **kr 101** |
| kr 179 | ≈ kr 122 |

Family Sharing means one household is one sale, so that is net *per household* —
and the counterfactual where a spouse buys a second copy of a family archive is
fiction, which is why Family Sharing costs approximately nothing real.

1 000 buying households ≈ **kr 101 000 lifetime**, against ~$99/yr plus a domain.
To be a side business rather than a hobby — say kr 100 000/year sustained — needs
~1 000 *new* buying households every year, i.e. ~15 000–35 000 downloads/year at a
plausible 3–7 % conversion. A Norwegian-language trekking-family niche does not
get there by default. **The honest framing is: a hobby with revenue.** What makes
launching rational anyway is that the marginal cost of selling is zero, the family
product exists regardless, and the downside is close to nothing. What the repositioning
buys is +50 % net per household for identical effort, and a far better subtitle.

## 5b. Polarsteps — the competitor we converge on (added 2026-07-25)

The reframe toward "the story of your trip, told" lands us next to **Polarsteps**,
not away from it. They are the incumbent for this exact job and they are good. Facts
as of July 2026: the app is free (trip planning, automatic GPS logging, sharing,
following other people's trips); **Polarsteps Plus** is a subscription (€8.99/mo or
€29.99/yr, verified 2026-07-29) that unlocks 3D trip replay with terrain, advanced
trip statistics and extra map styles, plus 20 % off books; and **Travel Books cost
€36–150** (24 pages minimum, free worldwide shipping). Since 2024 they also ship
**Travel Buddies** — collaborative trips, 5 contributors free and 10 with Plus — so
family/collaborative contribution is contested ground now, not an open flank: our
CKShare answer is *free and ungated* where theirs is a Plus feature, but it is
unproven across two Apple IDs until SHIP-15 runs. They still have **no GPX import**
(their support doc offers manual lat/long on the desktop site), and their loudest
verified complaint themes remain trips lost to failed syncs, GPS teleportation, and
blurry book photos — each one structural or self-inflicted in ways §5b's three
claims already answer.

**The striking data point: their paid upsell is our baseline.** 3D maps and advanced
trip statistics are what Plus sells. The globe, the elevation profiles, the per-day
and extended stats are what Akashic opens with, for free, in the free tier.

### Three claims they structurally cannot make

1. **Your trips live in your own iCloud. We run no servers and never see them.**
   Polarsteps is a server product — it has to be, because following other travellers
   and rendering print books both need the data on their side. They cannot copy this
   without abandoning their business.
2. **There is no account to create.** Your Apple ID is the account.
3. **One price, once.** kr 149 forever against a recurring subscription — and the
   things their subscription unlocks are in our free tier.

That is the subtitle and the first three lines of the store description. (Don't name
them in store copy; make the claims, let the reader do the comparison.)

### Where they beat us, honestly

| Their strength | Our position |
|---|---|
| **Android + iOS** | Apple-only, forever (§1). For a *family* product this is the sharpest loss — their followers can be anyone. State it plainly in the store description; a family that discovers it after paying is a refund and a one-star. |
| **Live tracking while travelling** — automatic background GPS, offline logging, real-time location for worried relatives | We do none of it, and **we should not build it.** It is their moat, it is expensive (background location, battery, server sync), and it belongs to a different job: they own *during* the trip, we own *after*. Added to the §9 not-building list. |
| **Printed books with worldwide shipping** | We cannot print, and print-with-logistics is a business we should not enter. S5 (PDF/printable export of the story view) is the closest honest answer, and it is v1.1. |
| **A social graph** — following other travellers compounds growth | Our equivalent is the public showcase page (§6), which is weaker as a loop but needs no servers of ours. |
| Years of polish, millions of users, a brand | A solo maintainer and a better architecture. |

### What their existence tells us

It validates the market twice over: people **do** pay for a book made from a trip
(€36–150, repeatedly), and people **do** pay a subscription for 3D maps and stats.
The threat is real, but the read is encouraging — the job exists and is monetisable,
and our version of it costs us nothing per user.

---

## 6. Go-to-market

- **The showcase is the funnel**: every published journey is a public page on
  akashic.no ("made with Akashic" + App Store link). Trek reports are already
  something people share after a trip. It is also the only line item that costs
  us per view (§2), so the funnel and the bill are the same pipe — a cap on
  published photos per journey is a growth lever *and* a cost control.
- Communities where trip reports live: r/hiking, r/Kilimanjaro-type subs, DNT
  forums, Facebook trekking groups, komoot/AllTrails adjacents.
- App Store search: "trip journal", "hiking diary", "trek map". The 3D globe
  demo video is the differentiator; lead with it.
- Launch: TestFlight beta with ~10 external families first (validates
  onboarding + journey creation with people who aren't us), then Product Hunt /
  HN "no-backend iCloud architecture" angle — that story is genuinely
  interesting to builders.

## 7. Legal & compliance (light, because the architecture is light)

- **Privacy**: no data collected by us; photos/journeys stay in user's iCloud;
  public publishing is explicit and owner-initiated. GDPR posture is unusually
  clean — we are barely a processor of anything. Still need the policy page.
- **Moderation/DMCA-style takedown** for the public DB (§4.5).
- **Export compliance**: already declared in the binary (exempt encryption).
- **Trademark/name check** for "Akashic" in app-store context before spending
  on brand.

## 8. Risks, stated honestly

| Risk | Severity | Mitigation |
|---|---|---|
| **Apple-only ceiling** — mixed-platform families bounce | High, structural | Accept for v1; web showcase gives read access; revisit §9 if traction |
| Journey creation UX misses (route drawing is hard to get right) | Medium | GPX import first (most trekkers have a track); ~~draw-on-map can be v1.1~~ — draw-on-map shipped for v1.0 (explicit Draw/Move-map modes, per-stroke undo); the beta (§11 phase 2) is what tests whether the interaction reads |
| Users blame *us* for iCloud storage costs | Medium | Onboarding honesty (§4.2); storage meter in Settings |
| Public-DB abuse / moderation burden | Medium | Gated publishing, report/takedown, thumbnails only |
| **Public-DB egress is billed to us, and a viral showcase is the bill** (§2) — ~56 MB per fully-scrolled 939-photo journey; ~45 full views/day at 1 000 customers before the free tier runs out; a 50 k-visitor spike ≈ 2.7 TB ≈ $270 in a day | Medium, and it is the *success* mode | Nothing built today: no publish cap, no throttle, no usage alert. Cheapest first moves are a per-journey published-photo cap, smaller thumbnails, lazy paging on the web, and a recurring CloudKit-dashboard usage check |
| Apple account loss = data loss (we cannot restore) | Low freq / high pain | Export prompts ("archive your journey"), clear docs |
| Solo-maintainer bus factor | Real | One-time pricing keeps the obligation honest; open data formats (export) keep users safe |
| CloudKit/MapKit platform shifts at WWDC | Low | Already isolated behind seams (map layer, sync seam) |

## 9. What we deliberately do NOT build (v1)

- **No custom backend, no Android, no web accounts.** That is the other
  architecture (Postgres + object storage + auth — roughly what we just
  decommissioned). It becomes worth revisiting only on strong traction, and it
  can then *coexist*: CloudKit stays the free family tier, backend powers a paid
  cross-platform tier. Decision gate, not a plan.
  **One honest amendment (§2):** "no backend" is not the same as "no per-view
  bill". The public showcase already *is* a vendor-hosted, vendor-billed read
  surface — we just don't operate it. So the argument for staying on CloudKit is
  operational (nothing to run, patch or page on) and about the private-data
  promise; it is not that showcase traffic is free. The comparison to make at the
  decision gate is CloudKit public-DB overage against object storage plus a CDN,
  which at showcase volumes is not obviously in CloudKit's favour — the rest of
  the stack still is.
- No AI features beyond §10's on-device/PCC ladder, no social graph, no feeds. The
  product is a family archive, not a network.
- **No live tracking while travelling** — no background GPS, no "follow my trip",
  no real-time location for relatives. That is Polarsteps' moat (§5b), it costs
  battery and servers, and it belongs to *during* the trip while this product is
  about *after*. Deciding this explicitly is what keeps the scope honest.
- **No print pipeline.** A PDF the user can print or hand over (S5) is the answer;
  paper, binding and worldwide shipping is a different company.

## 10. Apple Intelligence — the differentiation layer

On-device AI fits this product unusually well, because it extends the core
promise instead of breaking it: **AI features with zero cloud cost and zero
data leaving the family's devices.** Competitors that bolt GPT onto a photo app
must ship your memories to a third party; we never do. That sentence belongs in
the App Store description.

**The platform reality (honest version).** The integration point for
third-party apps is the **Foundation Models framework** (iOS 26+): direct,
free, offline access to the on-device model — structured/guided generation,
tool calling, streaming. It is a ~3B-class model: excellent at summarizing,
drafting, naming, extracting and classifying *over content we hand it*; not a
world-knowledge oracle. We also inherit Apple's own features for free (Writing
Tools appear automatically in our caption/notes/comment fields on AI-capable
devices).

> **CORRECTION (2026-07-25).** This section previously said Private Cloud Compute
> was not exposed to third-party apps. **That changed at WWDC26.** The Foundation
> Models framework now reaches PCC, gained vision capabilities, and gained a model
> abstraction so a session can run against Apple's on-device model, Apple's
> frontier model on PCC, or a third-party package (Anthropic and Google both ship
> Swift packages).
>
> **We qualify for it free.** Apple gives PCC access at **no cloud API cost** to
> developers who are (a) enrolled in the App Store Small Business Program — which
> we are doing anyway for the 15 % rate — and (b) under **2 million first-time
> downloads**, with (c) a **PCC entitlement requested** from Apple. TestFlight and
> ad-hoc installs don't count toward the threshold. If we ever cross 2 M or leave
> the Small Business Program, Apple gives 6 months to migrate off.
>
> What this changes: the §10 ladder was scoped around a ~3B on-device model, which
> is why the drafters are locked to rearranging facts and retrieving from
> Wikipedia. A frontier model on PCC lifts that ceiling **without breaking the
> privacy story** — still no servers of ours, still nothing we can see. It does not
> change the gating discipline: PCC is available only where Apple Intelligence is,
> so every AI feature stays runtime-gated and simply absent elsewhere, never a
> broken button.
>
> **But it cannot be in v1.0, for a reason that has nothing to do with cost.**
> PCC-backed Foundation Models is developer-preview-only until **production PCC
> ships with iOS 27 in autumn 2026**. v1.0 ships before that, to an installed base
> that is mostly still on iOS 26, so a PCC feature would be gated off for nearly
> everyone who installs it. Every PCC-dependent item below stays v1.1 or later;
> the on-device ladder is what v1.0 can actually stand on.
>
> **Action:** request the entitlement (developer.apple.com/contact/request/private-cloud-compute/)
> — it is free, and the request should go in early since it is a review by Apple,
> not a toggle. Requesting it now costs nothing and removes it from the critical
> path for v1.1.

**Hardware gate:** Apple-Intelligence-capable devices (iPhone 15 Pro and newer);
the app targets iOS 17, so every AI feature is runtime-gated and simply absent
on older devices — never a broken button.

**What already ships (as of 2026-07-26).** This section used to read entirely as
future work; three ladder rungs are in fact built, gated and reachable from real
UI today. `apple/Akashic/Intelligence/` holds five files:

| Shipped | File | Reachable from |
|---|---|---|
| **Day-note drafting** — "write up this day" from text metadata only: camp name, elevation, per-day distance/ascent/descent, weather, highlights, photo *count* and user-written captions. No photo bytes, no Vision labels. | `DayNoteDrafter.swift` | `Views/Edit/WaypointEditSheet.swift:177` |
| **Grounded fun-facts / historical notes** per day, constrained to place names the enrichment step already found, plus retrieved reference text | `FactDrafter.swift` | `Views/Edit/WaypointEditSheet.swift:281` |
| **Smart day naming** in the §4.1 creation flow — names the proposed days ("Summit night", "Rest day by the river"), and only days still carrying a `Day N` placeholder | `DayNamer.swift` | `Views/NewJourney/NewJourneySheet.swift:1085` |
| **Geo-verified Wikipedia/Wikivoyage retrieval** feeding both drafters | `KnowledgeRetrieval.swift` | both call sites above |
| **The availability gate** — `Intelligence.isAvailable` (iOS 26 + Apple-Intelligence-capable device + `AKASHIC_DISABLE_AI` kill switch); the Complete entitlement is `&&`-ed in at each call site | `IntelligenceAvailability.swift` | every entry point |

Every one is `@available(iOS 26.0, *)` behind `#if canImport(FoundationModels)`,
uses `@Generable` guided generation, and writes nothing without the user
accepting a suggestion. Note the caveat in CLAUDE.md: CI runs Xcode 16.4, where
`canImport(FoundationModels)` is false, so this code is not type-checked by
anything automated.

**Feature ladder — what is genuinely still ahead** (each one = on-device model +
data we already store):

| Feature | Ingredients | Where |
|---|---|---|
| **Photo-grounded day notes** — lift day-note drafting from metadata to what is actually *in* the photo | Vision — **not present in the codebase today** | v1.1 |
| **Hero & best-of curation** — suggest hero image and per-day highlights by aesthetic score | Vision (would work on ALL devices, no AI gate) | v1.1 |
| **Journey narrative** — showcase-ready summary from days+stats, one tap before publishing | Foundation Models | v1.1 |
| **Streaming output** — drafts that appear as they are generated instead of after a spinner | `streamResponse` — no streaming call site today | v1.1 |
| **Natural-language search** — "the photo where we crossed the river", on-device embeddings over captions+labels | NLContextualEmbedding / FM tool calling over our App Intents — **no `Tool` conformance today** | v1.2 |
| **Writing Tools** in captions/notes/comments | Free from the OS | Already inherited |

**Positioning**: brand the bundle "Akashic Intelligence", included in the paid
unlock — it fattens the paid tier without adding a krone of marginal cost. Since
the first three rungs already ship, the paid tier can claim it at v1.0, not v1.1.

## 11. Roadmap

| Phase | Content | Gate to proceed |
|---|---|---|
| **0 — now** | Family on TestFlight, 1 month of real use | It stays stable & family actually uses it |
| **1 — v1.0 build** (~3–4 wks) | §4.1–4.6 | **Green-lit 2026-07-24** — §4.1 build started |
| **2 — closed beta** | ~10 external households create journeys from their own photos | **(a)** ≥7 create one unaided · **(b)** ≥5 *finish and hand one over* — user-written words on ≥3 days, and actually shared outside the household (CKShare accepted, showcase link sent, or export delivered) · **(c)** ≥5 answer yes to "would you send this instead of making a photo book?" |
| **3 — launch** | App Store + showcase funnel + communities | — |
| **4 — "the finished story"** | PDF/printable book export of the story view, people/companions, hero + best-of curation (needs Vision), interview-mode drafting (the model asks two grounded questions, then weaves the answers in), streaming drafts. The on-device drafting bundle is **not** in this phase — it ships in v1.0 (§10); what is left here is the Vision/PCC/streaming half | Launch stable |
| **5 — iterate** | ~~Draw-on-map~~ (shipped in v1.0), NL search, live activity, watch app, Strava API import | Sales signal |
| **6 — platform decision** | Android/web via real backend | Only on clear demand + revenue |

## 12. Immediate next steps

1. ~~Green light~~ — given 2026-07-24; §4.1 (journey creation + GPX import) in
   progress. Family month (phase 0) continues in parallel — it *is* the beta.
2. Trademark/name sanity check.
3. Then paywall + de-scaffolding + listing, beta, launch. Intelligence needs no
   step here — day-note drafting, fact drafting and day naming already ship (§10);
   what is left for v1.1 is Vision, streaming and tool calling.

---

*The one-sentence version: we accidentally built the correct architecture for a
near-zero-marginal-cost consumer product — the one exception being the public
showcase's egress, which is billed to us (§2) and needs a cap before it needs a
budget; what remains is product work — creation, onboarding, paywall — not
infrastructure.*
