# Design review & implementation backlog

**Reviewed 2026-07-25** by two design passes (Fable 5) over the shipping build: one on visual design + Apple HIG conformance, one redesigning journey creation. Screens reviewed live in [`design-review/`](design-review/); the older surfaces are the `screenshot-*.png` set.

This file is the **delegation contract**: every task below is sized for one implementation agent working alone (a few focused hours), and states what "done" means so the agent can check itself. Task IDs are stable — cite them in commits.

---

## Verdict

The signature surfaces are genuinely designed, not developer-assembled. The globe landing, the day sheet's hierarchy, the paywall's state handling and — repeatedly called out by both reviewers — **the honesty of the copy** are competitive assets. Keep the voice exactly as it is.

The pre-submission work is concentrated and unglamorous: **type scale, accessibility labels, touch targets, and an iPad that doesn't break the signature interaction.** Plus one creation-flow defect that is the most likely single cause of failing the beta gate (C2 below).

### Decisions recorded (do not "fix" these)

| Deviation | Verdict |
|---|---|
| ~~Dark-only app-wide~~ | **WITHDRAWN 2026-07-25 by the owner — see A3.** The app follows the system appearance and offers an Appearance picker (A5). What survives of this decision: the *immersive map* stays dark in every appearance, which is what Apple Maps and the Photos viewer do. |
| Sheet-first navigation from the globe | **Keep.** The globe *is* the app; retrofitting a NavigationStack world would cost more than it returns. |
| Cyan as trek-mode selection colour | **Keep on the map** (correct on satellite imagery). Stop it leaking into text kickers — see D8. |
| Two-mode draw/pan in `RouteDrawingSheet` | **Keep.** Gesture arbitration would be worse. |
| Route drawing has no VoiceOver path | **Acceptable**, because GPX import and photos-only journeys mean no VO user dead-ends. Document, don't fix. |
| Free-tier enforced locally, no receipt check | **Keep.** Not a fraud target. |

---

## The five findings worth reading before any task

1. **Creation throws the user's photo pick away.** `seedDaysFromPhotos` loads every picked photo's bytes, reads EXIF, discards the data — then the caption asks the user to pick the same photos *again* after creating. A family will experience that as the app losing their photos. This is the top beta risk (**C2**).
2. **The iPad day sheet breaks the signature loop.** `presentationDetents` + `presentationBackgroundInteraction` don't exist on iPad, so the map-plus-sheet interaction becomes a form sheet *covering* the map. `TARGETED_DEVICE_FAMILY = "1,2"` means 13" iPad screenshots are mandatory at submission (**D2**).
3. **Map chrome bottoms out at 9–10 pt**, fixed, often at 40 % white. Smaller than anything Apple ships, in an app whose audience skews older (**D1**, **D3**).
4. **The Stats journey picker is a segmented control** that already truncates at three journeys — it breaks precisely when someone pays for unlimited journeys (**D4**).
5. **`Store/Akashic.storekit` declares `familyShareable: true`.** The App Store Connect product must match, or the paywall's "shared with your whole family" claim is false in production (**D5**, config check).

---

## Sequencing

```
C1 ──→ C2 (critical path — do not cut C2)
   ├─→ C3, C4, C5, C6   (parallel after C1)
C7 ─── parallel to everything
D1 ──→ D3   (same conversion, chrome first)
D2 ─── independent, largest single item
D4, D5, D6 ─── independent, small
```

**If the beta date forces a cut:** reduce C5's live map to a static snapshot and drop C6's GPX-no-waypoints copy. Never cut C2.

---

## Creation flow — C-series

The redesign: a **two-phase sheet**. Phase 1 is a three-card chooser ("what do you have?" — photos / GPX / just a name); every path converges on Phase 2, a single review screen that is an evolution of today's form. Two screens, ever. The user makes one decision, then *reviews a proposal* instead of *filling a form* — that difference is what the "≥7 of 10 unaided" gate measures.

Policy change this encodes: **structural facts derived from the user's own data (route, country, dates) are applied by default, visibly and reversibly**; only *enrichment* (geocoded names, weather, POIs, facts — words the user didn't write) stays opt-in behind Accept/dismiss. "Set country: Tanzania — Accept?" is a quiz question, not a review.

