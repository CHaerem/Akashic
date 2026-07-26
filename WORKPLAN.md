<!-- GENERATED FILE — do not edit.
     Source of truth: docs/workplan/tasks.json
     Regenerate:      npm run workplan:render
     CI fails if this file and the ledger disagree. -->

# Akashic — work ledger

98 tasks · **24 open** (7 agent-doable, 4.9 dev-days · 17 owner-only, 8.5 dev-days) · 74 done · 0 dropped

> **`dev-days` are a human-developer estimate, not agent time.** They came from the review
> that produced these tasks and they are the right unit for deciding whether something is
> worth doing — they are the wrong unit for predicting how long an agent will take, and
> summing them as "work remaining" overstates it substantially.
>
> Measured so far: **74 agent tasks estimated at 55.8 dev-days**,
> closed in roughly one working afternoon across up to three parallel tracks.
>
> But that compression is **unmeasured for the large items**: of the tasks closed so far,
> 6 were 2 dev-days or more. 3 of the
> 4.9 remaining dev-days sit in 1 such tasks —
> localisation, Swift 6 strict concurrency, a UI test target, the PDF book. Those involve
> design judgement and broad-blast-radius refactors rather than localised edits, so do not
> assume the same ratio holds. The cheap band is nearly exhausted:
> 5 tasks at 0.5 dev-days or less remain.

Read [CLAUDE.md](CLAUDE.md) before touching anything. To find work:

```bash
node scripts/workplan.mjs next
```

## In flight

| Task | Agent | Branch | Stopped at |
|---|---|---|---|
| `QUA-08` Turn on Swift 6 strict concurrency | opus5 | `claude/remote-control-project-review-9462c1` | 294 -> 55 (52 app + 3 test), 0 errors, 791+14 tests pass. PersistenceController and SyncLocalStore are now @MainActor -- the convention is the compiler's guarantee. THAT CHANGE FOUND A REAL PRE-EXISTING RACE, not a warning: AkashicSyncEngine.nextBatch hoisted 'let store = self.store' into CKSyncEngine.RecordZoneChangeBatch's @Sendable recordProvider, which CloudKit invokes on its own queue -- so makeRecord read the main-QUEUE Core Data context off-main. The provider is async, so it is fixed with a real hop into a main-actor record(for:) helper, not a suppression. MEASUREMENT TRAPS BOTH HIT: an incremental build does not re-emit warnings for files it did not recompile, and a build WITH ERRORS under-reports warnings (44 became 62 once the errors were fixed). Always clean + build-for-testing. SE-0411 isolated default values need Swift 6 mode, so 'store: FakeLocalStore = FakeLocalStore()' defaults had to move into the function body; annotating the function does nothing because the expression is evaluated at the call site. |

## LEGACY

> Retire Supabase, Cloudflare and R2. Repo-side removal can happen now; the infrastructure deletions are gated on the archive being duplicated and on the Pages cutover. LEG-01 is independent of every gate and should happen today.

9 open of 13 · 3.6 d remaining

