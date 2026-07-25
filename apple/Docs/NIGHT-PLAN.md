# Night plan — 2026-07-25 → 26

Written before Christopher goes to bed, to be reviewed by him first. Task IDs are from
[`DESIGN-PLAN.md`](DESIGN-PLAN.md); the gates are from [`COMMERCIALIZATION-PLAN.md`](../../COMMERCIALIZATION-PLAN.md) §11.

## The honest framing

**"Finish the whole app" is not achievable overnight, and it is worth being precise about why.**
Three categories of work exist, and I can only close one of them:

1. **Agent-doable** — everything in the C/D/S/A backlog that is code, docs or screenshots. This is
   what tonight is for, and it is realistically finishable.
2. **Needs Christopher's accounts** — trademark check, creating the IAP, Small Business Program,
   the Private Cloud Compute entitlement request, entering App Store Connect metadata, adding
   TestFlight testers, the Pages/DNS cutover. I cannot do any of it, and none of it is code.
3. **Needs other people** — the external beta itself (~10 households, ≥2 weeks). Nothing shortens
   this, and it is the actual gate to launch.

So the goal tonight is: **leave category 1 empty**, and leave a short, ordered list for category 2
on the kitchen table.

## Order of work

Sequenced by dependency and by how much of the night each can waste if it goes wrong. Each item is
one delegated agent unless noted; **each simulator-verifying agent gets its own booted device**
(iPhone 17, 17 Pro, 17 Pro Max, 17e, iPad Pro 13") — tonight proved two agents on one simulator
interfere with each other's verification, which is exactly when verification matters most.

| # | Task | Why here | Risk |
|---|---|---|---|
| 1 | **S2 — `journeyType` written honestly** | Half a day, no UI, and every journey a beta household creates otherwise fossilises a false value in Production data. Cheap, and it unblocks nothing else, so it goes first to get it out of the way. | Low |
| 2 | **D2 — iPad regular-width layout** | The largest single item and a hard submission gate (13" screenshots are mandatory). Starting it early leaves room for a second pass if the floating day panel doesn't work first time. | **High** — the signature map-plus-sheet loop has to survive |
| 3 | **C5 + C6 — draft map card and partial-failure copy** | One agent: both touch the review screen, and splitting them across agents in one file is a merge fight. Finishes the creation flow. | Medium |
| 4 | **D4 — Stats journey picker** | Small, and it breaks precisely when someone pays. | Low |
| 5 | **D6 — photo-grid duplicate thumbnails** | Verify first; fix if real, close with a note if the screenshot was stale. | Low |
| 6 | **C7 — GPX document handler** | Sharp edge is Info.plist generation through XcodeGen: the keys must be verified in a **Release-CloudKit** archive, not just Debug. | Medium |
| 7 | **D9 — bundled demo journey** | Promoted to submission by the design round: the only way a prospect sees a *finished* story before making one. Ship Kilimanjaro read-only and deletable, per plan §4.2. | Medium — must not pollute a real user's library |
| 8 | **App Store screenshots** | Needs D2 done (iPad) and D9 (something worth showing). Six-shot set per `screenshots-plan.md`, both device sizes, clean status bar. | Low |
| 9 | **A4 — "would Apple ship this screen?"** | A design round, last, once D2 and the appearance work have settled — running it earlier reviews something about to change. | Low |

Then: full suite, all five configs, a walk-through of the whole app on two devices, PR, merge when
CI is green (same as today), and a morning report.

## What I will not do, deliberately

- **Anything needing his Apple accounts.** Listed below instead.
- **v1.1 items**: S4 cabin-diary presentation, S5 PDF book, S6 interview drafting, S7 people,
  C8 Siri creation, C9 GPX trackpoint days, C10 hero photo, C11 suggested journeys, D7 chart
  accessibility, D8 chrome slimming. The repositioning round was explicit that v1.0's delta is
  small and that the book frame seduces toward scope — holding that line is the point.
- **The web client.** Retiring or rebuilding it is a separate decision (§5b), and the npm audit
  dependency PR is unrelated to shipping the app.
- **Reduce Transparency verification** — it would not stick in the simulator; it needs a physical
  device, which is his to run.
- **Merging anything that fails CI**, and no force-pushes.

## Waiting for you in the morning (nothing here is code)

Ordered by what blocks the most:

1. **Trademark / name check** for "Akashic" (Patentstyret + EUIPO, classes 9 and 42). Go/no-go on
   the brand before screenshots and marketing.
2. **Create the IAP**: `no.akashic.app.complete`, non-consumable, **Family Sharing ON** (one-way
   door — it can never be turned off), **kr 149** (revised; the old kr 99 was anchored against apps,
   not against the photo book the buyer is actually choosing between — and note the corrected VAT
   arithmetic: ≈ kr 101 net, not kr 127).
3. **Enrol in the Small Business Program** (15 %) — and it is also one of the three conditions for
   free Private Cloud Compute.
4. **Request the PCC entitlement** — free, but Apple reviews it, so early.
5. **Enter App Store Connect metadata** from `docs/store/app-store-listing.md` — **read its
   revision block first**: the current copy advertises a paywall that no longer exists.
6. **TestFlight**: family as internal testers, then the external group for the beta.
7. **Physical-device check** of Reduce Transparency.
8. Later, not blocking: Pages/DNS cutover, App Group for the widget, Universal Links TEAMID.

## The gate none of this shortens

COMMERCIALIZATION-PLAN §11 phase 2, as rewritten today: ~10 external households, **≥7 create a
journey unaided**, **≥5 finish and hand one over** (own words on ≥3 days, actually shared outside
the household), **≥5 say they would send it instead of making a photo book**. Two weeks minimum,
plus Beta App Review. That is the real distance to launch, and it starts the day the testers are
invited — which is why item 6 above is worth doing before anything else on the list.

## What you will wake up to

A morning report at the top of the session: what landed, what I verified on screen versus by test,
what I could not verify and why, and anything I found that I judged out of scope. Every task will
be its own commit with its reasoning, and `main` will carry whatever passed CI.
