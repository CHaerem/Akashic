<!-- GENERATED FILE — do not edit.
     Source of truth: docs/workplan/tasks.json
     Regenerate:      npm run workplan:render
     CI fails if this file and the ledger disagree. -->

# Akashic — work ledger

184 tasks · **57 open** (32 agent-doable, 18.7 dev-days · 25 owner-only, 10.6 dev-days) · 127 done · 0 dropped

> **`dev-days` are a human-developer estimate, not agent time.** They came from the review
> that produced these tasks and they are the right unit for deciding whether something is
> worth doing — they are the wrong unit for predicting how long an agent will take, and
> summing them as "work remaining" overstates it substantially.
>
> Measured so far: **121 agent tasks estimated at 78.4 dev-days**.
> Elapsed time is deliberately absent: nothing here can support it. Use `git log` for that.
>
> 9 of the closed tasks were 2 dev-days or more, and 7.5 of the 18.7 remaining dev-days still sit in 3 such task(s): DIFF-18, DIFF-19, DIFF-20. Those turn on design judgement rather than localised edits, so do not assume the compression above holds.

Read [CLAUDE.md](CLAUDE.md) before touching anything. To find work:

```bash
node scripts/workplan.mjs next
```

## In flight

| Task | Agent | Branch | Stopped at |
|---|---|---|---|
| `DIFF-16` DIFF-15 on a real device: the prompt worked, the rows did not — and the failure is undiagnosable by design | diff16-agent | `agent/diff16` | Root-cause fix merged at 65b1c5d: fireTransition(from:) at all three policy mutation sites, became-false delivered via observer self-registration on the gate seam (PersistenceController wiring not needed), and the guard that makes it real — the in-flight fetch's success path no longer overwrites the honest deferral. 903 unit tests; prove receipt 16 assertion-reds in 5/7 against HEAD. Remaining: the owner's cellular observation on build 103, and the owner's 5G-data-mode product call (gate on literal WiFi vs reword the toggle). |

## LEGACY

> Retire Supabase, Cloudflare and R2. Repo-side removal can happen now; the infrastructure deletions are gated on the archive being duplicated and on the Pages cutover. LEG-01 is independent of every gate and should happen today.

8 open of 20 · 2.4 d remaining