| | Task | Days | Who | Deps | Finish line |
|---|---|---|---|---|---|
| ` ` | `LEG-01` **Delete the akashic-media Cloudflare Worker** | 0.5 | owner | — | The endpoint returns no response, and SUPABASE_SERVICE_KEY no longer exists in any Worker env. |
| ` ` | `LEG-02` **Copy the 16 GiB export archive to a second physical medium** | 0.5 | owner | — | 8147 objects and the six table sha256s verify on a second volume that is not the boot disk. |
| ` ` | `LEG-03` **Decide the fate of the 5080 un-catalogued R2 objects (12.21 GB)** | 0.5 | owner | `LEG-02` | A written decision exists: keep in the archive forever, or discard deliberately. |
| ` ` | `LEG-04` **Run the T5.1 delta check against live Supabase** | 0.5 | owner | `LEG-02` | Row counts and max(updated_at) per table match manifest.json, or the delta is exported and merged. |
| `x` | `LEG-05` **Rewire src/lib/media.ts off the Worker** | 0.5 | agent | — | No source file resolves media through the workers.dev host, and web tests stay green. |
| `x` | `LEG-06` **Delete the unrunnable legacy scripts and the AWS SDK dependency** | 0.5 | agent | — | npm run build and vitest pass with the dead scripts and @aws-sdk/client-s3 gone. |
| `x` | `LEG-07` **Gate every native-only web write behind one guard** | 1 | agent | — | No web UI offers a write that silently no-ops; each either disappears or shows a native-only notice. |
| `x` | `LEG-08` **Remove the hardcoded /Users/cher archive path from shipping code** | 0.25 | agent | — | No absolute developer path appears in any non-test Swift file. |
| ` ` | `LEG-09` **Execute the GitHub Pages + DNS cutover (T4.2, T4.3)** | 0.5 | owner | `SHIP-10` | akashic.no serves from GitHub Pages, privacy/terms/support resolve, and the AASA file is reachable. |
| ` ` | `LEG-10` **Delete deploy.yml, then revoke the Cloudflare and Supabase secrets** | 0.25 | agent | `LEG-09` | No workflow references Cloudflare, and CI is green without those secrets. |
| ` ` | `LEG-11` **Delete the gated infrastructure: Pages project, R2 bucket, DNS zone, Supabase, OAuth** | 0.5 | owner | `LEG-03` `LEG-04` `LEG-09` `LEG-10` | All five are gone from their dashboards and the archive is verified on two media. |
| ` ` | `LEG-12` **Delete workers/ from the repo** | 0.25 | agent | `LEG-01` `LEG-05` | workers/ is gone and no workflow or test references it. |
| ` ` | `LEG-13` **Delete supabase/** | 0.1 | agent | `LEG-04` | supabase/ is gone from the repo. |

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

11 open of 19 · 5.3 d remaining

| | Task | Days | Who | Deps | Finish line |
|---|---|---|---|---|---|
| `x` | `SHIP-01` **Move the two dropped Info.plist keys into info.properties** | 0.25 | agent | — | The built Release-CloudKit Info.plist contains CKSharingSupported and UIBackgroundModes. |
| `x` | `SHIP-02` **Register for remote notifications — the missing half of push sync** | 0.5 | agent | `SHIP-01` | The app calls registerForRemoteNotifications and a device receives a CloudKit push. |
| `x` | `SHIP-03` **Produce the 12 App Store screenshots** | 1.5 | agent | `SHIP-06` `QUA-06` | Twelve assets exist at the two required sizes and are committed under docs/store/screenshots/. |
| `x` | `SHIP-04` **Add PrivacyInfo.xcprivacy** | 0.25 | agent | — | The manifest ships in the app bundle and the upload draws no ITMS-91053 notice. |
| `x` | `SHIP-05` **Bump the marketing version to 1.0.0** | 0.1 | agent | — | The built plist reports CFBundleShortVersionString 1.0.0. |
| `x` | `SHIP-06` **D5 — consumer sync wording, iPhone portrait lock, ASC config match** | 0.5 | agent | — | Settings shows no engineering strings and iPhone does not rotate into the iPad panel layout. |
| ` ` | `SHIP-07` **Add the associated-domains entitlement so Universal Links work** | 0.25 | agent | `LEG-09` | Tapping an akashic.no journey link opens the app rather than Safari. |
| `x` | `SHIP-08` **Write the public-showcase takedown procedure** | 0.5 | agent | `DIFF-02` | A documented, tested procedure removes a reported public journey, and the privacy page says how to ask. |
| `x` | `SHIP-09` **Compile the developer workshop out of Release** | 0.25 | agent | — | No developer surface is reachable in a Release build, and the seven-tap gesture is gone. |
| ` ` | `SHIP-10` **Point akashic.no at the CloudKit production environment** | 0.5 | owner | — | The deployed bundle carries environment:"production" and a published journey is visible signed out. |
| ` ` | `SHIP-11` **Trademark and name clearance for 'Akashic'** | 0.5 | owner | — | A written go/no-go exists from Patentstyret and EUIPO in the software class. |
| ` ` | `SHIP-12` **Paid Applications agreement, banking and tax forms** | 0.5 | owner | — | App Store Connect reports the Paid Applications agreement as active. |
| ` ` | `SHIP-13` **Create the IAP, join Small Business Program, declare EU trader status** | 0.5 | owner | `DOC-08` `SHIP-12` | no.akashic.app.complete exists at kr 149 with Family Sharing on, and trader status is submitted. |
| ` ` | `SHIP-14` **Enter ASC metadata, App Privacy, review notes and the icon** | 0.5 | owner | `DOC-08` `SHIP-03` `QUA-09` | The version is complete in App Store Connect except for the build. |
| ` ` | `SHIP-15` **Real-device smoke test on two Apple IDs** | 1 | owner | `SHIP-01` `SHIP-02` | A share invitation opens in-app, and an edit on device A appears on device B without foregrounding. |
| ` ` | `SHIP-16` **TestFlight: internal family, then the external beta group** | 0.5 | owner | `SHIP-15` | An external group of ~10 households is running a build with test notes. |
| ` ` | `SHIP-17` **The external beta gate** | 0 | owner | `SHIP-16` `SHIP-03` | At least 7 of 10 households create a journey unaided and 5 finish and hand one over. |
| ` ` | `SHIP-18` **Submit for review with a rejection buffer** | 0.5 | owner | `SHIP-17` `SHIP-14` | The app is approved and held for manual release. |
| ` ` | `SHIP-19` **Day-one support readiness** | 0.5 | owner | `SHIP-18` | support@akashic.no is monitored with a real FAQ, and crash reports are checked daily for week one. |

## DIFF

> Capability beyond what competitors offer. Order set by decision: share link, then Vision curation, then the book.

1 open of 14 · 0.5 d remaining

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

## QUALITY

> Tests, types, CI, localisation, accessibility. Localisation and accessibility are in v1.0 by decision.

3 open of 33 · 4 d remaining

| | Task | Days | Who | Deps | Finish line |
|---|---|---|---|---|---|
| `x` | `QUA-01` **Make CI build and test the configurations that actually ship** | 0.5 | agent | `SHIP-01` | CI builds Release and Release-CloudKit and asserts the two Info.plist keys are present. |
| `x` | `QUA-02` **Make the lint and typecheck gates real for the code that ships** | 1.5 | agent | `LEG-07` | ESLint inspects src/, and a type error fails CI rather than being swallowed. |
| `x` | `QUA-03` **Clear the red Security Audit job** | 0.5 | agent | — | npm audit --audit-level=high exits 0, or the exception is documented and time-boxed. |
| `x` | `QUA-04` **Repair or delete the Performance Tests workflow** | 0.25 | agent | — | No workflow references a spec file that does not exist. |
| `x` | `QUA-05` **Add a compile tripwire for the Foundation Models code** | 0.5 | agent | — | CI fails if the Intelligence code stops compiling. |
| `x` | `QUA-06` **Localise the app to Norwegian** | 4 | agent | — | Every user-visible string comes from a string catalogue, and the app runs in NB end to end. |
| `x` | `QUA-07` **Bring accessibility to a shippable standard** | 3 | agent | `QUA-06` | Every interactive control has a label, and the photo grid and elevation chart are navigable by VoiceOver. |
| `~` | `QUA-08` **Turn on Swift 6 strict concurrency** | 3 | agent | — | The project builds clean under SWIFT_STRICT_CONCURRENCY=complete. |
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
| ` ` | `QUA-30` **The remaining A4 polish items on the globe and onboarding** | 0.25 | agent | `QUA-20` | Each remaining A4 item is either fixed or recorded as a deliberate choice. |
| `x` | `QUA-31` **Two screenshot seams fall through to the globe instead of failing** | 0.25 | agent | — | Every AKASHIC_SCREEN value either shows its screen or fails loudly. |
| ` ` | `QUA-32` **Theme.accent fails WCAG as text in Light Mode, and its own comment says otherwise** | 0.75 | agent | — | Accent-coloured TEXT reaches at least 4.5:1 on a Light-Mode systemBackground (3:1 for large text), and Theme.swift's comment states what was measured rather than an assumption. |
| `x` | `QUA-33` **The local StoreKit test configuration ships inside the Release-CloudKit app bundle** | 0.1 | agent | — | Akashic.storekit is absent from the built Release-CloudKit Akashic.app, and the StoreKit tests still run. |

## Decisions on record

- **The web client is frozen as a showcase view** — Keep signed-out showcase and comments; hide every native-only write behind one guard and delete the rest. About 2-3 days instead of 12, and it closes the bug where six components pretend to save. Decided 2026-07-26.
- **Differentiation order: share link, then Vision curation, then the book** — The share link is broken rather than absent, it carries a live privacy leak, and it is the gate that makes the beta measurement possible at all. The book's value is conditional on curation: 939 photos with 449 unique images produces a book nobody wants. Decided 2026-07-26.
- **Norwegian localisation and accessibility both ship in v1.0** — Selling Norwegian-first with an English-only binary is the likelier one-star, and accessibility is harder to retro-fit across 50 view files later. About 8-9 days added before submission. Decided 2026-07-26.
- **No live tracking, no print pipeline, no Android, no custom backend** — Carried forward from COMMERCIALIZATION-PLAN section 9. Live tracking is Polarsteps' moat and belongs to during the trip; this product is about after.

## Gates that no amount of work shortens

- **Paid Applications agreement, banking and tax** — 1-2 weeks, entirely outside the build queue, and no in-app purchase can go live without it. The one item that can silently add two weeks. SHIP-12.
- **External beta** — About three weeks minimum: at least 7 of 10 households creating a journey unaided and 5 finishing and handing one over. The largest calendar item and nothing shortens it. SHIP-17.
- **One month of stable native use before deleting infrastructure** — Earliest 2026-08-24 for the native-app clock, and later for hosting since the stable-on-Pages clock cannot start until the cutover lands. Does not apply to LEG-01: nothing reads the Worker.
- **App Review** — 1-3 days plus a 3-5 day buffer for one rejection round.

---

Legend: `x` done · `~` in flight · `!` blocked · ` ` open · `-` dropped.
Days are focused build-days, not calendar time.
