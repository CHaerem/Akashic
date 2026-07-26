# Launch Checklist — Akashic Journeys

Ordered from today (2026-07-24) to live on the App Store. Grouped into phases; the
phases are sequential but items inside a phase can overlap. Nothing here touches the
sync/storage layer — this is product + store work only.

The build gates (journey creation §4.1, paywall §4.4, de-scaffolding §4.3,
onboarding §4.2) are owned by other agents and tracked in `COMMERCIALIZATION
-PLAN §4`; this checklist assumes they land and covers everything **store-side**.

---

## Phase A — Foundations (do first, cheap, unblock everything)

- [ ] **Trademark / name sanity check.** Before spending on brand:
  - App Store name **Akashic Journeys** is already registered in App Store Connect
    — good, but registration ≠ trademark clearance.
  - Search the EUIPO and Norwegian (Patentstyret) trademark registers for
    "Akashic" in the relevant classes (Class 9 software / Class 42 SaaS). "Akashic"
    is a common word (Akashic records) and is used by other software/products —
    confirm no blocking mark for a travel/photo app in EU/Norway, and that the
    App Store name doesn't collide with an existing app.
  - This is a go/no-go on the brand; do it before screenshots/marketing spend.
    Not legal advice — if anything looks close, get a quick opinion from an IP
    lawyer before launch.
- [ ] **Confirm support + privacy pages are live.** `https://akashic.no/support.html`
      and `https://akashic.no/privacy.html` must exist and be reachable (App Review
      opens both; §4.6 sibling task builds them). Privacy page must state plainly:
      "we collect nothing; your data lives in your own iCloud."
- [ ] **Apple Developer Program active** ($99/yr — already paid) and the
      `no.akashic.app` App ID / `iCloud.no.akashic` container exist in Production.

---

## Phase B — Store metadata & assets

- [ ] **Enter App Store Connect metadata** from `app-store-listing.md`:
      name, subtitle (EN + NB), promo text, description (EN + NB), keywords
      (EN + NB), categories (Travel primary, Photo & Video secondary), URLs,
      copyright, age rating 4+.
- [ ] **App Privacy** = Data Not Collected across all categories
      (`app-store-listing.md §4`).
- [ ] **Screenshots**: produce the 6-shot set for 6.9" iPhone and 13" iPad per
      `screenshots-plan.md` (clean status bar via `simctl status_bar override`,
      real Kilimanjaro/Inca/Mount-Kenya data). Optional: globe preview video.
- [ ] **App Review notes**: paste the block from `review-notes.md`.
- [ ] **App icon** finalised at all required sizes (1024px marketing icon uploaded).

---

## Phase C — In-App Purchase setup (the paywall product)

Depends on the StoreKit 2 paywall build (§4.4). Set up the product in Connect in
parallel:

- [ ] **Create the IAP** in App Store Connect:
  - **Product ID:** `no.akashic.app.complete`
  - **Type:** Non-Consumable (one-time unlock — matches §5 "buy once")
  - **Reference name:** `Akashic Complete`
  - **Display name (EN):** `Akashic Complete` · **(NB):** `Akashic Complete`
  - **Description (EN):** "Unlock unlimited journeys and photos, plus Akashic
    Intelligence. One purchase, shared with your whole family."
  - **Description (NB):** "Lås opp ubegrenset antall reiser og bilder, pluss Akashic
    Intelligence. Ett kjøp, delt med hele familien."
  - ⚠️ **Do not write "publishing" or "export" into this description.** Both are
    free-tier capabilities (`EntitlementPolicy.canPublish`/`canExport` return `true`
    unconditionally, §5 revised) — advertising them as paid is a claim App Review can
    falsify against the binary. This description, the paywall benefit list in
    `PaywallView.swift` and `app-store-listing.md §2/§3` must all say the same thing.
  - **Family Sharing: ON** — required; one purchase covering the family is core to
    the product (§5). Toggle it before first submission (turning it on later is
    fine, but set it now).
- [ ] **Price:** the Norwegian **kr 149** tier (revised 2026-07-25 — see
      COMMERCIALIZATION-PLAN §5: kr 99 was anchored against apps, not against the
      kr 400–1200 photo book the buyer is actually choosing between). **Net is
      ≈ kr 101, not kr 127** — Apple's commission applies after 25 % Norwegian VAT
      is removed (149 ÷ 1.25 × 0.85), an arithmetic error that was in this file and
      in §5 until today. Let Apple auto-set worldwide equivalents; review
      the US/EUR equivalents look sane (~$9–10 / €9–10). One-time, not subscription.