| | Task | Days | Who | Deps | Finish line |
|---|---|---|---|---|---|
| `x` | `LEG-01` **Delete the akashic-media Cloudflare Worker** | 0.5 | owner | — | The endpoint returns no response, and SUPABASE_SERVICE_KEY no longer exists in any Worker env. |
| ` ` | `LEG-02` **Copy the 16 GiB export archive to a second physical medium** | 0.5 | owner | — | 8147 objects and the six table sha256s verify on a second volume that is not the boot disk. |
| ` ` | `LEG-03` **Decide the fate of the 5080 un-catalogued R2 objects (12.21 GB)** | 0.5 | owner | `LEG-02` | A written decision exists: keep in the archive forever, or discard deliberately. |
| ` ` | `LEG-04` **Run the T5.1 delta check against live Supabase** | 0.5 | owner | `LEG-02` | Row counts and max(updated_at) per table match manifest.json, or the delta is exported and merged. |
| `x` | `LEG-05` **Rewire src/lib/media.ts off the Worker** | 0.5 | agent | — | No source file resolves media through the workers.dev host, and web tests stay green. |
| `x` | `LEG-06` **Delete the unrunnable legacy scripts and the AWS SDK dependency** | 0.5 | agent | — | npm run build and vitest pass with the dead scripts and @aws-sdk/client-s3 gone. |
| `x` | `LEG-07` **Gate every native-only web write behind one guard** | 1 | agent | — | No web UI offers a write that silently no-ops; each either disappears or shows a native-only notice. |
| `x` | `LEG-08` **Remove the hardcoded /Users/cher archive path from shipping code** | 0.25 | agent | — | No absolute developer path appears in any non-test Swift file. |
| `x` | `LEG-09` **Execute the GitHub Pages + DNS cutover (T4.2, T4.3)** | 0.5 | owner | `SHIP-10A` | https://akashic.no serves the production build from GitHub Pages with a valid certificate for the domain, and privacy/terms/support/AASA resolve over HTTPS. |
| `x` | `LEG-10A` **Take Cloudflare and Supabase out of the repo** | 0.25 | agent | `LEG-09` | No workflow references Cloudflare or Supabase, and CI is green without their secrets. |
| ` ` | `LEG-10B` **Delete the four dead repository secrets, then revoke the tokens themselves** | 0.2 | owner | `LEG-10A` | gh secret list shows neither CLOUDFLARE_* nor VITE_SUPABASE_*, and both tokens are revoked at Cloudflare and Supabase. |
| ` ` | `LEG-11A` **Delete the Cloudflare Pages project and the DNS zone** | 0.25 | owner | `LEG-09` `LEG-10A` | The akashic Pages project and the Cloudflare DNS zone are gone from the dashboard, and akashic.no still resolves via GoDaddy to GitHub Pages. |
| ` ` | `LEG-11B` **Delete the R2 bucket, Supabase project and Google OAuth config** | 0.25 | owner | `LEG-03` `LEG-04` | All three are gone from their dashboards AND the archive has been verified on a second physical medium. |
| `x` | `LEG-12` **Delete workers/ from the repo** | 0.25 | agent | `LEG-01` `LEG-05` | workers/ is gone and no workflow or test references it. |
| ` ` | `LEG-13` **Delete supabase/** | 0.1 | agent | `LEG-04` | supabase/ is gone from the repo. |
| `x` | `LEG-14` **Remove the dead 'build-deploy' required status check from main** | 0.1 | agent | — | main's required status checks are exactly the three that can still report, and a test PR is mergeable. |
| `x` | `LEG-15` **Delete the dead Mapbox Map Matching wrapper** | 0.1 | agent | — | src/lib/mapMatching.ts is gone and nothing references api.mapbox.com/matching. |
| `x` | `LEG-16` **Delete public/textures — 3.8 MB of unattributed dead imagery** | 0.1 | agent | — | public/textures is gone and dist/ no longer ships it. |
| `x` | `LEG-17` **Self-host the fonts — Google Fonts is a third external origin** | 0.25 | agent | — | No request to fonts.googleapis.com or fonts.gstatic.com from the deployed page, and the two service-worker rules for them are gone. |
| ` ` | `LEG-18` **Revoke the Mapbox account key** | 0.1 | owner | `MAP-05` | The Mapbox public key is revoked in the Mapbox account. |

## DOCS

> Make the documentation true. Cheap, high-value, and it is what stops the next agent inheriting a false picture.

0 open of 19 · 0 d remaining

| | Task | Days | Who | Deps | Finish line |
|---|---|---|---|---|---|
| `x` | `DOC-01` **CLAUDE.md — the protocol every session loads** | 0.5 | agent | — | A fresh agent can find the ledger, build the app and run the right verification without asking. |
| `x` | `DOC-02` **The work ledger and its enforcement** | 1 | agent | — | npm run workplan:check passes and fails loudly when the ledger and WORKPLAN.md disagree. |
| `x` | `DOC-03` **Rewrite ARCHITECTURE.md** | 0.5 | agent | — | No document describes Supabase, R2 or the Worker as active infrastructure, and every link in ARCHITECTURE.md resolves. |
| `x` | `DOC-04` **Correct the cost table: public-database egress is billed to the developer** | 0.5 | agent | — | The cost table distinguishes the owner's iCloud quota from the developer-billed public database. |
| `x` | `DOC-05` **Fix the test-count claims that disagree with each other** | 0.25 | agent | — | Every stated test count matches a command anyone can run. |
| `x` | `DOC-06` **Record that Akashic Intelligence already ships** | 0.25 | agent | — | No document schedules as v1.1 a feature that is wired to real UI today. |
| `x` | `DOC-07` **Add the PCC timing caveat: production PCC ships with iOS 27** | 0.1 | agent | — | The Apple Intelligence section states that PCC cannot be in v1.0. |
| `x` | `DOC-08` **Fix store copy that advertises a paywall the code does not implement** | 0.25 | agent | — | No store or IAP copy claims Complete unlocks publishing or export. |
| `x` | `DOC-09` **Fix the Entitlements.swift comments that contradict the same file's header** | 0.1 | agent | — | The enum comments and the file header describe the same paywall. |
| `x` | `DOC-10` **Remove the false 'exhaustively unit-tested' claim from KnowledgeRetrieval.swift** | 0.1 | agent | — | No doc comment claims test coverage that does not exist. |
| `x` | `DOC-11` **Archive ROADMAP.md and delete PLAN.md** | 0.25 | agent | — | No unmarked stale planning document remains at the repo root. |
| `x` | `DOC-12` **Correct the DESIGN-PLAN ticks that code does not support** | 0.25 | agent | — | No design item is marked shipped unless code supports it. |
| `x` | `DOC-13` **Audit every claim in README.md** | 0.25 | agent | — | Every feature and tech-stack claim in the README is true of the current build. |
| `x` | `DOC-14` **Fix github-pages-cutover.md drift before the owner follows it** | 0.1 | agent | — | Every instruction in the cutover runbook is still executable as written. |
| `x` | `DOC-15` **Fix the FactDrafter comment that misattributes where the entitlement gate lives** | 0.1 | agent | — | No comment claims Intelligence.isAvailable performs an entitlement check. |
| `x` | `DOC-16` **Say what each import figure counts in APPLE-MIGRATION-TASKS** | 0.1 | agent | — | Both import figures state what they count, so neither reads as contradicting the other. |
| `x` | `DOC-17` **apple/README.md still calls the app icon a placeholder** | 0.1 | agent | `QUA-19` | No document describes the app icon as a placeholder. |
| `x` | `DOC-18` **apple/README.md describes shipped work as future, and one claim is flatly false** | 0.5 | agent | — | Every claim in apple/README.md is true of the tree, and its layout tables list what exists. |
| `x` | `DOC-19` **Explain or delete apple/Fixtures/recovered/photoMetadata.json** | 0.1 | agent | — | The file is gone, or a comment says what reads it. |

## SHIP

> Hard requirements for a paid v1.0. Most of the remaining calendar time lives here, in items only the owner can do.

14 open of 27 · 7 d remaining

| | Task | Days | Who | Deps | Finish line |
|---|---|---|---|---|---|
| `x` | `SHIP-01` **Move the two dropped Info.plist keys into info.properties** | 0.25 | agent | — | The built Release-CloudKit Info.plist contains CKSharingSupported and UIBackgroundModes. |
| `x` | `SHIP-02` **Register for remote notifications — the missing half of push sync** | 0.5 | agent | `SHIP-01` | The app calls registerForRemoteNotifications and a device receives a CloudKit push. |
| `x` | `SHIP-03` **Produce the 12 App Store screenshots** | 1.5 | agent | `SHIP-06` `QUA-06` | Twelve assets exist at the two required sizes and are committed under docs/store/screenshots/. |
| `x` | `SHIP-04` **Add PrivacyInfo.xcprivacy** | 0.25 | agent | — | The manifest ships in the app bundle and the upload draws no ITMS-91053 notice. |
| `x` | `SHIP-05` **Bump the marketing version to 1.0.0** | 0.1 | agent | — | The built plist reports CFBundleShortVersionString 1.0.0. |
| `x` | `SHIP-06` **D5 — consumer sync wording, iPhone portrait lock, ASC config match** | 0.5 | agent | — | Settings shows no engineering strings and iPhone does not rotate into the iPad panel layout. |
| `x` | `SHIP-07` **Add the associated-domains entitlement so Universal Links work** | 0.25 | agent | `LEG-09` | Tapping an akashic.no journey link opens the app rather than Safari. |
| `x` | `SHIP-08` **Write the public-showcase takedown procedure** | 0.5 | agent | `DIFF-02` | A documented, tested procedure removes a reported public journey, and the privacy page says how to ask. |
| `x` | `SHIP-09` **Compile the developer workshop out of Release** | 0.25 | agent | — | No developer surface is reachable in a Release build, and the seven-tap gesture is gone. |
| `x` | `SHIP-10A` **Point the deployed showcase at the CloudKit PRODUCTION environment** | 0.25 | owner | — | The deployed bundle carries environment:"production" and a PublicJourney query returns without an auth error. |
| `x` | `SHIP-10B` **Publish one journey into the production mirror and see it signed out** | 0.25 | owner | `SHIP-10A` | A published journey is visible on akashic.no while signed out. |
| ` ` | `SHIP-11` **Trademark and name clearance for 'Akashic'** | 0.5 | owner | — | A written go/no-go exists from Patentstyret and EUIPO in the software class. |
| ` ` | `SHIP-12` **Paid Applications agreement, banking and tax forms** | 0.5 | owner | — | App Store Connect reports the Paid Applications agreement as active. |
| ` ` | `SHIP-13` **Create the IAP, join Small Business Program, declare EU trader status** | 0.5 | owner | `DOC-08` `SHIP-12` | no.akashic.app.complete exists at kr 149 with Family Sharing on, and trader status is submitted. |
| ` ` | `SHIP-14` **Enter ASC metadata, App Privacy, review notes and the icon** | 0.5 | owner | `DOC-08` `SHIP-03` `QUA-09` | The version is complete in App Store Connect except for the build. |
| ` ` | `SHIP-15` **Real-device smoke test on two Apple IDs** | 2 | owner | `SHIP-01` `SHIP-02` | A share invitation opens in-app, and an edit on device A appears on device B without foregrounding. |
| ` ` | `SHIP-16` **TestFlight: internal family, then the external beta group** | 0.5 | owner | `SHIP-15` | An external group of ~10 households is running a build with test notes. |
| ` ` | `SHIP-17` **The external beta gate** | 0 | owner | `SHIP-16` `SHIP-03` | At least 7 of 10 households create a journey unaided and 5 finish and hand one over. |
| ` ` | `SHIP-18` **Submit for review with a rejection buffer** | 0.5 | owner | `SHIP-17` `SHIP-14` | The app is approved and held for manual release. |
| ` ` | `SHIP-19` **Day-one support readiness** | 0.5 | owner | `SHIP-18` | support@akashic.no is monitored with a real FAQ, and crash reports are checked daily for week one. |
| ` ` | `SHIP-20` **Any iCloud user can write to the public showcase — decide the defence before launch** | 0.5 | owner | — | Either the showcase renders only records the owner created, or the CloudKit JS token is proven read-only, or the risk is recorded as accepted next to SHIP-08. |
| ` ` | `SHIP-21` **Request the Private Cloud Compute entitlement — it is a review, not a toggle** | 0.1 | owner | — | The entitlement request is submitted to Apple. |
| ` ` | `SHIP-22` **Recruit the ten beta households — the longest lead time nobody owned** | 0.5 | owner | — | A written list of at least ten households who have agreed, with names and a start date. |
| ` ` | `SHIP-23` **Nominate the app for Apple featuring, and treat it as launch strategy rather than a lottery ticket** | 0.2 | owner | — | A featuring nomination is submitted in App Store Connect. |
| `x` | `SHIP-24` **Universal Links are dead in production — the Pages artifact carries no dot-path at all** | 0.3 | agent | — | https://akashic.no/.well-known/apple-app-site-association returns 200 with an applinks document, and the deploy asserts it after every push so it cannot silently regress. |
| ` ` | `SHIP-25` **Rotate the MapKit key that passed through a chat upload** | 0.2 | owner | — | A second Maps key is registered, MAPKIT_PRIVATE_KEY holds it, the Credential health check is green on main, and key 9UN97VBZR8 shows as revoked in the Apple Developer account. |
| `x` | `SHIP-26` **CD for the iOS app: a TestFlight upload is one click, gated on green CI** | 0.5 | owner | — | The owner can ship a TestFlight build from Actions -> TestFlight -> Run workflow, the upload refuses a commit whose apple-ci is not green, and the first dispatched run has produced a build visible in TestFlight. |

## DIFF

> Capability beyond what competitors offer. Order set by decision: share link, then Vision curation, then the book.

8 open of 22 · 12 d remaining

| | Task | Days | Who | Deps | Finish line |
|---|---|---|---|---|---|
| `x` | `DIFF-01` **Fix the unpublish leak: thumbnails that can never be removed** | 0.5 | agent | — | Unpublishing always removes the mirror, and a failure to remove reports as a failure. |
| `x` | `DIFF-02` **Give the owner a shareable showcase link** | 1 | agent | `DIFF-01` | Publishing yields a working URL the owner can share, correct under slug disambiguation. |
| `x` | `DIFF-03` **Add og: metadata so a shared link renders as a card** | 0.5 | agent | `DIFF-02` | A showcase URL pasted into iMessage, WhatsApp and Slack renders a title, description and image. |
| `x` | `DIFF-04` **On-device photo curation with Vision — the engine** | 2 | agent | — | Curation runs on real photos and proposes a hero and a per-day best-of, covered by tests. |
| `x` | `DIFF-05` **Feed Vision labels into DayNoteDrafter** | 1 | agent | `DIFF-04` | A drafted day note references what is actually in the photos. |
| `x` | `DIFF-06` **Report a journey's duplicate photographs** | 0.5 | agent | `DIFF-04` | A journey can report its unique-image count and which rows are redundant. |
| `x` | `DIFF-07` **PDF export of the story view** | 6 | agent | `DIFF-04` `DIFF-06` | A journey exports a PDF a person would willingly hand over. |
| `x` | `DIFF-08` **Foundation Models depth: streaming, prewarm, typed errors** | 1.5 | agent | `QUA-05` | Drafting streams, sessions are reused, and guardrail refusals say something specific. |
| `x` | `DIFF-09` **C9 — derive days from timestamped GPX trackpoints** | 1 | agent | — | A Strava or Garmin export yields a journey with correctly dated days. |
| `x` | `DIFF-10` **Give the demo journey photographs** | 1.5 | agent | — | A first launch shows a journey with real photographs, and a photos-only trip is demoed too. |
| `x` | `DIFF-11` **Wire GPX day derivation into the creation flow** | 0.25 | agent | `DIFF-09` | Importing a timestamped GPX yields a journey with correctly dated days, not zero. |
| ` ` | `DIFF-12` **Decide what photographs the demo journey ships with** | 0.5 | owner | `DIFF-10` | A decision is recorded, and the shipped demo images are the ones intended. |
| `x` | `DIFF-13` **Accept/dismiss rows for curation, and make Vision link** | 1 | agent | `DIFF-04` | Each day proposes a best-of and a hero the user can accept or dismiss, and Vision links into the build. |
| `x` | `DIFF-14` **Collapse duplicates on import, which needs a stored content hash** | 1 | agent | `DIFF-06` | Re-importing a byte-identical photograph is detected and skipped, not written twice. |
| `x` | `DIFF-15` **On cellular, a fresh install shows "Start your first journey" while the whole archive waits silently** | 1 | agent | — | A fresh install on a metered connection shows the family's journeys as named, visibly un-downloaded rows with an honest size and a "Download now" action — instead of the first-run hero — and the first-sync estimate matches what the engine actually fetches. |
| `~` | `DIFF-16` **DIFF-15 on a real device: the prompt worked, the rows did not — and the failure is undiagnosable by design** | 1 | agent | — | The un-downloaded journeys surface renders on a real device against Production (or its failure is visible and diagnosable from the device), sync/download progress is visible in the journey list, and a TestFlight build can produce a sync log the owner can read. |
| ` ` | `DIFF-17` **One sync card, one truth: the sync story becomes a single composed value with five states** | 1.5 | agent | — | The journey list carries ONE sync card driven by one pure decision function; Settings keeps only the toggle and a last-synced line; the first-sync sheet is retired; no two surfaces can disagree by construction; and a first sync on ANY network shows real "N of M photos" progress. |
| ` ` | `DIFF-18` **'Play journey': an animated day-by-day trip replay over MapKit's real 3D terrain** | 2.5 | agent | `QUA-66` `QUA-83` | A replay mode chains day fly-ins automatically (camera flight → dwell with the day's photos surfacing → advance), with pause-on-touch, a scrubber built from the day pill strip, and a Reduce Motion step-through fallback; the sequencing lives in a pure, unit-tested replay-sequencer model; entering and leaving replay never leaves the camera controller in a stuck state. |
| ` ` | `DIFF-19` **Flyover video export: render the replay to a shareable 20–30 s vertical video** | 3 | agent | `DIFF-18` | A journey can be exported as a vertical video (choreographed map flyover interleaved with curated hero photos, AVAssetWriter over offscreen map rendering) and handed to the share sheet; the export survives Reduce Motion (cuts instead of flights) and reports progress; the file carries no tokens or private data beyond what the user chose to show. |
| ` ` | `DIFF-20` **Trip detection from the photo library: 'Looks like a trip — create this journey?'** | 2 | agent | — | With limited photo-library authorization, Akashic scans asset dates/locations, detects away-from-home clusters, and offers one-tap journey creation ('Lofoten, 12–19 July, 412 photos'); detection is a pure, unit-tested function over asset metadata; the prompt appears only when a plausible trip exists and never nags. |
| ` ` | `DIFF-21` **Polarsteps-export importer: turn the market's loudest lock-in complaint into a switching funnel** | 1 | agent | — | Akashic imports a Polarsteps data-export ZIP (trips, steps, photos with dates/locations) into journeys/days/photos through the existing ImportSink machinery; a fixture ZIP round-trips in tests; 'bring your old trips with you' appears in the creation chooser when a Polarsteps export is picked. |
| ` ` | `DIFF-22` **Print-shop-honest PDF: the book's 1400 px image cap yields ~170 dpi on the A4 page its own header promises to a print shop** | 0.5 | agent | `QUA-77` | The PDF export offers (or defaults to) print-quality output targeting ~300 dpi for full-width images, with incremental page rendering bounding memory; the header's 'handed to a print shop' claim matches the artefact; a test asserts the effective dpi of a full-width image. |

## QUALITY

> Tests, types, CI, localisation, accessibility. Localisation and accessibility are in v1.0 by decision.

27 open of 96 · 7.9 d remaining

| | Task | Days | Who | Deps | Finish line |
|---|---|---|---|---|---|
| `x` | `QUA-01` **Make CI build and test the configurations that actually ship** | 0.5 | agent | `SHIP-01` | CI builds Release and Release-CloudKit and asserts the two Info.plist keys are present. |
| `x` | `QUA-02` **Make the lint and typecheck gates real for the code that ships** | 1.5 | agent | `LEG-07` | ESLint inspects src/, and a type error fails CI rather than being swallowed. |
| `x` | `QUA-03` **Clear the red Security Audit job** | 0.5 | agent | — | npm audit --audit-level=high exits 0, or the exception is documented and time-boxed. |
| `x` | `QUA-04` **Repair or delete the Performance Tests workflow** | 0.25 | agent | — | No workflow references a spec file that does not exist. |
| `x` | `QUA-05` **Add a compile tripwire for the Foundation Models code** | 0.5 | agent | — | CI fails if the Intelligence code stops compiling. |
| `x` | `QUA-06` **Localise the app to Norwegian** | 4 | agent | — | Every user-visible string comes from a string catalogue, and the app runs in NB end to end. |
| `x` | `QUA-07` **Bring accessibility to a shippable standard** | 3 | agent | `QUA-06` | Every interactive control has a label, and the photo grid and elevation chart are navigable by VoiceOver. |
| `x` | `QUA-08` **Turn on Swift 6 strict concurrency** | 3 | agent | — | The project builds clean under SWIFT_STRICT_CONCURRENCY=complete. |
| `x` | `QUA-09` **Light up the widget or remove it from v1.0** | 0.5 | agent | — | The widget shows the customer's own journey, or it does not ship. |
| `x` | `QUA-10` **First tests for Views/, and a UI test target** | 3 | agent | `QUA-01` | A UI test target exists and the create-journey flow has an automated test. |
| `x` | `QUA-11` **Handle a full iCloud account** | 0.5 | agent | — | A quota-exceeded sync failure is visible in the UI and says what to do. |
| `x` | `QUA-12` **Tests for KnowledgeRetrieval, and fix its two real defects** | 1.5 | agent | `DOC-10` | The retrieval path has tests, including the cross-project de-dup and empty-coordinate cases. |
| `x` | `QUA-13` **Stop video import loading whole files into memory** | 0.5 | agent | — | Importing a multi-minute 4K video does not jetsam the app. |
| `x` | `QUA-14` **Name the shortfall when photo ingest partly fails** | 0.25 | agent | — | A creation flow that ingests fewer photos than picked says so. |
| `x` | `QUA-15` **Add an 'entitlement undetermined' state** | 0.5 | agent | — | A paying customer is never shown the free-tier wall while StoreKit is still resolving. |
| `x` | `QUA-16` **Make the 100-photo cap a limit, not a failure** | 0.5 | agent | — | The cap is visible before ingest work starts, not reported after it. |
| `x` | `QUA-17` **Sell what the purchase actually unlocks** | 0.5 | agent | — | The paywall lists all four unlocked capabilities and carries the price anchor. |
| `x` | `QUA-18` **A2 — haptics on meaningful transitions** | 0.5 | agent | — | The five named moments produce sensory feedback. |
| `x` | `QUA-19` **Redraw the app icon** | 0.5 | agent | — | The icon is legible at 60 pt and works in light, dark and tinted appearances. |
| `x` | `QUA-20` **A4 — the 'would Apple ship this screen?' review round** | 1 | agent | `QUA-07` `QUA-18` `QUA-19` | Each primary screen has been reviewed against current HIG and the findings closed or recorded. |
| `x` | `QUA-21` **Redraw the web and PWA icons — same illegibility, plus transparency** | 0.25 | agent | — | Every derived web icon is opaque and its mark clears 4.5:1 against its own ground. |
| `x` | `QUA-22` **Make the paywall list what the purchase now advertises** | 0.5 | agent | `DOC-08` | EntitlementPolicy, the paywall benefit list and the IAP description all name the same set. |
| `x` | `QUA-23` **Remove the dead tab state from useTrekData** | 0.25 | agent | — | No hook exposes state nothing renders, and its tests reflect that. |
| `x` | `QUA-24` **Accessibility for the screens D1 and D3 were never scoped to cover** | 2 | agent | `QUA-06` | No view directory with interactive controls sits at zero accessibility labels. |
| `x` | `QUA-25` **Bound public-showcase reads before traffic arrives** | 1 | agent | — | A published journey has a size bound, and crossing a usage threshold is visible to the owner. |
| `x` | `QUA-26` **Localise the user-visible strings outside Views/** | 0.5 | agent | `QUA-06` | No user-visible string reaches the screen in English when the app runs in Norwegian. |
| `x` | `QUA-27` **Two localisation gaps the screenshot pass surfaced but would not decide** | 0.25 | agent | — | No user-visible string is marked do-not-translate by accident, and the String-position trap is gone from the import sheets. |
| `x` | `QUA-28` **Accessibility for Views/Photos, the one directory still at zero** | 0.5 | agent | `QUA-24` | No interactive control in Views/Photos is unlabelled. |
| `x` | `QUA-29` **A UI test target, so the accessibility audit can run unattended** | 1 | agent | — | XCUIApplication.performAccessibilityAudit() runs in CI over the main screens. |
| ` ` | `QUA-30` **Decide A4-4: keep MapKit's clipping ocean labels, or drop all globe labels** | 0.1 | owner | `QUA-20` | A decision recorded in DESIGN-PLAN.md: stay on .hybrid and accept the clipped ocean names, or move to .imagery and lose the continent labels too. |
| `x` | `QUA-31` **Two screenshot seams fall through to the globe instead of failing** | 0.25 | agent | — | Every AKASHIC_SCREEN value either shows its screen or fails loudly. |
| `x` | `QUA-32` **Theme.accent fails WCAG as text in Light Mode, and its own comment says otherwise** | 0.75 | agent | — | Accent-coloured TEXT reaches at least 4.5:1 on a Light-Mode systemBackground (3:1 for large text), and Theme.swift's comment states what was measured rather than an assumption. |
| `x` | `QUA-33` **The local StoreKit test configuration ships inside the Release-CloudKit app bundle** | 0.1 | agent | — | Akashic.storekit is absent from the built Release-CloudKit Akashic.app, and the StoreKit tests still run. |
| `x` | `QUA-34` **Make CloudKitImportSink an actor, closing the last strict-concurrency warning** | 0.5 | agent | — | A clean build-for-testing under SWIFT_STRICT_CONCURRENCY=complete reports ZERO warnings across every target. |
| `x` | `QUA-35` **Pin groupNearDuplicates against known feature prints, then delete FeaturePrintBox** | 0.5 | agent | — | A test asserts groupNearDuplicates' behaviour against feature prints with known distances, and VisionPhotoScorer carries no @unchecked Sendable. |
| `x` | `QUA-36` **Declare PublicMirrorDatabase Sendable so PublicMirrorPublisher's conformance becomes checked** | 0.5 | agent | — | PublicMirrorPublisher conforms to Sendable without @unchecked, and the public-mirror tests still pass. |
| `x` | `QUA-37` **Declare MediaDatabase Sendable so PhotoMediaService's conformance becomes checked** | 0.25 | agent | — | PhotoMediaService conforms to Sendable without @unchecked, and the media tests still pass. |
| ` ` | `QUA-38` **Verify the Vision features on a real device — they cannot run in any simulator** | 0.5 | owner | — | Photo curation (hero pick, best-of, duplicate grouping) and DIFF-05 subject labels are confirmed working on a physical device, with a note recording what was seen. |
| `x` | `QUA-39` **Bump the GitHub Actions that still target Node 20** | 0.1 | agent | — | Every action the workflows reference DIRECTLY targets Node 24. The residual annotation from inside upload-pages-artifact is upstream's and is out of scope -- see why. |
| `x` | `ARCH-01` **DECISION: one map layer, Apple MapKit, swapped across both surfaces together** | 0 | agent | — | Recorded in ARCHITECTURE.md. |
| `x` | `MAP-01` **A map interface narrow enough that the next vendor swap is one adapter** | 1 | agent | — | Web components speak only to a vendor-neutral map interface; no Mapbox or MapKit type appears outside its adapter. |
| `x` | `MAP-02` **Draw the landing globe ourselves — MapKit JS provably cannot** | 2 | agent | `MAP-01` | The landing view is a rotating sphere with a pin per published journey, using no map service and no token. |
| `x` | `MAP-03` **MapKit JS behind the adapter for the journey view** | 3 | agent | `MAP-01` | Selecting a journey shows its route and days on Apple satellite imagery, with Apple's mandatory attribution correctly placed. |
| `x` | `MAP-04A` **Mint the MapKit token in the build, and fail the build before it lapses** | 0.5 | agent | `MAP-01` | scripts/mapkit/mintToken.mjs produces a token a JWT verifier accepts, and the deploy workflow both injects a freshly-minted token and fails when it is within 14 days of expiring. |
| `x` | `MAP-04` **Add the MapKit private key as a repository secret** | 0.1 | owner | — | MAPKIT_PRIVATE_KEY exists as a repository secret. The two identifiers are already set as repository variables. |
| `x` | `MAP-05` **Delete Mapbox: 2786 LOC, the 1626 KB chunk, the SW rules and the secret** | 0.5 | agent | `MAP-02` `MAP-03` | No mapbox package, no mapbox origin in the built bundle, and VITE_MAPBOX_TOKEN removed from all three workflows. |
| `x` | `QUA-40` **E2E reaches live CloudKit, and shares its config with the live site** | 0.4 | agent | — | The E2E Tests workflow is green on main, and it stays green with no network access to Apple. |
| ` ` | `QUA-41` **Replace the CloudKit canary that QUA-40 removed — check the deployed apex, not localhost** | 0.2 | owner | `QUA-40` | A documented owner check exists that fetches the deployed site's CloudKit path with a real Origin header, and it has been run once against akashic.no. |
| `x` | `QUA-42` **e2e/ is checked by neither tsc nor eslint, so the specs are verified only by running** | 0.3 | agent | `QUA-40` | A type error or lint error in e2e/ fails a gate without the suite having to run. |
| `x` | `QUA-45` **The Showcase sheet says a journey is published when the public mirror is empty** | 0.4 | agent | — | The publish state shown to the user reflects the mirror for the CURRENT CloudKit environment, or says it cannot tell. |
| `x` | `QUA-46` **The showcase page shows two different day counts for the same journey** | 0.2 | agent | — | One journey reports one duration, and it matches the app. |
| `x` | `QUA-47` **The journey view frames past the imagery resolution and shows a blurred smear** | 0.3 | agent | — | Opening a journey shows legible terrain at the arrival framing, for a short route as well as a long one. |
| `x` | `QUA-48` **A SAMPLE journey seeded on top of a synced library, duplicating the real one** | 0.3 | agent | — | A fresh install signed into an account that already has journeys does not seed a sample. |
| `x` | `QUA-49` **On MapKit a photo stack hides a camp marker and eats its clicks — a regression versus Mapbox** | 0.3 | agent | `MAP-03` | A camp marker is clickable on the MapKit surface even with a photo stack over it, or the divergence from Mapbox is an accepted, recorded product decision. |
| `x` | `QUA-50` **No test stops the MapKit map being destroyed and rebuilt on a prop change** | 0.3 | agent | `MAP-03` | A test fails if the MapKit map is constructed more than once across a journey switch and a sign-in. |
| `x` | `QUA-51` **MAP-03 left four comments describing behaviour it does not have, and four dead symbols** | 0.3 | agent | `MAP-03` | Every comment listed below describes what the code does, and the dead symbols are gone or used. |
| `x` | `QUA-43` **The live showcase told first-time visitors to click a marker that does not exist** | 0.2 | agent | — | The globe hint appears only when there is at least one marker to click, and it is not overlapped by the "Made with Akashic" chip at any viewport width. |
| `x` | `QUA-44` **Debug console.log ships to production and runs on every visit** | 0.2 | agent | — | A production build emits no debug console output on load, and the mechanism that ensures it is a build setting rather than a promise to remember. |
| `x` | `QUA-52` **scripts/prove.mjs — make "this test can actually fail" mechanical instead of remembered** | 0.4 | agent | — | A defect fix can be proven red-against-the-revert and green-on-HEAD with one command, in a throwaway worktree that cannot leak into the tree being committed from. |
| `x` | `QUA-53` **The ledger never ran its own verify list, and four CLAUDE.md rules were enforced only by memory** | 0.5 | agent | — | `workplan done` refuses a task whose runnable checks have not passed, and the rules that have already cost real time are enforced by the harness rather than remembered by the agent. |
| `x` | `QUA-54` **A fresh-context verifier agent, because the implementer certifying its own tests is how three defects shipped green** | 0.2 | agent | `QUA-53` | The multi-model division of labour is written down where agents read it, and the verifier cannot edit what it judges. |
| `x` | `QUA-55` **A 14.5 pt tap target on iPad, and the reason no run had ever seen it** | 0.3 | agent | — | AccessibilityAuditTests passes on an iPad destination as well as an iPhone one, and the two entries that assert layout pin their device instead of taking whichever simulator is last. |
| `x` | `QUA-56` **apple-ci red for three days: the tests assumed a screen size, and the audit had never seen half of Settings** | 0.5 | agent | — | The full UI suite passes on an iPhone SE (3rd generation) — the device apple-ci actually picks — as well as on a large phone, and the apple-ci run on main is green. |
| `x` | `QUA-57` **prove.mjs --native conflates a git pathspec with an xcodebuild test identifier** | 0.2 | agent | — | prove.mjs can prove a native test suite red-against-the-revert: the tests are named by FILE for the worktree copy and by TARGET/CLASS for -only-testing, as two inputs or a mapping. |
| `x` | `QUA-58` **QUA-49 follow-up: the regression test, the now-false e2e comment, and the two unit-test guards** | 0.3 | agent | — | The camp-over-stack precedence is guarded by an e2e click on a KNOWN coincident day and by unit tests over the re-add and push-off paths; the stale comment is corrected; the local cast is gone. |
| `x` | `QUA-59` **ITMS-90788 from Apple's own delivery feedback: the GPX document type lacked LSHandlerRank** | 0.1 | agent | — | The built Info.plist carries LSHandlerRank for the GPX Track entry, so the next delivery draws no ITMS-90788. |
| `x` | `QUA-60` **The accessibility audit times out on slow runners and blocks the release pipeline — twice in one day** | 0.2 | agent | — | performAccessibilityAudit's framework timeout (NSError code -56, Audit failed to complete in time) is retried a bounded number of times inside the audit helper, so a slow runner costs seconds instead of a manual rerun of a 15-minute job. |
| `x` | `QUA-61` **Shared-database sync never refreshes the UI — participants see a stale journey list until relaunch** | 0.3 | agent | — | Remote changes applied by EITHER engine (private or shared) trigger JourneyStore.reload(), through one multicast point owned by PersistenceController; a unit test drives a fetched batch through a shared-scope engine and asserts the store republished; JourneyStore no longer reaches into an engine directly. |
| `x` | `QUA-62` **Release builds honour the DEBUG persistence-mode override — a leftover flag silently hides the customer archive** | 0.2 | agent | — | Config.resolvedPersistenceMode ignores (and Release launch actively clears) the akashic.persistenceMode.override UserDefaults key outside DEBUG, mirroring the SHIP-09 decision DeveloperTools.isUnlocked already implements; AKASHIC_FORCE_LOCAL becomes an in-memory override instead of a durable UserDefaults write; unit tests pin both. |
| `x` | `QUA-63` **deleteJourney condemns CloudKit zones before the local commit and destroys media on a failed save; comment writes report success on failure** | 0.3 | agent | — | deleteJourney commits the local cascade FIRST and only then enqueues zone deletes and removes the media directory; a failed save rolls back and returns false, and JourneyStore surfaces it instead of returning true unconditionally. updateComment/deleteComment get the same rollback-and-report contract every other write path already has. Unit tests with a poisoned context pin all three. |
| ` ` | `QUA-78` **Owner-device journey deletion is undone by the second device: the protective zone re-upload resurrects it everywhere** | 0.4 | agent | `DIFF-16` | A locally initiated zone deletion is recorded in a durable tombstone consulted by handleZoneDeletions, so a zone THIS install deleted is never protectively re-uploaded; a two-engine unit test proves delete on A + .deleted event on B no longer re-enqueues the journey; the SHIP-15 checklist gains the two-device delete scenario. |
| ` ` | `QUA-79` **Fetch-apply overwrites rows holding unsent local edits — the fetch-before-send race silently loses the later writer** | 0.4 | agent | `DIFF-16` | applyFetchedRecord consults the engine's pending changes (or a local dirty marker) before overwriting; a pending local save either skips the apply (letting the send surface serverRecordChanged) or wins a newest-wins comparison on domain timestamps; a unit test reproduces the race (local edit pending, remote version fetched) and asserts the local edit survives to upload. |
| ` ` | `QUA-80` **Local writes while the sync engine is not running are silently dropped; the activation heal only recovers never-uploaded journeys** | 0.5 | agent | `DIFF-16` | Local intent is durable independent of engine state: edits/creates/deletes made while isRunning is false are persisted (dirty side-table or per-record dirty flag on CDSyncRecordMeta) and drained on activate(); the heal covers edited and added child records of already-uploaded journeys, and queued deletions propagate. Unit tests drive each of the three loss shapes (edit, new child, delete) through a stopped-then-activated engine. |
| ` ` | `QUA-81` **Media-share auto-accept is sticky per journey ID: owner unshare→re-share permanently strands participants on thumbnails** | 0.2 | agent | `DIFF-16` | The accepted marker is keyed by share URL (journeyID→acceptedURL), so a re-created media share with a new URL is re-accepted; account switch clears the stored set; the fake-accepter suite covers unshare→re-share. |
| ` ` | `QUA-86` **Comment identity is per-install: a person's own comments are not editable from their other devices** | 0.3 | agent | — | isMine keys on a CloudKit user record name when available (local UUID as offline fallback), authorName syncs via iCloud KVS, and the same person's comments are editable from all their devices; unit tests pin the identity resolution order. |
| `x` | `QUA-64` **Creation-funnel photo hygiene: free-tier cap in the creation pickers, draft-loss protection, and PhotoImportSheet's orphaned batch tail** | 0.4 | agent | — | Both creation pickers (chooser card + review screen) pass the remaining free-tier allowance as maxSelectionCount with the 'N left' caption (QUA-16's fix, mirrored); at allowance 0 the picker row is replaced by the paywall CTA instead of an unlimited picker; cancelling/interactively dismissing a non-empty draft asks for confirmation before deleting staged files; PhotoImportSheet's mid-batch cancel deletes the tail (stagingCancelled mirrored back) and failures are counted in QUA-14's sentence instead of showing only the last error. |
| `x` | `QUA-65` **The showcase link exists only in the seconds after a publish run, 'Remove from showcase' has no confirmation, and 'Sharing' vs 'Showcase' assumes knowledge a customer lacks** | 0.3 | agent | — | A published journey's showcase sheet always renders the ShareLink + URL row (driven by the verified .onShowcase slug, not the transient .done phase); 'Remove from showcase' asks for confirmation with consequence-stating copy in the house style; the journey overflow menu uses intent-based labels ('Invite family…' / 'Publish web link…'). |
| ` ` | `QUA-70` **Get Journey Photos is a fixtures-era stub: Siri/Shortcuts confidently answer 'no photos' against a 939-photo archive** | 0.2 | agent | — | GetJourneyPhotosIntent resolves the journey, loads its photos through the persistence layer, applies the waypointId filter and the already-computed limit clamp, and returns real results; IntentQueryTests cover the wired path. |
| ` ` | `QUA-71` **DIFF-05/DIFF-08 are engines without wires: Vision subjects never reach the day-note prompt, and drafting failures show the exact generic message the code condemns** | 0.3 | agent | — | WaypointEditSheet.draftNote() populates DayNoteInput.photoSubjects via VisionPhotoScorer.subjects(in:) before generating; the catch maps errors through DayNoteDrafter.failure(from:), shows failure.message, and gates the retry affordance on isWorthRetrying; DIFF-05's and DIFF-08's ledger evidence is corrected to name this task as the wiring that made them reachable. |
| ` ` | `QUA-77` **The PDF story book (DIFF-07, 6 dev-days, DONE) has no UI entry point — no customer can create one** | 0.3 | agent | — | A 'Save as PDF book' action exists on the journey (story toolbar and/or export sheet), feeds StoryPDFRenderer.render with the curated per-day input StoryPagination documents, and hands the produced file to ShareLink; a symbol-presence check à la DIFF-13 (not just unit tests) proves the renderer is linked into the shipped binary. |
| ` ` | `QUA-66` **The signature day fly-in lands with its subject half-hidden behind the sheet** | 0.3 | agent | — | Day (and overview) camera framing accounts for the covered region: a pure MapGeoMath function takes the visible-rect fraction and biases the fitting camera so the day's bbox lands in the visible half (iPhone medium-detent bottom sheet) or the uncovered width (iPad 400pt left panel); MapMathTests pin the offset math; the fly-in visibly lands its subject. |
| ` ` | `QUA-83` **iOS map has no photo clustering, and photo markers steal taps from camp badges — the unfixed iOS twin of the web's QUA-49** | 0.5 | agent | — | Geotagged photos cluster by screen-space proximity at the current camera distance into stack markers with a count badge (matching the web surface); camp badges keep tap precedence over photo markers (declared later / filtered within a clearance radius, mirroring the web decision); coincident camps (rest days) merge into one badge offering both days; a rendered-annotation cap bounds the overview; precedence and clustering are unit-tested like QUA-58 did for the web. |
| ` ` | `QUA-84` **Camera flights are single linear interpolations and the idle globe spin is a 30 Hz main-thread timer that never rests** | 0.3 | agent | `QUA-66` | Transitions between distant targets use MapCameraKeyframeAnimator with a distance-dependent apex (rise–traverse–descend), built by a unit-tested MapGeoMath keyframe builder; the idle spin pauses when the Explore tab is hidden and stops on ANY gesture (including two-finger rotate); ideally the spin itself moves to a system-interpolated animation instead of 30 Hz cameraPosition assignments. |
| ` ` | `QUA-67` **Story mode builds the whole journey eagerly, re-fetches all photos per day per body pass — and strip taps open the wrong photo when the cover is not first** | 0.3 | agent | — | Chapters render in a LazyVStack and DayPhotoStrip in a LazyHStack; the journey's photos are fetched once and sliced per chapter instead of one full Core Data fetch per day per body evaluation; the strip tap resolves the photo by IDENTITY (not index+1), fixing the off-by-one when a mid-day photo is the cover; the hero image is a real button for VoiceOver; a unit test pins the tap-index resolution. |
| ` ` | `QUA-68` **The lightbox decodes full-resolution originals with no downsampling inside a non-lazy pager — jetsam risk on the most-used photo surface** | 0.3 | agent | — | Lightbox pages decode at bounded size (CGImageSource thumbnail at ~2× screen scale, orientation-honoured, off-main) with the full-res file used only for ShareLink and re-decode on deep zoom; pan offsets clamp to the scaled bounds; VideoPage gets the same failed-state + Retry treatment ResolvingImagePage already has; a unit test covers the downsample helper. |
| ` ` | `QUA-69` **Day clustering splits at midnight — the 00:30 aurora photo becomes its own 'day'** | 0.2 | agent | — | Photo-to-day bucketing applies an early-morning cutoff (photos before 04:00 join the previous day) in JourneyDraft.dayKey derivation; JourneyDraftTests pin the boundary (23:59, 00:30, 03:59, 04:00) and the derived date range no longer grows a spurious day from an after-midnight session. |
| ` ` | `QUA-76` **No fetch indexes on the hot lookup columns — every id lookup and photo load is a table scan** | 0.2 | agent | — | A fifth model version adds fetch indexes on CDJourney.id, CDPhoto.id, CDPhoto.journeyId, CDPhoto.waypointId, CDWaypoint.id and CDDayComment.waypointId (index-only lightweight migration, no mapping); StoreMigrationTests prove a v4 store opens under v5. |
| ` ` | `QUA-87` **reload() republishes the entire library with synchronous file I/O after every single edit** | 0.4 | agent | — | Widget thumbnail copies happen only when the source path/mtime changed; Spotlight/widget publishing is debounced off the mutation path; single-row edits reload only the affected journey where the seam allows; an os_signpost measurement on a photo-heavy fixture before/after is recorded in the evidence. |
| ` ` | `QUA-72` **A stranger opening a shared web link hits four silent dead ends: empty globe on any CloudKit failure, fuzzy slug matching, a 15 s token timeout with an unwired Retry, and developer jargon as error copy** | 0.5 | agent | — | Adapter failures reach JourneysContext.error and the globe renders a 'Couldn't load journeys — retry' state (refetch plumbing exists); ?journey= matches exactly on id (case-insensitive) and a non-matching param shows 'This journey isn't available' instead of nothing; MapKitJourneyMap passes onRetry to MapErrorFallback (loader already resets its memo) and shows a loading treatment until ready; on-screen error strings are customer sentences, with the JWT/origin diagnostics kept for the console. |
| ` ` | `QUA-73` **Web: URL, history and document.title never track navigation — the share loop breaks after one hop and Back exits the site** | 0.2 | agent | — | Selecting a journey/day writes ?journey=<slug>&day=<n> via history state with a popstate listener so Back/forward navigate within the app; document.title reads "<journey> — Akashic" per selection; a copied address bar is always a correct share link; tests cover the param round-trip. |
| ` ` | `QUA-74` **Web: the service worker precaches ~6 MB on every first visit; ~4.4 MB is hero PNGs referenced nowhere** | 0.1 | agent | — | The four unused hero PNGs leave public/ (landing-hero stays available to the build-time OG-image script from a non-published path); iOS splash images are excluded from precache globPatterns; the measured precache total drops from ~6.1 MB to well under 2 MB and the number is recorded in the evidence. |
| ` ` | `QUA-75` **Web: the full photo collection is fetched twice per journey and re-fetched on every Photos-tab visit — billed to the owner** | 0.2 | agent | — | Photo state lives once (lifted to AkashicApp or a per-slug memo mirroring journeyCache) and PhotosTab consumes it as props; opening the Photos tab or toggling day/photos mode issues zero additional full-collection fetches; a test pins the single-fetch behaviour. |
| ` ` | `QUA-82` **Web map polish batch: stale stack visuals after zoom regroup, stale chrome padding across the 768 px breakpoint, no hover identity, reduced-motion ignored by camera flights** | 0.3 | agent | — | Photo-stack backing cards and thumbnails update in applyPhotoState so a reused marker never lies about its group (plus a count badge); a matchMedia listener re-applies map.padding and re-frames on breakpoint crossings (phone rotation) so Apple attribution is never obscured; camp markers get name tooltips and globe pins hover labels; prefers-reduced-motion passes animate=false to camera requests and zeroes globe tween durations. |
| ` ` | `QUA-85` **First-run surfaces are excluded from the enforced accessibility audit and carry sub-44pt targets; five surfaces bypass themedMaterial** | 0.3 | agent | — | One UI-test leg launches WITHOUT AKASHIC_SKIP_ONBOARDING and runs the enforced audit over the onboarding cards; the onboarding Skip button, DayNotesField Save/Cancel, DayDetailSheet 'Edit day' pill and the elevation Reset pill get the QUA-29 pairing (minHeight 44 + contentShape); the five raw .ultraThinMaterial sites (comments composer/name/cards, day-sheet chevrons, story DAY badge) route through themedMaterial; FunFactsCarousel's height scales with Dynamic Type instead of character count. |
| ` ` | `QUA-88` **Norwegian-market data entry and display gaps: decimal-comma input silently dropped, day labels hardcoded English, Intelligence drafts English into a Norwegian journal** | 0.2 | agent | — | Weather/distance fields parse with a locale-aware formatter (accepting ',' and '.') and show a validation hint instead of silently dropping; persisted day dateLabels stay POSIX for round-tripping but render localized at the read sites; the Intelligence instruction sets carry a Locale-driven output-language line (with on-device nb quality assessment deferred to QUA-38's session and recorded there). |
| ` ` | `QUA-89` **Unassigned photos are invisible from the day-centric surfaces — the count mismatch reads as photo loss (observed hands-on)** | 0.2 | agent | — | When a journey has photos not matched to any day, the journey detail and/or day sheet surface it ('N photos aren't matched to a day — review'), routing to the existing all-photos grid which already renders the Unassigned section; the no-route journey's map fallback no longer frames Null Island (stay on globe or show a designed placeholder). |

## Decisions on record

- **The web client is frozen as a showcase view** — Keep signed-out showcase and comments; hide every native-only write behind one guard and delete the rest. About 2-3 days instead of 12, and it closes the bug where six components pretend to save. Decided 2026-07-26.
- **Differentiation order: share link, then Vision curation, then the book** — The share link is broken rather than absent, it carries a live privacy leak, and it is the gate that makes the beta measurement possible at all. The book's value is conditional on curation: 939 photos with 449 unique images produces a book nobody wants. Decided 2026-07-26.
- **Norwegian localisation and accessibility both ship in v1.0** — Selling Norwegian-first with an English-only binary is the likelier one-star, and accessibility is harder to retro-fit across 50 view files later. About 8-9 days added before submission. Decided 2026-07-26.
- **No live tracking, no print pipeline, no Android, no custom backend** — Carried forward from COMMERCIALIZATION-PLAN section 9. Live tracking is Polarsteps' moat and belongs to during the trip; this product is about after.

## Gates that no amount of work shortens

- **Paid Applications agreement, banking and tax** — 1-2 weeks, entirely outside the build queue, and no in-app purchase can go live without it. The one item that can silently add two weeks. SHIP-12.
- **External beta** — About three weeks minimum: at least 7 of 10 households creating a journey unaided and 5 finishing and handing one over. The largest calendar item and nothing shortens it. SHIP-17.
- **One month before deleting DATA infrastructure (hosting rollback waived)** — TWO CLOCKS, and the owner waived one on 2026-07-27.
  * HOSTING clock — WAIVED. It existed only to keep a DNS revert to Cloudflare useful. The owner does not want a rollback path, so the Cloudflare Pages project, deploy.yml and the Cloudflare tokens go as soon as the cutover is verified. Worst case is akashic.no down for a while and a re-deploy to Pages; no data is at stake.
  * DATA clock — STANDS, earliest 2026-08-24. This one is not about rollback convenience: R2 holds the 16 GiB / 8147-object archive and Supabase the source rows, and its real gate is LEG-02 (a verified second physical medium), not the calendar. Deleting either before LEG-02 passes is irreversible loss of the family's photographs. Once LEG-02 and LEG-03/LEG-04 are done, whether to also waive the calendar month is the owner's call.
  Does not apply to LEG-01: nothing reads the Worker.
- **App Review** — 1-3 days plus a 3-5 day buffer for one rejection round.

---

Legend: `x` done · `~` in flight · `!` blocked · ` ` open · `-` dropped.
Days are focused build-days, not calendar time.
