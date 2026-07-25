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
| Dark-only app-wide (`.preferredColorScheme(.dark)`) | **Right call.** On brand, HIG-legal, halves the QA matrix. |
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
| **C1** | **Two-phase sheet: chooser → review.** Restructure `Views/NewJourney/NewJourneySheet.swift` around a `phase` enum (`.chooser`, `.review(origin:)`). Three chooser cards: photos (promoted, opens `PhotosPicker` immediately), GPX (opens `fileImporter`), just-a-name (straight to review). Extract `NewJourneyChooser.swift`. Review renders today's sections reordered — name, route summary, country, dates, days, suggestions — with **no behaviour change yet**. Expose an initialiser that starts in review with a preloaded `GPXFile` (C7 needs it). Draw-on-map is deliberately *not* a chooser card — it stays one tap away in the review screen's Route menu. **Done when:** all three paths reach review and create; cancel works from both phases; existing draft/suggestion tests untouched and green. **Risk:** low — view restructuring over an unchanged model. | beta |
| **C2** | **Ingest photos once.** Stage picked items through the existing `PhotoIngestService.ingest(pickerItem:journeyId:sortOrder:)` keyed to `draft.id` (minted up front precisely for this), deriving EXIF fixes and day clusters from the *same* pass — delete today's discard-the-bytes probe path. Record photo→day assignment during clustering (new sibling of `JourneyDraft.days(fromPhotos:)` returning days + assignments, unit-tested); a deleted proposed day leaves its photos unassigned. On create: `createJourney` → `addIngestedPhotos` with `waypointId` stamped, capped via `EntitlementPolicy.photosAllowed` with `PhotoImportSheet`'s partial-import banner. On cancel/dismiss: delete staged files (`PhotoEditService.deleteFiles`) — copy `PhotoImportSheet`'s cleanup contract exactly. Determinate "Preparing photos… 12 of 42"; Create disabled only while staging. **Done when:** photos-first → create → journey opens with photos on the right days; a test asserts cancel leaves no files under the draft's id; over-cap imports the cap and names the remainder. **Risk:** medium — file lifecycle on cancel/kill. | beta |
| **C3** | **Structural defaults applied, not asked.** Photos-first: apply the `RouteInference` result to `draft.route` directly (drop the `.routeFromPhotos` Accept row), surface `RouteConfidence.summary` verbatim plus a Remove action; a removed route must never re-apply on a suggestion re-run (drive through `SuggestionModel`'s dismissed state; test it). Country: fill `draft.country` from the centroid geocode **only while the field is untouched**, marked "suggested"; user edits always win. Add a name-suggestion chip (*Use "Tanzania, September 2023"*) that applies only on tap and never fires on a non-empty name. **Done when:** unit tests cover remove-route-then-rerun, never-overwrite-typed-country, chip-never-fires-on-non-empty. **Risk:** medium — deliberately amends "nothing applied silently"; the mitigation is that application is visible and reversible. | beta |
| **C4** | **Auto dates + compact row; cut Description.** Derive `dateStarted`/`dateEnded` from photo clusters (first/last `dayKey`) and from GPX waypoint/file times — pure helpers on `JourneyDraft`, unit-tested, **UTC throughout** to match the existing formatters. Replace the two toggle+picker rows with one row: derived range + provenance caption ("from your photos") + Edit; "Add dates" when nothing was derived. **Delete the description section from creation** — it is the classic field that stalls completion, and `JourneyEditSheet` already edits it. **Done when:** date-derivation tests pass; weather suggestions appear for photo-seeded days without the user setting dates (they feed `JourneyDraft.weatherDate`). **Risk:** low. | beta |
| **C5** | **Map preview card + Route options menu.** New `Views/NewJourney/DraftMapCard.swift`: non-interactive `Map` (fall back to `MKMapSnapshotter` if scrolling suffers) with the drafted polyline and day pins, fitted with the existing `MKCoordinateRegion.fitting`. Caption carries the provenance line — inference confidence / GPX points-waypoints / drawn-route elevation note. Menu: *Replace with GPX · Draw on map · Remove route*, the drawing sheet keeping its apply-on-dismissal discipline. This card is the magic moment: the user's trip appearing on a map, and the honest review of the inference, in one object. **Done when:** all three provenances render; day pins track day deletion; Remove clears route and stats. **Risk:** medium — live `Map` inside a scrolling form. | beta |
| **C6** | **Partial-failure states.** Photos with dates but no GPS → map card empty state, *"Your photos carry dates but no locations, so days were proposed without a route"* + inline **Import GPX · Draw on map · Skip**. No readable dates → photos attach unassigned, days built later. GPX with track but no waypoints → *"This file had no waypoints, so no days were proposed"*. Malformed GPX → existing typed `GPXParseError` where the import started. Sweep every creation caption for the new model — delete "Add the actual photos after creating the journey". **Done when:** four simulator fixtures (geotagged, dateless, trackpoint-only, malformed) each show their state and every one still reaches Create. **Risk:** low. | beta |
| **C7** | **Register as a GPX document handler.** `project.yml`: `CFBundleDocumentTypes` importing `com.topografix.gpx` (Viewer), `UTImportedTypeDeclarations` (extension `gpx`, conforms to `public.xml` — it is not a system UTI), `LSSupportsOpeningDocumentsInPlace: NO`. Sharp edge: `GENERATE_INFOPLIST_FILE: YES` means these need XcodeGen `info.properties` — **verify the generated plist carries them in `Release-CloudKit`, not just Debug.** In `AkashicApp.swift`: `onOpenURL` → security-scoped read → `GPXParser.parse` off-main → present the sheet in review phase (C1's initialiser) with the name pre-filled from `<name>`; journey-limit paywall gate first; parse errors in an alert. v1 always creates a *new* journey. **Why before the beta:** the current path (Strava → Files → app → sheet → Route → Import → find file) is exactly where a non-technical user fails unaided. **Done when:** sharing a `.gpx` from Files and from Mail offers Akashic and lands in review with the route drawn; malformed alerts without presenting. **Risk:** medium — plist generation. | beta |
| **C8** | **`CreateJourneyIntent`.** First *writing* App Intent: `(name, country?)` → minimal draft → `JourneyStore.createJourney` → open the app to it (the next-steps card is a coherent handoff). Enforce the free-tier limit with a friendly thrown `AkashicIntentError`; same JSON contract as the read intents; EN + NO phrases in `AkashicShortcuts.swift`. Deliberately post-beta: it cannot move the gate (families won't discover Siri first) and it adds a second creation surface during the UI's churniest week. **Risk:** low. Keep it name-only. | launch |
| **C9** | **Days from timestamped GPX trackpoints** when a track has no waypoints: cluster by UTC `dayKey`, one day per calendar day, coordinate = last trackpoint of the day. Requires `GPXParser` to retain per-point times (dropped today). **Risk:** medium — parser memory shape on big tracks. | v1.1 |
| **C10** | **Default hero photo** from the ingested set on create, user-overridable. **Verify first** whether the UI already falls back to the photo grid; close as no-op if so. | v1.1 |

---

## Design & HIG — D-series

| ID | Task | Gate |
|---|---|---|
| **D1** | **Trek-mode chrome: type scale, labels, 44 pt.** In `Views/Map/DayNavigationView.swift`, `GlobeMapComponents.swift`, `GlobeExperienceView.swift` (topBar, journey cards, empty state): replace every `.system(size:)` with semantic styles (`.caption`, `.footnote`, `.subheadline`; `@ScaledMetric` where a pt value must scale), floor nothing below `.caption2`, and cap the overlays with `.dynamicTypeSize(...DynamicTypeSize.xxLarge)` so the map never drowns. Chevrons (32 pt today) and day pills (~29 pt) get ≥44 pt hit areas via `.frame(minWidth:minHeight:)` + `.contentShape`. Add `accessibilityLabel` and traits: "Previous day" / "Next day", "Day 3, Barranco Camp", journey pins named after their journey, camp badges, photo markers. **Done when:** at AX1 the day navigator is readable and un-truncated; VoiceOver completes globe → journey → day → next day; Accessibility Inspector finds no target under 44 pt. **Risk:** overlay growth at huge sizes — the cap handles it. | submission |
| **D2** | **iPad: regular-width presentation of the signature loop.** Read `horizontalSizeClass` in `GlobeExperienceView`; on `.regular`, present the `DayDetailSheet` content as a leading floating panel (~380–420 pt, Theme surface) over the map instead of a sheet — detents and background interaction don't exist on iPad and a form sheet occludes the map. Constrain `StatsTabView`, `SettingsView`, `PaywallView`, `OnboardingView` to `maxWidth: 640` centred. Check the Journeys list/detail as form sheets. **Done when:** on a 13" iPad, day navigation keeps the map visible and interactive, and the five submission screenshots can be taken without embarrassment. **Risk:** the largest item here — presentation-only, but test dismissal and day-switching state. | submission |
| **D3** | **Dynamic Type sweep: content sheets.** Same conversion for `Day/DayDetailSheet.swift`, `DayDiscoveriesView.swift`, `FunFactsCarousel.swift`, `WeatherRow.swift`, `Comments/DayCommentsSection.swift`, `Photos/PhotoLightboxView.swift`, `DayPhotoStrip.swift`, `StatsView.swift` (10 pt tracked labels → `.caption2.weight(.medium)`, and lift label colour from `textTertiary` to `textSecondary` for contrast), `JourneyDetailView.swift`, `JourneyListView.swift`. Add labels to the lightbox close/share/edit buttons while there. **Done when:** `.system(size:` count drops from 108 to a handful of justified `@ScaledMetric` cases and every sheet is readable at AX3. **Risk:** low — chip rows already wrap via `StatChipRow`. | submission |
| **D4** | **Stats journey picker that scales.** In `StatsView.swift`, replace the segmented control (truncating at three journeys today) with a scrolling chip row reusing the globe strip's pill style, or a `Menu` picker above three. Delete the duplicated Total Distance / Duration cells from `journeyStatsSection` — the header chips already say it. **Done when:** eight journeys are all reachable with full names and no number appears twice on the screen. | submission |
| **D5** | **Consumer wording, orientation, submission config.** (a) `SyncStatus.summary` consumer strings: "Off (local store)" → "This device only — iCloud sync is off". (b) Lock **iPhone** to portrait via `INFOPLIST_KEY_UISupportedInterfaceOrientations`, keeping all iPad orientations — cheaper and more honest than QA-ing an untested landscape. (c) Verify in App Store Connect: the IAP is non-consumable with **Family Sharing enabled**, matching `Store/Akashic.storekit`; restore works on a second Apple ID; privacy labels say data not collected. **Done when:** no engineering vocabulary reaches consumer Settings and the ASC config matches the paywall's claims. | submission |
| **D6** | **Photo-grid duplicate thumbnails — verify, then fix or close.** `screenshot-photo-grid.png` shows identical thumbnails repeated across rows for distinct photos. Reproduce on the current build with real imported data; if it reproduces it is a cache/identity bug in `Photos/PhotosGridView.swift`. **Done when:** a 58-photo day shows 58 distinct thumbnails, or the finding is closed as a stale screenshot with a note here. | submission |
| **D7** | **Elevation-profile accessibility.** `Charts/InteractiveElevationProfileView.swift`: add `accessibilityChartDescriptor` (audio graph) or per-marker elements announcing "Day 2, 4,150 m, kilometre 18". | v1.1 |
| **D8** | **Trek-mode chrome slimming + palette tidy.** Merge the journey pill and the Overview/Globe row in `DayNavigationView` (title pill gains a trailing globe button) — four stacked bottom layers today, squeezing Maps attribution. Replace cyan text kickers ("8 days", DAY N) with `Theme.accent`, reserving cyan for map geometry. Reconsider `statusBarHidden(true)` on the primary screen — users lose clock and battery on the screen they live in, and Apple Maps doesn't do that. **Done when:** ≤3 stacked bottom layers and the only cyan pixels are on the map. | v1.1 |
| **D9** | **Bundled demo journey** (COMMERCIALIZATION-PLAN §4.2) — one read-only, deletable showcase journey so the empty globe sells the product. Both reviewers rate this the biggest conversion lever on the list; it is v1.1 only because the plan already tracks it and creation now works. | v1.1 |

---

## Estimate

**Before the external beta:** C1–C7 — the critical path is C1 → C2.
**Before App Store submission:** D1–D6, of which D2 (iPad) is the largest single item.
**v1.1:** C8–C10, D7–D9.

Roughly a week of focused agent work for everything gated at submission, assuming the parallelism in the sequencing diagram above.
