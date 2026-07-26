<!-- GENERATED FILE — do not edit.
     Source of truth: docs/workplan/tasks.json
     Regenerate:      npm run workplan:render
     CI fails if this file and the ledger disagree. -->

# Akashic — work ledger

73 tasks · **68 open** (52 agent-doable, 46.8 d · 16 owner-only, 8 d) · 5 done · 0 dropped

Read [CLAUDE.md](CLAUDE.md) before touching anything. To find work:

```bash
node scripts/workplan.mjs next
```

## LEGACY

> Retire Supabase, Cloudflare and R2. Repo-side removal can happen now; the infrastructure deletions are gated on the archive being duplicated and on the Pages cutover. LEG-01 is independent of every gate and should happen today.

11 open of 11 · 5.5 d remaining

| | Task | Days | Who | Deps | Finish line |
|---|---|---|---|---|---|
| ` ` | `LEG-01` **Delete the akashic-media Cloudflare Worker** | 0.5 | owner | — | The endpoint returns no response, and SUPABASE_SERVICE_KEY no longer exists in any Worker env. |
| ` ` | `LEG-02` **Copy the 16 GiB export archive to a second physical medium** | 0.5 | owner | — | 8147 objects and the six table sha256s verify on a second volume that is not the boot disk. |
| ` ` | `LEG-03` **Decide the fate of the 5080 un-catalogued R2 objects (12.21 GB)** | 0.5 | owner | `LEG-02` | A written decision exists: keep in the archive forever, or discard deliberately. |
| ` ` | `LEG-04` **Run the T5.1 delta check against live Supabase** | 0.5 | owner | `LEG-02` | Row counts and max(updated_at) per table match manifest.json, or the delta is exported and merged. |
| ` ` | `LEG-05` **Rewire src/lib/media.ts off the Worker and delete workers/** | 0.5 | agent | `LEG-01` | No source file references the workers.dev host, and npx vitest --run stays green. |
| ` ` | `LEG-06` **Delete supabase/, the 12 unrunnable scripts, and @aws-sdk/client-s3** | 0.5 | agent | `LEG-04` | npm run build, vitest and the Pages workflow all pass with those paths gone. |
| ` ` | `LEG-07` **Gate every native-only web write behind one guard** | 1 | agent | — | No web UI offers a write that silently no-ops; each either disappears or shows a native-only notice. |
| ` ` | `LEG-08` **Remove the hardcoded /Users/cher archive path from shipping code** | 0.25 | agent | — | No absolute developer path appears in any non-test Swift file. |
| ` ` | `LEG-09` **Execute the GitHub Pages + DNS cutover (T4.2, T4.3)** | 0.5 | owner | `SHIP-10` | akashic.no serves from GitHub Pages, privacy/terms/support resolve, and the AASA file is reachable. |
| ` ` | `LEG-10` **Delete deploy.yml, then revoke the Cloudflare and Supabase secrets** | 0.25 | agent | `LEG-09` | No workflow references Cloudflare, and CI is green without those secrets. |
| ` ` | `LEG-11` **Delete the gated infrastructure: Pages project, R2 bucket, DNS zone, Supabase, OAuth** | 0.5 | owner | `LEG-03` `LEG-04` `LEG-09` `LEG-10` | All five are gone from their dashboards and the archive is verified on two media. |

## DOCS

> Make the documentation true. Cheap, high-value, and it is what stops the next agent inheriting a false picture.

12 open of 14 · 2.9 d remaining

| | Task | Days | Who | Deps | Finish line |
|---|---|---|---|---|---|
| `x` | `DOC-01` **CLAUDE.md — the protocol every session loads** | 0.5 | agent | — | A fresh agent can find the ledger, build the app and run the right verification without asking. |
| `x` | `DOC-02` **The work ledger and its enforcement** | 1 | agent | — | npm run workplan:check passes and fails loudly when the ledger and WORKPLAN.md disagree. |
| ` ` | `DOC-03` **Rewrite ARCHITECTURE.md** | 0.5 | agent | — | No document describes Supabase, R2 or the Worker as active infrastructure. |
| ` ` | `DOC-04` **Correct the cost table: public-database egress is billed to the developer** | 0.5 | agent | — | The cost table distinguishes the owner's iCloud quota from the developer-billed public database. |
| ` ` | `DOC-05` **Fix the test-count claims that disagree with each other** | 0.25 | agent | — | Every stated test count matches a command anyone can run. |
| ` ` | `DOC-06` **Record that Akashic Intelligence already ships** | 0.25 | agent | — | No document schedules as v1.1 a feature that is wired to real UI today. |
| ` ` | `DOC-07` **Add the PCC timing caveat: production PCC ships with iOS 27** | 0.1 | agent | — | The Apple Intelligence section states that PCC cannot be in v1.0. |
| ` ` | `DOC-08` **Fix store copy that advertises a paywall the code does not implement** | 0.25 | agent | — | No store or IAP copy claims Complete unlocks publishing or export. |
| ` ` | `DOC-09` **Fix the Entitlements.swift comments that contradict the same file's header** | 0.1 | agent | — | The enum comments and the file header describe the same paywall. |
| ` ` | `DOC-10` **Remove the false 'exhaustively unit-tested' claim from KnowledgeRetrieval.swift** | 0.1 | agent | — | No doc comment claims test coverage that does not exist. |
| ` ` | `DOC-11` **Archive ROADMAP.md and delete PLAN.md** | 0.25 | agent | — | No unmarked stale planning document remains at the repo root. |
| ` ` | `DOC-12` **Correct the DESIGN-PLAN ticks that code does not support** | 0.25 | agent | — | No design item is marked shipped unless code supports it. |
| ` ` | `DOC-13` **Audit every claim in README.md** | 0.25 | agent | — | Every feature and tech-stack claim in the README is true of the current build. |
| ` ` | `DOC-14` **Fix github-pages-cutover.md drift before the owner follows it** | 0.1 | agent | — | Every instruction in the cutover runbook is still executable as written. |

## SHIP

> Hard requirements for a paid v1.0. Most of the remaining calendar time lives here, in items only the owner can do.

18 open of 19 · 8.9 d remaining

| | Task | Days | Who | Deps | Finish line |
|---|---|---|---|---|---|
| `x` | `SHIP-01` **Move the two dropped Info.plist keys into info.properties** | 0.25 | agent | — | The built Release-CloudKit Info.plist contains CKSharingSupported and UIBackgroundModes. |
| ` ` | `SHIP-02` **Register for remote notifications — the missing half of push sync** | 0.5 | agent | `SHIP-01` | The app calls registerForRemoteNotifications and a device receives a CloudKit push. |
| ` ` | `SHIP-03` **Produce the 12 App Store screenshots** | 1.5 | agent | `SHIP-06` | Twelve assets exist at the two required sizes and are committed under docs/store/screenshots/. |
| ` ` | `SHIP-04` **Add PrivacyInfo.xcprivacy** | 0.25 | agent | — | The manifest ships in the app bundle and the upload draws no ITMS-91053 notice. |
| ` ` | `SHIP-05` **Bump the marketing version to 1.0.0** | 0.1 | agent | — | The built plist reports CFBundleShortVersionString 1.0.0. |
| ` ` | `SHIP-06` **D5 — consumer sync wording, iPhone portrait lock, ASC config match** | 0.5 | agent | — | Settings shows no engineering strings and iPhone does not rotate into the iPad panel layout. |
| ` ` | `SHIP-07` **Add the associated-domains entitlement so Universal Links work** | 0.25 | agent | `LEG-09` | Tapping an akashic.no journey link opens the app rather than Safari. |
| ` ` | `SHIP-08` **Write the public-showcase takedown procedure** | 0.5 | agent | `DIFF-02` | A documented, tested procedure removes a reported public journey, and the privacy page says how to ask. |
| ` ` | `SHIP-09` **Compile the developer workshop out of Release** | 0.25 | agent | — | No developer surface is reachable in a Release build, and the seven-tap gesture is gone. |
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

8 open of 9 · 15.5 d remaining

| | Task | Days | Who | Deps | Finish line |
|---|---|---|---|---|---|
| `x` | `DIFF-01` **Fix the unpublish leak: thumbnails that can never be removed** | 0.5 | agent | — | Unpublishing always removes the mirror, and a failure to remove reports as a failure. |
| ` ` | `DIFF-02` **Give the owner a shareable showcase link** | 1 | agent | `DIFF-01` | Publishing yields a working URL the owner can share, correct under slug disambiguation. |
| ` ` | `DIFF-03` **Add og: metadata so a shared link renders as a card** | 0.5 | agent | `DIFF-02` | A showcase URL pasted into iMessage, WhatsApp and Slack renders a title, description and image. |
| ` ` | `DIFF-04` **On-device photo curation with Vision** | 3 | agent | — | Each day proposes a best-of selection and a hero, accepted or dismissed like other suggestions. |
| ` ` | `DIFF-05` **Feed Vision labels into DayNoteDrafter** | 1 | agent | `DIFF-04` | A drafted day note references what is actually in the photos. |
| ` ` | `DIFF-06` **Byte-level photo dedup** | 1.5 | agent | `DIFF-04` | A journey reports its unique-image count, and duplicates are collapsed on import. |
| ` ` | `DIFF-07` **PDF export of the story view** | 6 | agent | `DIFF-04` `DIFF-06` | A journey exports a PDF a person would willingly hand over. |
| ` ` | `DIFF-08` **Foundation Models depth: streaming, prewarm, typed errors** | 1.5 | agent | `QUA-05` | Drafting streams, sessions are reused, and guardrail refusals say something specific. |
| ` ` | `DIFF-09` **C9 — derive days from timestamped GPX trackpoints** | 1 | agent | — | A Strava or Garmin export yields a journey with correctly dated days. |

## QUALITY

> Tests, types, CI, localisation, accessibility. Localisation and accessibility are in v1.0 by decision.

19 open of 20 · 22 d remaining

| | Task | Days | Who | Deps | Finish line |
|---|---|---|---|---|---|
| `x` | `QUA-01` **Make CI build and test the configurations that actually ship** | 0.5 | agent | `SHIP-01` | CI builds Release and Release-CloudKit and asserts the two Info.plist keys are present. |
| ` ` | `QUA-02` **Make the lint and typecheck gates real for the code that ships** | 1.5 | agent | `LEG-07` | ESLint inspects src/, and a type error fails CI rather than being swallowed. |
| ` ` | `QUA-03` **Clear the red Security Audit job** | 0.5 | agent | — | npm audit --audit-level=high exits 0, or the exception is documented and time-boxed. |
| ` ` | `QUA-04` **Repair or delete the Performance Tests workflow** | 0.25 | agent | — | No workflow references a spec file that does not exist. |
| ` ` | `QUA-05` **Add a compile tripwire for the Foundation Models code** | 0.5 | agent | — | CI fails if the Intelligence code stops compiling. |
| ` ` | `QUA-06` **Localise the app to Norwegian** | 4 | agent | — | Every user-visible string comes from a string catalogue, and the app runs in NB end to end. |
| ` ` | `QUA-07` **Bring accessibility to a shippable standard** | 3 | agent | `QUA-06` | Every interactive control has a label, and the photo grid and elevation chart are navigable by VoiceOver. |
| ` ` | `QUA-08` **Turn on Swift 6 strict concurrency** | 3 | agent | — | The project builds clean under SWIFT_STRICT_CONCURRENCY=complete. |
| ` ` | `QUA-09` **Light up the widget or remove it from v1.0** | 0.5 | agent | — | The widget shows the customer's own journey, or it does not ship. |
| ` ` | `QUA-10` **First tests for Views/, and a UI test target** | 3 | agent | `QUA-01` | A UI test target exists and the create-journey flow has an automated test. |
| ` ` | `QUA-11` **Handle a full iCloud account** | 0.5 | agent | — | A quota-exceeded sync failure is visible in the UI and says what to do. |
| ` ` | `QUA-12` **Tests for KnowledgeRetrieval, and fix its two real defects** | 1 | agent | `DOC-10` | The retrieval path has tests, including the cross-project de-dup and empty-coordinate cases. |
| ` ` | `QUA-13` **Stop video import loading whole files into memory** | 0.5 | agent | — | Importing a multi-minute 4K video does not jetsam the app. |
| ` ` | `QUA-14` **Name the shortfall when photo ingest partly fails** | 0.25 | agent | — | A creation flow that ingests fewer photos than picked says so. |
| ` ` | `QUA-15` **Add an 'entitlement undetermined' state** | 0.5 | agent | — | A paying customer is never shown the free-tier wall while StoreKit is still resolving. |
| ` ` | `QUA-16` **Make the 100-photo cap a limit, not a failure** | 0.5 | agent | — | The cap is visible before ingest work starts, not reported after it. |
| ` ` | `QUA-17` **Sell what the purchase actually unlocks** | 0.5 | agent | — | The paywall lists all four unlocked capabilities and carries the price anchor. |
| ` ` | `QUA-18` **A2 — haptics on meaningful transitions** | 0.5 | agent | — | The five named moments produce sensory feedback. |
| ` ` | `QUA-19` **Redraw the app icon** | 0.5 | agent | — | The icon is legible at 60 pt and works in light, dark and tinted appearances. |
| ` ` | `QUA-20` **A4 — the 'would Apple ship this screen?' review round** | 1 | agent | `QUA-07` `QUA-18` `QUA-19` | Each primary screen has been reviewed against current HIG and the findings closed or recorded. |

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
