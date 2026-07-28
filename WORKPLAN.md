<!-- GENERATED FILE — do not edit.
     Source of truth: docs/workplan/tasks.json
     Regenerate:      npm run workplan:render
     CI fails if this file and the ledger disagree. -->

# Akashic — work ledger

148 tasks · **27 open** (2 agent-doable, 1.1 dev-days · 25 owner-only, 10.6 dev-days) · 121 done · 0 dropped

> **`dev-days` are a human-developer estimate, not agent time.** They came from the review
> that produced these tasks and they are the right unit for deciding whether something is
> worth doing — they are the wrong unit for predicting how long an agent will take, and
> summing them as "work remaining" overstates it substantially.
>
> Measured so far: **115 agent tasks estimated at 76.7 dev-days**.
> Elapsed time is deliberately absent: nothing here can support it. Use `git log` for that.
>
> **Every large agent item is closed.** 9 of the tasks closed so far were 2 dev-days or more; nothing 2 dev-days or larger remains agent-doable, and the 1.1 remaining dev-days are all small tasks (1 at 0.5 or less). What is still genuinely large is OWNER work, which no amount of agent compression touches.

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

2 open of 16 · 1.5 d remaining

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

## QUALITY

> Tests, types, CI, localisation, accessibility. Localisation and accessibility are in v1.0 by decision.

3 open of 66 · 0.8 d remaining

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