| ID | Task | Gate |
|---|---|---|
| **C1** | ✅ **Two-phase sheet: chooser → review.** Restructure `Views/NewJourney/NewJourneySheet.swift` around a `phase` enum (`.chooser`, `.review(origin:)`). Three chooser cards: photos (promoted, opens `PhotosPicker` immediately), GPX (opens `fileImporter`), just-a-name (straight to review). Extract `NewJourneyChooser.swift`. Review renders today's sections reordered — name, route summary, country, dates, days, suggestions — with **no behaviour change yet**. Expose an initialiser that starts in review with a preloaded `GPXFile` (C7 needs it). Draw-on-map is deliberately *not* a chooser card — it stays one tap away in the review screen's Route menu. **Done when:** all three paths reach review and create; cancel works from both phases; existing draft/suggestion tests untouched and green. **Risk:** low — view restructuring over an unchanged model. | beta |
| **C2** | ✅ **Ingest photos once.** Stage picked items through the existing `PhotoIngestService.ingest(pickerItem:journeyId:sortOrder:)` keyed to `draft.id` (minted up front precisely for this), deriving EXIF fixes and day clusters from the *same* pass — delete today's discard-the-bytes probe path. Record photo→day assignment during clustering (new sibling of `JourneyDraft.days(fromPhotos:)` returning days + assignments, unit-tested); a deleted proposed day leaves its photos unassigned. On create: `createJourney` → `addIngestedPhotos` with `waypointId` stamped, capped via `EntitlementPolicy.photosAllowed` with `PhotoImportSheet`'s partial-import banner. On cancel/dismiss: delete staged files (`PhotoEditService.deleteFiles`) — copy `PhotoImportSheet`'s cleanup contract exactly. Determinate "Preparing photos… 12 of 42"; Create disabled only while staging. **Done when:** photos-first → create → journey opens with photos on the right days; a test asserts cancel leaves no files under the draft's id; over-cap imports the cap and names the remainder. **Risk:** medium — file lifecycle on cancel/kill. | beta |
| **C3** | ✅ **Structural defaults applied, not asked.** Photos-first: apply the `RouteInference` result to `draft.route` directly (drop the `.routeFromPhotos` Accept row), surface `RouteConfidence.summary` verbatim plus a Remove action; a removed route must never re-apply on a suggestion re-run (drive through `SuggestionModel`'s dismissed state; test it). Country: fill `draft.country` from the centroid geocode **only while the field is untouched**, marked "suggested"; user edits always win. Add a name-suggestion chip (*Use "Tanzania, September 2023"*) that applies only on tap and never fires on a non-empty name. **Done when:** unit tests cover remove-route-then-rerun, never-overwrite-typed-country, chip-never-fires-on-non-empty. **Risk:** medium — deliberately amends "nothing applied silently"; the mitigation is that application is visible and reversible. | beta |
| **C4** | ✅ **Auto dates + compact row; cut Description.** Derive `dateStarted`/`dateEnded` from photo clusters (first/last `dayKey`) and from GPX waypoint/file times — pure helpers on `JourneyDraft`, unit-tested, **UTC throughout** to match the existing formatters. Replace the two toggle+picker rows with one row: derived range + provenance caption ("from your photos") + Edit; "Add dates" when nothing was derived. **Delete the description section from creation** — it is the classic field that stalls completion, and `JourneyEditSheet` already edits it. **Done when:** date-derivation tests pass; weather suggestions appear for photo-seeded days without the user setting dates (they feed `JourneyDraft.weatherDate`). **Risk:** low. | beta |
| **C5** | ✅ **Map preview card + Route options menu.** New `Views/NewJourney/DraftMapCard.swift`: non-interactive `Map` (fall back to `MKMapSnapshotter` if scrolling suffers) with the drafted polyline and day pins, fitted with the existing `MKCoordinateRegion.fitting`. Caption carries the provenance line — inference confidence / GPX points-waypoints / drawn-route elevation note. Menu: *Replace with GPX · Draw on map · Remove route*, the drawing sheet keeping its apply-on-dismissal discipline. This card is the magic moment: the user's trip appearing on a map, and the honest review of the inference, in one object. **Done when:** all three provenances render; day pins track day deletion; Remove clears route and stats. **Risk:** medium — live `Map` inside a scrolling form. | beta |
| **C6** | ✅ **Partial-failure states.** Photos with dates but no GPS → map card empty state, *"Your photos carry dates but no locations, so days were proposed without a route"* + inline **Import GPX · Draw on map · Skip**. No readable dates → photos attach unassigned, days built later. GPX with track but no waypoints → *"This file had no waypoints, so no days were proposed"*. Malformed GPX → existing typed `GPXParseError` where the import started. Sweep every creation caption for the new model — delete "Add the actual photos after creating the journey". **Done when:** four simulator fixtures (geotagged, dateless, trackpoint-only, malformed) each show their state and every one still reaches Create. **Risk:** low. | beta |
| **C7** | ✅ **Register as a GPX document handler.** `project.yml`: `CFBundleDocumentTypes` importing `com.topografix.gpx` (Viewer), `UTImportedTypeDeclarations` (extension `gpx`, conforms to `public.xml` — it is not a system UTI), `LSSupportsOpeningDocumentsInPlace: NO`. Sharp edge: `GENERATE_INFOPLIST_FILE: YES` means these need XcodeGen `info.properties` — **verify the generated plist carries them in `Release-CloudKit`, not just Debug.** In `AkashicApp.swift`: `onOpenURL` → security-scoped read → `GPXParser.parse` off-main → present the sheet in review phase (C1's initialiser) with the name pre-filled from `<name>`; journey-limit paywall gate first; parse errors in an alert. v1 always creates a *new* journey. **Why before the beta:** the current path (Strava → Files → app → sheet → Route → Import → find file) is exactly where a non-technical user fails unaided. **Done when:** sharing a `.gpx` from Files and from Mail offers Akashic and lands in review with the route drawn; malformed alerts without presenting. **Risk:** medium — plist generation. | beta |
| **C8** | *(demoted to v1.1 by the 2026-07-25 round — a Siri creation surface serves neither creating-unaided nor finishing.)* **`CreateJourneyIntent`.** First *writing* App Intent: `(name, country?)` → minimal draft → `JourneyStore.createJourney` → open the app to it (the next-steps card is a coherent handoff). Enforce the free-tier limit with a friendly thrown `AkashicIntentError`; same JSON contract as the read intents; EN + NO phrases in `AkashicShortcuts.swift`. Deliberately post-beta: it cannot move the gate (families won't discover Siri first) and it adds a second creation surface during the UI's churniest week. **Risk:** low. Keep it name-only. | launch |
| **C9** | **Days from timestamped GPX trackpoints** when a track has no waypoints: cluster by UTC `dayKey`, one day per calendar day, coordinate = last trackpoint of the day. Requires `GPXParser` to retain per-point times (dropped today). **Risk:** medium — parser memory shape on big tracks. | v1.1 |
| **C10** | **Default hero photo** from the ingested set on create, user-overridable. **Verify first** whether the UI already falls back to the photo grid; close as no-op if so. | v1.1 |
| **C11** | **Suggested journeys — detect trips in the photo library.** The app currently waits to be told about a trip; the library already knows. Fetch `PHAsset` metadata (`creationDate`, `location`) — available locally even for iCloud-optimised libraries, no bytes downloaded — and cluster spatio-temporally: runs of consecutive days at locations far from the user's usual ones. Each cluster becomes a proposed journey, and **everything after detection already exists**: `RouteInference` for the route, `daysWithAssignments` for the days, centroid geocoding for country and name, `JourneySuggestions` for camps/weather/POIs/facts. Detection itself is deterministic clustering, not ML; AI adds naming, day notes and hero curation. **The costs are real and belong in the decision:** the app uses `PhotosPicker` today and therefore needs *no* library permission and no usage string — a library scan needs full access and `NSPhotoLibraryUsageDescription`, which changes onboarding and the review story (still "we never see them", but a scarier prompt); a 50 k-asset library needs an incremental, cancellable background pass; and a weekend at the cabin is not a trek, so the threshold needs a cheap dismiss. **Why v1.1, not now:** C2 just made the manual photos-first path good — ship it, watch ten families use it, then automate what they actually did by hand. | v1.1 flagship |

---

## The story — S-series (added 2026-07-25, after the repositioning round)

The owner reframed the product: **an alternative to the photo book people want but never get around to making.** A second Fable round weighed that and concluded the frame is right *as a job to be done*, not as a category — never say "photo book" in store copy, because it promises print. What the frame obliges is a definition of **done**: a journey must be finishable into something linear, self-narrated and handable. That turns out to cost three small things on top of a backlog that survives the reframe almost unchanged, which is itself the finding — the *work* was aimed correctly; only the *goal statement and the gate* were aimed at trip-tracking.

It also corrected three things this file previously implied:

- **The story view is not missing — it exists on the web.** `src/components/journey/JourneyTimeline.tsx` and `DayChapter.tsx` already render day chapters with photos and transitions. iOS's `DayDetailSheet` is already a chapter page. S1 is re-assembly of shipped components against a working reference design, not a feature programme.
- **CloudKit Production schema is additive-forever, not frozen.** Fields and record types can be added at any time; only removal and retyping are impossible. So "people" needs *no* pre-launch decision — and the permanence argument cuts the other way: a people model designed in a hurry three weeks before submission is what you would be stuck with. **Deferred to v1.1 by decision.**
- **Polarsteps does not leave the competitor set — it becomes competitor #1.** It already sells printed books made from your trip. The reframe converges on their model with a better privacy story; it does not escape them.

One structural gap goes on the §8 risk register rather than into v1.0: **there is no private "hand it to your mother" channel.** The showcase is world-readable behind an explicit consent toggle, CKShare needs an Apple ID and the app, and export is a zip. For v1.0 that is acceptable — a family member installs the free app and views via CKShare (shared-in journeys are already paywall-exempt), Android relatives get the public page — but it is the biggest hole in the thesis, and it is why the free tier now includes finishing and why S1 matters doubly: the story view *is* what a recipient sees.

| ID | Task | Gate |
|---|---|---|
| **S1** | ✅ **Story view — the finished thing.** One journey read top to bottom: cover header (hero, title, dates, country), one chapter per day reusing `DayDetailSheet`'s section stack, photos inline, and **`Camp.notes` rendered prominently** with an inviting empty state for owners ("What happened this day?"). Reachable from `JourneyDetailView` ("Read this journey"), and it becomes what a shared-in viewer lands on. Reference design: the web `JourneyTimeline`. **Why in the beta and not v1.1:** the rewritten phase-2 gate measures *finishing*, which is unmeasurable without a finished thing to look at — and it doubles as the iPad's natural full-screen surface (de-risking part of D2) and as the submission screenshots that actually sell the thesis. ~2–3 days of component re-assembly. | beta |
| **S2** | ✅ **`journeyType` written honestly** — half a day, no UI. The field exists in the CloudKit schema (QUERYABLE) and Core Data (default `"trek"`) and is **hardcoded to `"trek"` in four write paths**: `Persistence/CoreDataMapping.swift:35`, `Sync/RecordCoder.swift:172`, `Sync/PublicMirrorPublisher.swift:131`, `Sync/PersistenceController+Sync.swift:426`. Carry the value on the domain `Journey` and the creation draft instead, default `"trek"`. **Why now:** every journey a beta household creates otherwise fossilises a false value in Production data, and Production fields cannot be retyped. Build nothing on it yet. | beta |
| **S3** | ✅ **The user's own words, made first-class.** `Camp.notes` already exists, syncs and renders well — but it is buried behind Edit → `WaypointEditSheet`. The words are the only thing that distinguishes a book from a slideshow, and today the app treats them as metadata. Give the day sheet and S1's chapters an inline, inviting notes affordance with a prompt-style empty state. Costs almost nothing and ranks **first** on the "actual value" list, above any AI feature. | beta |
| **S4** | **Cabin-diary presentation, inferred not declared.** Do *not* ask the user to pick a taxonomy at creation — C1's whole design is one decision, then review a proposal. Instead infer: no route and ≤3 days ⇒ land on the story view instead of the trek map, drop ascent/summit chrome, keep POIs and weather, and set `journeyType = "diary"` so the field eventually means something. Most of this is already emergent from the honesty work (`isEmptyShell`, `Route.hasElevation`, "—" instead of 0). A separate authoring flow would fork the surface the beta is about to validate. | v1.1 |
| **S5** | **PDF / printable book export** of the story view — the true photo-book-alternative payoff and a fat paid feature. Note that `pdf-data/` at the repo root already holds per-journey PDFs from the web era; something in this project's history produced them, so look there when scoping. | v1.1 |
| **S6** | **Interview-mode drafting.** *Start from what exists:* day-note drafting, grounded fact drafting and day naming already ship — `Akashic/Intelligence/{DayNoteDrafter,FactDrafter,DayNamer,KnowledgeRetrieval,IntelligenceAvailability}.swift`, reachable from `WaypointEditSheet` and `NewJourneySheet`, gated on `Intelligence.isAvailable && entitlements.isComplete`. S6 reframes that flagship from "draft my day note" to "ask, then draft": the model asks two grounded questions ("who came along?", "what surprised you?") and weaves the answers into a draft the user edits. Grounding the questions in what is actually *in* the photo needs **Vision (absent from the codebase today)** and, for the frontier-model variant, **Private Cloud Compute — which is developer-preview-only until production PCC ships with iOS 27 in autumn 2026** (COMMERCIALIZATION-PLAN §10). That is a second reason this is v1.1 and not v1.0. Note the photo grounding slightly weakens the "photos never leave the device" sentence — still nothing we can see, but a different claim. | v1.1 |
| **S7** | **People / companions.** A photo book is full of people; participants exist today for *sharing*, not as who was on the trip. Additive schema, so explicitly deferred to v1.1 and designed calmly rather than in the three weeks before submission. | v1.1 |

### Backlog changes from this round

- **D9 (bundled demo journey): promoted from v1.1 to submission.** Both design reviewers called it the biggest conversion lever; under this thesis it is also the only way a prospect sees a *finished* story before making one, and it is S1's own demo content. Show **both** a trek and a photos-only trip in the demo and the screenshots, so neither audience concludes the app isn't for them.
- **C8 (`CreateJourneyIntent`): demoted from launch to v1.1.** A Siri creation surface serves neither creating-unaided nor finishing.
- **Nothing in the C or D series is busywork** — the backlog survives the reframe intact. The one soft spot is §6's channel list (r/hiking, komoot-adjacents): keep the trekking channels as the wedge, add family and memory-keeping channels where photo-book fatigue is the hook.

### Revised sequencing

```
C2, C3, C4 (shipped) → C5–C7 → S1 + S2 + S3 → external beta (rewritten gate)
                     ↘ D1, D3 (shipped) → D2, D4, D5, D6, D9 → submission
```

S1 is parallelisable with C5–C6 (it touches no creation code). If the date compresses, the existing cut rule still applies first (C5 to a static snapshot, drop C6's GPX-no-waypoints copy); **S1 should not be the casualty — D9 slips back to v1.1 before S1 does.**

**The biggest risk of this repositioning** is that it re-opens product scope three weeks from submission. The book frame seduces toward covers, page layout, print partners, people tagging and AI interviews — all v1.1+. The discipline that keeps it safe: v1.0's delta is exactly S1, S2, S3 and a gate rewrite.

---

## "As if Apple made it" — A-series (added 2026-07-25)

The owner set the bar: **the design should look as if Apple had made it themselves.** That is a specific standard, not a synonym for "beautiful", and the app is closer to it than most indie apps — native components, real MapKit, system materials, sheets with detents, and copy with more restraint than most shipping software. The D-series is largely this work already.

But measured against the things Apple treats as non-negotiable, four gaps are *absences*, not imperfections:

| Signal | Today | Why Apple would not ship it |
|---|---|---|
| **Reduce Motion** | **zero references in the codebase** | The signature surface is an auto-rotating globe with a cinematic fly-in. For a user with vestibular sensitivity that is not a preference, it is nausea. Apple Maps respects the setting; so does every first-party app with motion. |
| **Reduce Transparency / Increase Contrast** | zero | Every pill and overlay is `.ultraThinMaterial`. Apple's own components adapt when these are on; custom ones have to be told. |
| **Haptics** | zero | Apple uses `sensoryFeedback` for meaningful state changes — a day selected, a journey created, a purchase completed. Not decoration: confirmation. |
| **Semantic colours** | zero (8 hardcoded `Color(red:)` in `Theme.swift`) | This is what makes light mode expensive, and it is the structural reason dark-only was chosen. |

| ID | Task | Gate |
|---|---|---|
| **A1** | ✅ **Honour the accessibility display settings** (do this together with A3 — same file, same abstraction point). `@Environment(\.accessibilityReduceMotion)`: stop the globe's idle rotation, replace the fly-in with a cut or a cross-fade, and drop the day-transition camera animation — the destination must always be reachable without motion. `@Environment(\.accessibilityReduceTransparency)`: swap `.ultraThinMaterial` for an opaque `Theme.surface` fill. `@Environment(\.colorSchemeContrast)`: lift `textTertiary`/`textSecondary` toward full white and thicken hairlines when increased contrast is on. **This is an accessibility floor, not polish** — it belongs before submission, and it is the single clearest "Apple would not have done this" finding in the app. Files: `Views/Map/TrekCameraController.swift`, `GlobeExperienceView.swift`, `Views/Theme.swift` (material and colour helpers so the swap happens in one place). **Done when:** with all three settings on, the globe does not move on its own, nothing is translucent, and every label passes contrast — verified in the simulator with Settings → Accessibility. | submission |
| **A2** | **Haptics on meaningful transitions** via `.sensoryFeedback`: day selected (`.selection`), journey created (`.success`), purchase completed (`.success`), a suggestion accepted (`.selection`), a destructive confirm (`.warning`). Nothing on scrolling, nothing decorative. Restraint is the point — Apple's rule is that a haptic confirms something happened, so if it fires when nothing happened it is noise. | submission |
| **A3** | ✅ **DECIDED 2026-07-25 (owner): fit Apple's design language — both appearances.** The earlier "dark-only is deliberate" decision is withdrawn; do not treat it as a constraint. Note what this actually means: Apple's language is mostly *not inventing a palette*. `Theme.swift`'s 8 hardcoded `Color(red:)` become a thin layer over semantic colours (`Color.primary`/`.secondary`, system backgrounds and fills, one brand accent as a tint), so the file gets **smaller**. Remove the app-wide `.preferredColorScheme(.dark)` in `App/AkashicApp.swift`. **The map surfaces stay immersive** — that is not an exception to the language, it is what Apple Maps and the Photos viewer do: bright map, adaptive overlays. Merge with A1: the same abstraction point in `Theme` carries the display-settings adaptation, so doing them separately would touch every colour twice. **Done when:** every screen is legible and deliberate in both appearances with the system toggle, and the map still reads as immersive. Re-shoot store screenshots afterwards (they may still be dark; Apple only requires that they match the shipping app). | submission |
| **A4** | **A "would Apple ship this screen?" review round**, after A1 and D2 land, on the four screens that carry the product: globe, story view, day chapter, paywall. Judge restraint (how many weights and sizes per screen), the four-layer chrome stack at the bottom of trek mode (D8), motion consistency, and the app icon. Run it as a design round, not an implementation task. | submission |

**What this bar does not mean:** copying Apple's look. The globe, the periwinkle accent and the trek-shaped data are the product's own, and the reviewers were right that the copy's honesty is an asset. The bar is about *behaviour under the user's settings*, restraint, and never shipping a surface that ignores a system preference.

---

## Design & HIG — D-series

| ID | Task | Gate |
|---|---|---|
| **D1** | ✅ **Trek-mode chrome: type scale, labels, 44 pt.** In `Views/Map/DayNavigationView.swift`, `GlobeMapComponents.swift`, `GlobeExperienceView.swift` (topBar, journey cards, empty state): replace every `.system(size:)` with semantic styles (`.caption`, `.footnote`, `.subheadline`; `@ScaledMetric` where a pt value must scale), floor nothing below `.caption2`, and cap the overlays with `.dynamicTypeSize(...DynamicTypeSize.xxLarge)` so the map never drowns. Chevrons (32 pt today) and day pills (~29 pt) get ≥44 pt hit areas via `.frame(minWidth:minHeight:)` + `.contentShape`. Add `accessibilityLabel` and traits: "Previous day" / "Next day", "Day 3, Barranco Camp", journey pins named after their journey, camp badges, photo markers. **Done when:** at AX1 the day navigator is readable and un-truncated; VoiceOver completes globe → journey → day → next day; Accessibility Inspector finds no target under 44 pt. **Risk:** overlay growth at huge sizes — the cap handles it. | submission |
| **D2** | ✅ **iPad: regular-width presentation of the signature loop.** Read `horizontalSizeClass` in `GlobeExperienceView`; on `.regular`, present the `DayDetailSheet` content as a leading floating panel (~380–420 pt, Theme surface) over the map instead of a sheet — detents and background interaction don't exist on iPad and a form sheet occludes the map. Constrain `StatsTabView`, `SettingsView`, `PaywallView`, `OnboardingView` to `maxWidth: 640` centred. Check the Journeys list/detail as form sheets. **Done when:** on a 13" iPad, day navigation keeps the map visible and interactive, and the five submission screenshots can be taken without embarrassment. **Risk:** the largest item here — presentation-only, but test dismissal and day-switching state. | submission |
| **D3** | ✅ **Dynamic Type sweep: content sheets.** Same conversion for `Day/DayDetailSheet.swift`, `DayDiscoveriesView.swift`, `FunFactsCarousel.swift`, `WeatherRow.swift`, `Comments/DayCommentsSection.swift`, `Photos/PhotoLightboxView.swift`, `DayPhotoStrip.swift`, `StatsView.swift` (10 pt tracked labels → `.caption2.weight(.medium)`, and lift label colour from `textTertiary` to `textSecondary` for contrast), `JourneyDetailView.swift`, `JourneyListView.swift`. Add labels to the lightbox close/share/edit buttons while there. **Done when:** `.system(size:` count drops from 108 to a handful of justified `@ScaledMetric` cases and every sheet is readable at AX3. **Risk:** low — chip rows already wrap via `StatChipRow`. | submission |
| **D4** | ✅ **Stats journey picker that scales.** In `StatsView.swift`, replace the segmented control (truncating at three journeys today) with a scrolling chip row reusing the globe strip's pill style, or a `Menu` picker above three. Delete the duplicated Total Distance / Duration cells from `journeyStatsSection` — the header chips already say it. **Done when:** eight journeys are all reachable with full names and no number appears twice on the screen. | submission |
| **D5** | **Consumer wording, orientation, submission config.** *(Small Business Program enrolment here now has a second payoff: it is one of the three conditions for free Private Cloud Compute access — see COMMERCIALIZATION-PLAN §10. Request the PCC entitlement while you are in the portal; Apple reviews it, so early is better.)* (a) `SyncStatus.summary` consumer strings: "Off (local store)" → "This device only — iCloud sync is off". (b) Lock **iPhone** to portrait via `INFOPLIST_KEY_UISupportedInterfaceOrientations`, keeping all iPad orientations — cheaper and more honest than QA-ing an untested landscape. (c) Verify in App Store Connect: the IAP is non-consumable with **Family Sharing enabled**, matching `Store/Akashic.storekit`; restore works on a second Apple ID; privacy labels say data not collected. **Done when:** no engineering vocabulary reaches consumer Settings and the ASC config matches the paywall's claims. | submission |
| **D6** | ✅ **Photo-grid duplicate thumbnails — verify, then fix or close.** `screenshot-photo-grid.png` shows identical thumbnails repeated across rows for distinct photos. Reproduce on the current build with real imported data; if it reproduces it is a cache/identity bug in `Photos/PhotosGridView.swift`. **Done when:** a 58-photo day shows 58 distinct thumbnails, or the finding is closed as a stale screenshot with a note here. **RESOLVED 2026-07-25 — reproduced, but not a PhotosGridView bug; closed as a data issue, not code.** Reproduced live: launched with `AKASHIC_IMPORT_ON_LAUNCH=1` against the real recovered export (`/Users/cher/Privat/AkashicExport-20260722`, 1538 real photos, no fixtures), then opened Kilimanjaro Day 1 (58 photos) via the `AKASHIC_SCREEN=photogrid` seam — the same repeated-thumbnail pattern from the screenshot appears today. Root-caused via the Core Data store and the on-disk R2 export: every `Photo` row has its own distinct `id` and its own distinct thumbnail *file* (`Views/Photos/PhotosGridView.swift`'s `GridThumbnail` keys correctly, one file per row — this rules out a cache/identity bug in the view). But hashing those files (MD5) shows the *bytes* repeat: across Kilimanjaro's 939 photo rows, only 449 are unique images — 293 pairs, 20 triples, 52 quadruples, all confirmed by matching `kMDItemContentCreationDate` EXIF capture timestamps down to the second on the duplicate members. `supabase/photos.json` has zero duplicate `url` values, so these are not two rows pointing at one file — they are the *same source photo uploaded more than once*, each upload minted its own UUID and its own R2 copy, back when this data lived in the pre-migration Supabase/web app. The iOS import (`Import/LocalImporter.swift` / `ExportMapper.swift`) faithfully preserves those original Postgres UUIDs (by design, for idempotent re-import) and has no reason to deduplicate — it is reproducing upstream data debt, not introducing it. **No PhotosGridView/Domain.swift change made** — there is no code defect to fix here. Flagged as a follow-up, not undertaken now (out of scope for D6): a content-hash dedup pass, either one-time against the recovered bundle or ongoing at import time in `LocalImporter`, would need a product decision on which duplicate to keep (soonest-imported? highest-resolution original?) and isn't a "few focused hours" fix. | submission |
| **D7** | **Elevation-profile accessibility.** `Charts/InteractiveElevationProfileView.swift`: add `accessibilityChartDescriptor` (audio graph) or per-marker elements announcing "Day 2, 4,150 m, kilometre 18". | v1.1 |
| **D8** | **Trek-mode chrome slimming + palette tidy.** Merge the journey pill and the Overview/Globe row in `DayNavigationView` (title pill gains a trailing globe button) — four stacked bottom layers today, squeezing Maps attribution. Replace cyan text kickers ("8 days", DAY N) with `Theme.accent`, reserving cyan for map geometry. Reconsider `statusBarHidden(true)` on the primary screen — users lose clock and battery on the screen they live in, and Apple Maps doesn't do that. **Done when:** ≤3 stacked bottom layers and the only cyan pixels are on the map. | v1.1 |
| **D9** | ⚠️ **PARTLY SHIPPED 2026-07-26 — the mechanism, not the content. Bundled demo journey** (COMMERCIALIZATION-PLAN §4.2) — one read-only, deletable showcase journey so the empty globe sells the product. Both reviewers rate this the biggest conversion lever on the list. **What is real:** the seeding path exists and is careful — `Persistence/PersistenceController.swift:221` `seedDemoJourneyIfFreshInstall` seeds once ever on a fresh install, re-mints every id (`remapToDemoIdentity`) so the demo cannot collide with the real family archive, respects `AKASHIC_EMPTY=1`, is excluded from the free-tier count (`JourneyStore.swift:429`) and from sync (`SyncSeam.swift:146`), and is badged and honestly worded on delete. **What is not:** it seeds `FixtureLoader.load(named: "kilimanjaro")`, and `apple/Fixtures/recovered/kilimanjaro.json` **has no `photos` key at all** — `Fixtures/FixtureLoader.swift` and `FixtureModels.swift` contain zero occurrences of "photo", so the fixture pipeline has no photo path to fill one. A first launch therefore shows a route, days, stats and day content, and **not one photograph, in a photo-memory app.** As the "biggest conversion lever" this is not yet done: a demo with no photos demonstrates the map, which is the half the free tier already gives away, and not the story, which is what §5's kr 149 is for. Also unmet from the note under "Backlog changes": show **both** a trek and a photos-only trip. **Still needed:** bundle real thumbnail bytes with the demo journey (a handful of days' worth is enough) and a second photos-only sample. Gate moved v1.1 → submission by the 2026-07-25 round; the row's old `v1.1` gate contradicted its own "SHIPPED". | submission |

### What the D1 / D3 ticks do and do not mean (measured 2026-07-26)

Both ticks are **real for the files they name**, and were re-verified rather than
trusted:

- **D1 — done.** Trek-mode chrome carries no `.system(size:)` at all now
  (`DayNavigationView`, `GlobeMapComponents` = 0; `GlobeExperienceView`'s one case is a
  `@ScaledMetric` flag size). The ≥44 pt requirement is met — 21 `minWidth: 44` /
  `minHeight: 44` / `contentShape` sites under `Views/Map/`, including the chevrons
  (`DayNavigationView.swift:213-215`). The overlay cap exists and wraps the day
  navigator (`GlobeExperienceView.swift:528`, `.dynamicTypeSize(...xxLarge)`). Every
  label D1 asked for by name exists: journey pins (`GlobeMapComponents.swift:170`),
  camp badges (`:212`), photo markers (`:259`), the day pill
  (`DayNavigationView.swift:168` — "Day 3, Barranco Camp" verbatim) and the
  previous/next chevrons (`:220`).
- **D3 — done for its named files.** Repo-wide `.system(size:)` is **32**, down from
  108, and the survivors sit almost entirely in files D3 never listed: the widget
  views (9), `Views/Charts/` (7 — that is D7's territory, v1.1), `Views/Edit/` (4),
  plus deliberate display sizes in `OnboardingView`, `RootView`, `PaywallView`,
  `PhotoPlacementSheet` and `JourneyNextSteps`. In the files D3 *did* name the only
  remaining cases are justified `@ScaledMetric` sizes (`WeatherRow` symbol,
  `JourneyDetailView`/`JourneyListView` flags). `@ScaledMetric` now appears in 12
  view files. The lightbox close/share/edit labels D3 asked for are present
  (`PhotoLightboxView.swift:176,186,220`).

**What neither tick claims, and what nobody should read into them:** the app is not
broadly accessible. There are **15 `accessibilityLabel`s against ~218 interactive
sites** across `Akashic/`, and the labels are concentrated exactly where D1 and D3
put them. Measured per directory:

| `Views/` subtree | `accessibilityLabel` | Interactive sites |
|---|---|---|
| `Map/` (D1) | 7 | — |
| `Photos/` (D3) | 3 | 22 |
| `Day/`, `Comments/`, `Showcase/`, root | 5 | — |
| **`Edit/`** | **0** | **59** |
| **`NewJourney/`** | **0** | **25** |
| **`Sharing/`** | **0** | 8 |
| **`Store/`** (paywall) | **0** | 7 |
| **`Export/`** | **0** | 4 |
| **`Route/`** | **0** | 4 |
| **`Story/`** | **0** | 1 |
| **`Charts/`** | **0** | 2 (D7, v1.1) |

So VoiceOver completes the globe → journey → day → next-day path D1 specified, and
falls apart in creation, editing, sharing and the paywall. That is a genuine gap,
it is **not** a regression in D1 or D3, and it is not currently a task on this
list — the only related open item, D7, covers one chart. Route drawing's missing
VoiceOver path is an accepted deviation (see the decisions table); the paywall
and the creation sheet are not, and a screen-reader user cannot currently buy the
product. Worth one task before submission; scoped honestly, it is a labelling
sweep over `Edit/`, `NewJourney/` and `Store/`, not a redesign.

---

## Estimate

**Before the external beta:** C1–C7 — the critical path is C1 → C2.
**Before App Store submission:** D1–D6 and D9, of which D2 (iPad) is the largest
single item. D9's seeding mechanism ships; its *content* does not (no photos) —
see the row.
**v1.1:** C8–C11, D7, D8, S4–S7.

Roughly a week of focused agent work for everything gated at submission, assuming the parallelism in the sequencing diagram above.