- [ ] **Enrol in the Apple Small Business Program** (< $1M/yr → **15%** commission
      instead of 30%). This roughly doubles net margin; do it before first sale.
- [ ] **Free tier is enforced locally** (1 journey, 100-photo cap) — no server
      receipt check needed (§4.4). **Revised 2026-07-25: the free journey is fully
      finishable — neither publishing nor exporting is paywalled.** The wall falls only on
      the *second* journey. Confirm `EntitlementPolicy`, the paywall benefit list and
      the IAP description in Connect all agree on that, or the paywall makes a claim
      App Review can falsify.
- [ ] **The IAP must be submitted for review WITH the first app version** — a new
      app's first IAP is reviewed alongside the binary. If it isn't attached to the
      version and reachable by the reviewer, it won't be approved. (See
      `review-notes.md` checklist.)

---

## Phase D — TestFlight external beta (the real gate)

`COMMERCIALIZATION-PLAN §6/§11 phase 2`: ~10 external families create journeys
**from scratch** — this validates onboarding + journey creation with people who
aren't the developer. Gate to proceed: **≥7 complete a journey without help.**

- [ ] Upload the release-candidate build (headless upload script exists — §3 ops).
- [ ] **Internal TestFlight** first (the owner's family) — smoke test on real
      devices, no beta review needed for internal testers.
- [ ] Create an **External** TestFlight group ("Beta families", up to 10 000 but
      seed ~10 families).
- [ ] **External TestFlight requires Beta App Review** — the first external build
      goes through a lighter Apple review before external testers can install.
      Budget ~1 day and provide the same reviewer notes (`review-notes.md`). Plan
      for this; it's a common surprise.
- [ ] Provide beta testers a short "what to try" note: create a journey (GPX import
      or photos-only), share with family, publish, export. Collect feedback via the
      TestFlight feedback channel + `support@akashic.no`.
- [ ] **Run the beta at least ~2 weeks / one real trip cycle.** Watch for the
      storage-surprise reaction (§4.2 / §8 risk row) — the #1 review-killer for this
      category. Confirm onboarding sets iCloud-storage expectations honestly.
- [ ] **Gate check:** ≥7 of 10 families complete a journey unaided → proceed. If
      not, fix onboarding/creation before public submission.

---

## Phase E — Submit for App Store review

- [ ] Final build uploaded; version metadata, screenshots, IAP, and reviewer notes
      all attached to the version.
- [ ] Re-run the **`review-notes.md` pre-submission checklist** (populated demo
      state on a clean Apple ID is the highest-risk item).
- [ ] **Choose phased release.** Recommend **Phased Release for automatic updates**
      is for updates, not first launch — but for the initial go-live, use **"Manually
      release this version"** so you control the exact go-live moment (align it with
      the akashic.no showcase funnel + any community/Product Hunt post, §6). After
      approval, release manually when day-one support is staffed.
  - For the **first version** there is no phased %-rollout (that applies to
    subsequent updates); the control you have is manual vs automatic release. Use
    **manual**. Turn on **Phased Release** for later feature updates to de-risk
    regressions across the install base.
- [ ] Consider submitting a couple of days before the intended public date to
      absorb any rejection round without slipping the launch.

---

## Phase F — Day-one support readiness (before you tap "Release")

- [ ] `support@akashic.no` monitored; `support.html` has the mailto + a short FAQ
      (iCloud requirement, storage/quota honesty, "how do I export", "how do I
      share", "why can't my Android relative use it — they can view published
      journeys on the web").
- [ ] **Public-showcase moderation ready** (§4.5): report button live on the web,
      takedown procedure documented (owner's CloudKit dashboard), terms page up.
      The moment strangers can publish world-readable content, this must exist.
- [ ] Privacy Policy + Terms live and linked from the app and the site.
- [ ] Watch the first App Store reviews and crash reports (Xcode Organizer) daily
      for the first week; keep promo text ready to adjust (editable without review).
- [ ] Rollback plan: know how to pull the version / disable the IAP if a serious
      issue surfaces.

---

## Quick reference — decisions baked in

| Item | Value |
|---|---|
| IAP product ID | `no.akashic.app.complete` |
| IAP type | Non-consumable, one-time |
| Family Sharing | **ON** |
| Price | **kr 149** tier (≈ kr 101 net: ÷1.25 VAT, ×0.85 Small Business) |
| Commission program | Apple Small Business (15%) — enrol before first sale |
| Beta | External TestFlight, ~10 families, Beta App Review required, gate ≥7/10 |
| First release | Manual release (control go-live); phased rollout for later updates |
| Categories | Travel (primary), Photo & Video (secondary) |
| Age rating | 4+ |
