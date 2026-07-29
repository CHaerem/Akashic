# Akashic — working agreement

Akashic is an iOS-first family-journey app: a SwiftUI app under `apple/` (~41k LOC) with a
read-only web showcase under `src/` (~35k LOC). All data lives in Apple CloudKit — a private
database per family, plus a world-readable public mirror for journeys the owner publishes.
There is no backend of ours and no server to run.

The project is moving from a family gift to a paid App Store product.

## Start here, every session

**[WORKPLAN.md](WORKPLAN.md) is the only true statement of what is done and what is not.**
It is generated from `docs/workplan/tasks.json`. Nothing else in this repo is authoritative
about status — several documents are still being corrected and some of them are wrong.

```bash
node scripts/workplan.mjs next          # what can be picked up right now
node scripts/workplan.mjs show <id>     # why it matters, how to prove it, what it owns
node scripts/workplan.mjs status        # counts by track
```

Do not invent work. If something needs doing that is not in the ledger, add it to
`tasks.json`, run `npm run workplan:render`, and commit both in the same commit.

### Three things to know before you pick anything up (2026-07-28)

1. **`apple-ci` was red 2026-07-25 → 2026-07-28, and the first written diagnosis was wrong** — this
   item used to blame the StoreKit trap, and the real cause (QUA-56, fixed) was that CI's
   device-picking selects an iPhone SE, where the Settings row the tests anchor on is below the
   fold — and a lazily-created SwiftUI List row that is offscreen does not EXIST in the
   accessibility hierarchy. Two durable halves: a gate that stays red carries no information, so
   compare a red `apple-ci` with the run before yours and never leave it red; and a UI-test result
   is scoped to the screen size it ran on — `requireByScrolling` in the UI-test support exists so
   tests do what a customer does instead of assuming a viewport.
2. **The agent queue was nearly empty; the 2026-07-29 full review refilled it.** This bullet used to
   say "of the ~19 claimable tasks only `QUA-49` and `QUA-55` are yours" — both closed since, and the
   three-surface review (11 parallel readers + a hands-on simulator/web session) added ~34 tasks:
   P0 multi-device sync integrity (`QUA-61`..`QUA-63` now, `QUA-78`..`QUA-81` gated on `DIFF-16`'s
   file lock), the conversion funnel (`QUA-64`/`QUA-65`), map quality (`QUA-66`, `QUA-83`, `QUA-84`,
   `DIFF-18`/`DIFF-19`), photo-heavy performance (`QUA-67`..`QUA-69`, `QUA-76`, `QUA-87`), built-but-
   never-wired engines (`QUA-70`, `QUA-71`, `QUA-77`), and the web showcase (`QUA-72`..`QUA-75`,
   `QUA-82`). The owner queue is unchanged and still gates the calendar. Read `WORKPLAN.md`, not this
   sentence, for current counts.
3. **`SHIP-24` is closed on the repo side and unproven on the device side.** An `applinks` document
   is served at `https://akashic.no/apple-app-site-association` (verified from two places), but Pages
   serves it as `application/octet-stream` where Apple has historically wanted `application/json`.
   Whether iOS accepts that is a `SHIP-15` question and nothing in this repo can answer it.

## The loop

1. `node scripts/workplan.mjs next` — pick one task. Prefer lower `priority` numbers.
2. `node scripts/workplan.mjs claim <id> --agent <who> --branch <branch>` — this is the
   write-lock. It refuses if another in-flight task owns overlapping files.
3. Do the work. Touch only the files in the task's `files` list. If you need a file outside
   it, stop and check whether another task owns it.
4. `node scripts/workplan.mjs verify <id>` — this **runs** the task's `verify` list and records
   what passed. It is no longer your job to remember to.
5. `node scripts/workplan.mjs done <id> --evidence "<the command that passed, or the URL>"`
6. Commit the code **and** the ledger together. A commit that changes behaviour without
   moving the ledger is the failure mode this system exists to prevent.

When several agents work at once, commit with an explicit path list (`git add <paths>`), never
`git add -A` — someone else's half-finished file will otherwise ride along in your commit.

**One catch that has already bitten us:** `git mv` and `git rm` stage themselves immediately, so
a concurrent agent's file move lands in *your* commit no matter how careful your `git add` is.
Run `git status --short` before committing and look for `R`/`D` in the first column. If you see
staged changes that are not yours, unstage them (`git restore --staged <path>`) and let their
owner commit them — and say so, because the ledger entry for that work is still open.

If you stop mid-task — quota, context, anything — leave a breadcrumb first:

```bash
node scripts/workplan.mjs note <id> "parser done and tested; the day-grouping call site is next"
```

Then commit what you have, even if incomplete, behind a flag or as a clearly-marked WIP
commit. **Never leave work only in an uncommitted worktree.** A fresh agent reads
`WORKPLAN.md`, sees the claim and the note, and continues. That is the whole recovery story.

**If the work is meant to run unattended, the turn that accepts it must START it.** Given an
overnight instruction I once replied with a plan and launched nothing; nine hours passed with nothing
done and no error anywhere, because an ordinary turn ends when the text is written and a plan is
indistinguishable from work until the deadline is gone. There is no failure signal — which makes it
worse than a crash, since a crash would have woken something. Before ending such a turn, check that
something is actually running, or say plainly that nothing is.

If the task fixes a defect, **prove the regression test can fail** before closing it:

```bash
npm run prove -- --tests <test file(s)> --revert <product file(s)> [--against <ref>] [--native]
```

That reverts the product files in a throwaway worktree and requires the new tests to go RED against
the old code and GREEN against the new. It exists because three suites here shipped green while
being incapable of failing — see the `verify` section below.

`npm run workplan:check` runs in CI and fails if the ledger is invalid, if two in-flight
tasks own the same files, or if `WORKPLAN.md` has drifted from `tasks.json`.

### `verify` is a gate now, not a suggestion

`done` refuses a task whose runnable checks have never actually run, whose last run failed, or
whose `verify` list was edited after being verified — that last one because editing the list is
the cheapest possible way to launder an unverified claim through the gate. `--force` overrides
and records that it was overridden.

The runnable/attestable split lives **in the ledger**, never in a guess: an entry prefixed
`MANUAL:` needs a person, `OWNER:` needs the owner specifically (a device, an Apple ID, a paid
agreement), and everything else is executed through `sh -c` from the repo root. I tried twice to
tell commands from prose by inspection and got a different answer each time — a command-word
allowlist called `test -f CLAUDE.md` prose; resolving the first token against `PATH` called
`for d in …; do` and `! grep` prose, because those are shell keywords rather than executables.
Write prose without a prefix and `verify` fails loudly on it, which is the right direction to
fail in. Closing a task that has `MANUAL:`/`OWNER:` entries needs `--attest "what you saw"`.

Measured when this landed: 207 of 259 entries are runnable, and **every** prose entry on an open
task sits on an owner task — so the runner covers the whole remaining agent queue.

### What the harness now blocks for you

`.claude/settings.json` denies the two scripts that mutate the owner's world and wires
`.claude/hooks/guard-bash.sh`, which enforces three rules from this file that had each already
cost real time: whole-tree `git add`, those two scripts, and a commit carrying staged renames or
deletions (`R`/`D`) that may be another agent's. Each block names an escape hatch — prefix the
command with `GUARD_OK=1` — because a guard with no way past it gets deleted the first time it is
wrong, and then it protects nothing.

Two things to know before you trust it. **The `deny` list alone is exact-string matching**, so it
catches `git add -A` and not `git add -A .`; the hook does the real pattern work, and the deny
entries are there to make the intent visible in a file people read. And **a hook must exit 2 to
block** — exit 1 is treated as a non-fatal hook error and the command runs anyway, so a guard
written with `exit 1` reads exactly like a working guard and stops nothing.

## Working across models

Four findings from Anthropic's own published guidance, kept because each one contradicts something
that felt obviously right here:

- **Fan out to read, not to write.** Coding is named as the *worst* fit for parallel multi-agent
  work: subagents cannot share the running context that makes edits consistent, so parallel writers
  produce conflicting changes. Parallel *readers* over separate subsystems are the pattern that
  pays. `claim`'s file lock is the mechanical version of this rule and it is why it exists.
- **A single verification pass beats a panel.** Measured: one call with one prompt was the most
  consistent and the most aligned with human judgement; multiple judges were *worse*. So there is no
  reviewer panel here. `.claude/agents/verifier.md` is one agent, run once.
- **A fresh-context verifier beats self-critique**, which is the finding that carries the most weight
  on this project — the implementer certifying its own tests is exactly how QUA-47, QUA-45 and the
  bundle guard all shipped green. Hence the verifier has **no write tools**: it cannot quietly fix
  what it was asked to judge.
- **Multi-agent work costs roughly 15× the tokens**, and token usage explains about 80% of the
  variance in outcome. Spend the tokens where a wrong answer is expensive — verification — and not
  on parallelising edits.

The division of labour that fell out of building this: `workplan verify` answers *did the commands
pass*, deterministically and for almost nothing. The verifier agent answers *would those commands
have caught the defect*, which no command can. Building the first one removed the need for the cheap
measuring agent that was planned alongside it — a deterministic script does that job better than any
model, and it is worth noticing when a tool obsoletes an agent rather than the other way round.

**Untested, and say so if you rely on it:** the verifier agent has never been invoked. Its
frontmatter is validated and its instructions are drawn from measured incidents in this repo, but
its behaviour is unobserved. Treat the first run as an experiment and report what it actually did.

## Before you build anything native

`apple/Akashic.xcodeproj` is **generated and not committed** (`apple/.gitignore:2`). Every
native command needs this first, or it fails in a way that looks like a broken checkout:

```bash
cd apple && xcodegen generate
```

## If you are in a git worktree, read this

**Check what you are branched from before you trust anything.** An agent worktree is branched from
the repo's base commit, not from the dispatching session's HEAD, so it can easily be many commits
behind — one agent found no `CLAUDE.md`, no `WORKPLAN.md` and a test baseline 40 tests light, and
correctly reported that rather than guessing. Start with:

```bash
git log --oneline -1 && git merge-base --is-ancestor <expected-commit> HEAD && echo "up to date"
```

If the working agreement or the ledger is missing, you are on an old base. Say so in your report,
work from `apple/README.md`, and expect the merge back to need real conflict resolution.


**Removing a worktree directory does not deregister it.** `git worktree list` keeps the entry, and
plain `git worktree prune` will not remove it either — it honours `gc.worktreePruneExpire`, three
months by default, so a registration made seconds ago is exempt. Use `git worktree prune --expire
now`. This repo really does accumulate them; there were seven agent worktrees at one point.

**Nested worktrees multiply the test suite and leak other trees' state into your run.** Agent
worktrees live under `.claude/worktrees/` INSIDE the main checkout, each carrying a full `src/`, so
a vitest run from the repo root scanned every copy — measured at 300 files / 3852 tests against the
53 / 680 baseline, and a gate run failed on a state that was not the merged tree's.
`vite.config.js` now excludes `**/.claude/**`; keep that exclusion, and treat any test count far
above baseline as this before anything else. Two more rules from the same afternoon of parallel
agents: **remove merged agent worktrees promptly** (they are silent suite-multipliers until the
exclusion, and stale ones linger — one from the QUA-10 era survived two weeks), and **gate
verification with UI-test legs must wait for a quiet machine** — a concurrent clean Release build
starves the 30 s launch waits and fails honest tests, which reads exactly like the merge broke
them.

`.env` and `.env.local` are gitignored and live only in the main checkout at
`/Users/cher/Privat/Akashic/`. `git worktree add` does not copy them. Copy them first:

```bash
cp /Users/cher/Privat/Akashic/.env* .
```

**MAP-05 changed the shape of this failure and made it worse, so re-read this even if you know the
trap.** The old symptom was the whole Playwright suite failing — 37 of 37 over ten minutes, every
failure a missing Mapbox canvas — because the map needed `VITE_MAPBOX_TOKEN`. Mapbox is deleted, and
the journey map now needs a **minted MapKit token**, which no `.env` in the main checkout carries
either. Two consequences:

- The landing globe needs no token at all (`MAP-02`), so the app looks fine and only journeys break.
- `playwright.config.ts` deliberately DOES NOT REGISTER the journey specs when `VITE_MAPKIT_TOKEN` is
  unset. So the tokenless run is **green with fewer tests**, not red — quieter than the old failure and
  easier to mistake for a pass. It prints a warning saying so; read the test count, not the colour.

Mint one before you trust an e2e run (needs the Apple `.p8` at `~/.keys/AuthKey_<keyId>.p8`, which is
not in the repo and cannot be):

```bash
export VITE_MAPKIT_TOKEN=$(node scripts/mapkit/devToken.mjs)
```

## Verification commands that actually work

These are measured, not guessed. Prefer them over inventing your own.

| What | Command | Expected |
|---|---|---|
| Native build + tests | `cd apple && xcodegen generate && xcodebuild -project Akashic.xcodeproj -scheme Akashic -configuration Debug -destination "platform=iOS Simulator,name=iPhone 17 Pro" CODE_SIGNING_ALLOWED=NO test` | **843 unit (1 skipped, device-only) + 14 UI tests**, 0 failures (~6 s + ~190 s), measured 2026-07-28 **on iPhone**. The destination is pinned by NAME on purpose — the old `\| tail -1` form takes whichever simulator is last, and on iPad the UI suite reports 1 failure (a real 14.5 pt target, `QUA-55`). Add `-only-testing:AkashicTests` for the fast unit-only loop; the UI suite relaunches the app per test |
| Native coverage | add `-enableCodeCoverage YES -resultBundlePath /tmp/cov.xcresult`, then `xcrun xccov view --report --only-targets /tmp/cov.xcresult` | app 48.4 %; `Views/` 34.4 % (was 30.2 % / 6.0 % before the UI test target — QUA-10) |
| Built Info.plist | `plutil -p "$(find ~/Library/Developer/Xcode/DerivedData/Akashic-*/Build/Products -name Akashic.app -maxdepth 3 \| head -1)/Info.plist"` | see the trap below |
| Web unit tests | `npx vitest --run` | **680 tests / 53 files**, ~6 s (measured 2026-07-28). The trail: 452 → 436 (LEG-12 deleted `workers/`) → 414 (LEG-15 deleted the dead `mapMatching`) → 462 → 473 (QUA-40's fixtures) → 566 (MAP-03) → 650 (MAP-02) → 680 (QUA-45/47/48). A FALL here has always been a deletion of dead code, not lost coverage — check `git log` before treating one as a regression. |
| Web typecheck | `npm run typecheck` | clean, and a type error now fails CI and the commit |
| Web lint | `npm run lint` | 205 files inspected, 0 errors, warnings capped at 14 (was 25; MAP-05 deleted `useMapbox.ts` and `MapboxGlobe.tsx`, which held 11 of them — a deletion, not a fix) |
| Web build | `npm run build` | ~4 s, no env needed |
| Web e2e | `VITE_E2E_TEST_MODE=true CI=true npx playwright test --project=chromium --ignore-snapshots` | needs `.env.local` |
| Export tooling | `npx tsc -p scripts/export/tsconfig.json && node scripts/export/smoke.ts` | clean; 26 checks |
| Ledger | `npm run workplan:check` | ok |

Do not run `apple/Scripts/testflight-upload.sh` or `scripts/export/verifyExport.ts` — both
mutate things and need the owner's credentials. `verifyExport.ts` also overwrites the dated
verification report inside the archive bundle.

## Traps that have already cost real time

These are durable lessons, not a status report — for status, read `WORKPLAN.md`, which is
generated and cannot drift. If a claim here contradicts a command you just ran, the command is
right: fix this file in the same commit.

- **`$?`, `&&` and `||` after a pipeline test the LAST stage, so a check that ends in a pipe cannot
  fail.** `cmd | wc -l` exits 0 whatever it counts; `cmd 2>&1 | grep -c warning:` exits 0 on a build
  that failed outright, because a failure log is full of the word "warning:". This is not theoretical
  here: sixteen ledger `verify` entries were written this way, and two of them were hiding real
  defects the whole time — a 404 on `/.well-known/apple-app-site-association` that killed every
  Universal Link, and a documentation link to a workflow deleted seven commits earlier. Both printed
  their finding and exited 0. Put the comparison last (`test "$(… | wc -l)" -eq 12`), redirect to a
  file instead of piping (`cmd > /tmp/log 2>&1 && test …`), or add `|| { echo …; exit 1; }` inside a
  loop — and iterate with `for`, because `while read` in a pipeline is a subshell whose `exit` cannot
  fail the entry. `workplan check` now rejects all three shapes; it found twelve and zero false
  positives, the ~40 entries whose pipe lives inside `$(xcrun simctl … | tail -1)` being correctly
  untouched.
- **A 200 from your own machine is not a verification of a deployed site.** A split-DNS resolver, a
  VPN or a CDN cache can answer with a stale copy, so the owner's `curl` can pass while every
  visitor gets the old bundle — and the reverse, a green build-side check on an artefact the host
  never serves. Two measured instances: GitHub Pages serves **no path beginning with a dot** without
  `.nojekyll`, so `/.well-known/apple-app-site-association` 404'd in production while the file was
  committed, copied into `dist/` by Vite, and green in every build-side assertion; and a hosting
  cutover was once closed on an HTTP check while HTTPS was broken. Assert on the SERVED artefact,
  from the exact scheme and host a browser would use, and check the CONTENT — a 200 serving the SPA
  shell is exactly what the broken state looked like.
- **Deleting a repository secret is not revoking the credential**, and the ledger had to say so twice
  for two unrelated providers before it became a rule. Deleting the secret stops CI from holding it;
  revoking at the provider is what makes it dead. Only the second one matters if it has already
  leaked, and the order is: delete the secret, confirm nothing went red, then revoke.
- **`npm run workplan:check` cannot see a task that was never added.** It validates what is there,
  which means a ledger write that silently failed — a zsh parse error killing a compound command is
  the measured cause — passes the gate while a commit message asserts the task exists. Read the write
  back (`workplan show <id>`) before claiming it in a commit message.
- **`--update-snapshots` will NOT rewrite a baseline whose diff is inside `maxDiffPixelRatio`.** So
  the honest workflow — change a visual surface, regenerate, see success, commit — leaves the old
  image on disk. Delete the PNGs and let them be recreated.
- **A grep count is not a usage count.** Comments and tombstones recording a removal inflate it, so
  "five occurrences remain" can mean the thing is entirely gone. Grep for the usage pattern (an
  `env:` key, an import, a call) rather than the bare string, and read the hits.
- **When a comment or doc claim turns out false, correct it in place and keep the refuted claim with
  the measurement that killed it** — do not delete the sentence. A confidently wrong comment is
  evidence about how the code misleads people, and the next reader needs to know the question was
  asked. Same for a deleted symbol: leave a tombstone naming what went and why.
- **`INFOPLIST_KEY_*` in `apple/project.yml` silently drops keys.** Xcode honours a fixed
  allowlist. `CKSharingSupported` and `UIBackgroundModes` were declared this way and are
  absent from every build shipped so far, which killed CKShare acceptance and push sync.
  Arrays, dictionaries and anything non-scalar must go in the `info: properties:` block at
  `apple/project.yml:53`. Assert against the *built* plist, never the spec.
- **Push sync needed two halves**, and finding one hid the other: the plist key was dropped
  *and* nothing called `registerForRemoteNotifications`. Both are fixed (SHIP-01, SHIP-02) but
  neither can be proven without two devices on two Apple IDs — that is SHIP-15, and it is why
  SHIP-15 is sequenced before the rest of the owner list.
- **Per-push CI still does not type-check the Intelligence code — per-dispatch CD now does.**
  `apple-ci.yml` builds Release-CloudKit on the runner's default Xcode 16.4, where
  `canImport(FoundationModels)` is false, so ~700 lines of shipped, paid-tier Intelligence code
  are invisible to every push. This bullet used to end "compiled by nothing automated", and that
  stopped being true on 2026-07-28: `testflight.yml` selects the newest installed Xcode (26.3 on
  the current image) and archives with `AKASHIC_REQUIRE_INTELLIGENCE` armed, so every TestFlight
  dispatch compiles the family or fails loudly — measured green on run 1, build 101. The gap that
  remains is real but narrower: a push can still break Intelligence and stay green until the next
  dispatch. QUA-05 is the tripwire for it.
- **The web gates are closed now (QUA-02), and closing them found three live defects** that had
  been hiding behind them: a component importing a symbol that exists nowhere in the repo (so it
  threw whenever a journey had segments), an unguarded `getBounds()` that returns null until the
  map has a transform, and a pill control rendering square because `radius.full` is not on the
  scale. Treat a red type check as a real finding, not as noise to route around.
- **A red gate that stays red trains everyone to ignore CI.** Security Audit was red for months
  because the `overrides` pinned a package line that was never patched, and Performance Tests
  pointed at a spec deleted seven months earlier. Both are fixed (QUA-03, QUA-04) — the lesson is
  that "known red" is not a state to leave a gate in. If you cannot fix one, document the
  exception where the next person will read it and give it a removal condition.
- **`String` where `LocalizedStringKey` belongs is invisible to localisation.** A SwiftUI component
  taking `String` for a label silently escapes extraction — that is how the entire paywall was
  untranslatable while looking fine. Same for `.uppercased()` on a label (it forces `String`; use
  `.textCase(.uppercase)`) and for `Text("a " + "b")`, which is a verbatim `Text` because
  `LocalizedStringKey` has no `+`. Xcode's extraction saw 340 strings where 579 existed.
- **`xcodebuild -exportLocalizations` is not a complete key list** — it silently omitted a key the
  compiler had extracted fine. The per-file `.stringsdata` is authoritative.
- **`knownRegions` must be declared in `project.yml`.** XcodeGen infers regions from `.lproj`
  directories and a String Catalog has none, so without it Xcode compiles English only and the app
  falls back with every translation present and unused.
- **`… | tail -1` picks WHICHEVER simulator is last, so the native suite's device is not pinned —
  and that hid a real iPad defect for the whole project.** The idiom is in this file's own
  verification table and in ~40 ledger `verify` entries. Measured 2026-07-28: `tail -1` selected
  *iPad (A16)*, and `AccessibilityAuditTests.testCreateJourneyFlowClearsTheEnforcedAudit` failed on
  a "Route options" control at **104.5 × 14.5 pt**; the same test on *iPhone 17 Pro* passed. So the
  documented "14 UI tests, 0 failures" baseline is true on iPhone and false on iPad, both runs were
  honest, and nothing was flaky. Two consequences: pin the device when a result has to mean
  something (`-destination "platform=iOS Simulator,name=iPhone 17 Pro"`), and treat a UI-test result
  as scoped to the device it ran on. The layout-dependent audit types — `hitRegion` above all —
  cannot be cleared once and trusted across size classes.
- **`find DerivedData/Akashic-* | head -1` will hand you another worktree's build.** Xcode keys
  DerivedData by workspace path, so parallel agent worktrees each get their own — there were seven at
  one point. Installing the wrong one wastes real time: the app runs, the screenshot looks plausible,
  and it shows code you did not write. Select by recency, or better, by workspace:

  ```bash
  for d in ~/Library/Developer/Xcode/DerivedData/Akashic-*; do
    plutil -p "$d/info.plist" | grep -q "$PWD" && echo "$d"
  done
  ```

  The same applies to `plutil`-ing a built `Info.plist` to check a key. Verify the path belongs to
  your worktree before believing the answer.
- **`AppleLanguages` must be a launch ARGUMENT, not an environment variable.**
  `SIMCTL_CHILD_AppleLanguages` fails silently — `UserDefaults` never reads the environment — so a run
  you believe is Norwegian comes up English and looks entirely fine. Use
  `simctl launch <udid> no.akashic.app -AppleLanguages "(nb)"`.
- **A Debug build cannot verify localisation.** Strings inside `#if AKASHIC_CLOUDKIT_BUILD` are never
  extracted by a Debug compile, so a key can be missing from the catalogue entirely while the code is
  correct. Diff the Release-CloudKit `.stringsdata` against Debug to find them. Same blind spot as the
  Intelligence code that CI never type-checks — anything behind a compilation condition is invisible
  to every tool that does not compile that condition.
- **`xcodebuild test` can silently reuse a stale `.xctest` on the simulator.** If you have ever run
  `simctl install` by hand, `xcodebuild test` may keep reporting an old test count and failing on a
  test you already deleted, even after touching the source — the binary in DerivedData is correct the
  whole time. `xcrun simctl uninstall no.akashic.app` fixes it. This is the likeliest explanation for
  any inexplicable "transient" test failure.
- **A UI test that cannot find its element PASSES.** `XCUIElement.waitForExistence(for:)` returns a
  `Bool` that is trivially ignored, and a query that matches nothing taps nothing and asserts
  nothing. `AkashicUITests/Support` wraps every lookup in a `require(...)` that fails loudly, and
  every element is addressed by `accessibilityIdentifier` (`Akashic/App/A11yID.swift`) — never by
  label, because a label is a catalogue string that changes with any copy edit and with every
  non-English run. The same file pins `-AppleLanguages "(en)"` as a launch ARGUMENT, per the trap
  above.
- **XcodeGen writes `storeKitConfiguration` into the scheme's Launch action only.** There is no
  `<TestAction>` equivalent in 2.45.4, and `shouldUseLaunchSchemeArgsEnv` carries arguments and
  environment but not this. So under `xcodebuild test` the app has no local store,
  `Product.products(for:)` returns `[]`, and the paywall shows its "isn't available here yet" row —
  which means `StoreKitProvider.purchase()` cannot be covered from a UI test, and a test claiming
  to cover the priced surface would be asserting against a state that never renders.
- **`performAccessibilityAudit()` reports far more than it should fail on.** Over the eight main
  screens it finds ~130 issues; the app-owned, actionable ones were six sub-44 pt hit targets
  (including "Restore purchases" at 131 × 18 pt and "Remove day 1", which deletes a day, at
  17 × 17 pt). The remaining ~123 are three systemic design decisions — `.secondaryLabel` at 3.45:1
  and `.tertiaryLabel` at 1.74:1 over a Light-Mode `systemBackground`, the map chrome's deliberate
  `dynamicTypeSize` cap, and `StatChip`'s deliberate `lineLimit(1)` — so `AccessibilityAuditTests`
  enforces the four structural audit types and prints the other three with a stated removal
  condition. `.sufficientElementDescription` and `.trait` report **zero**, which is QUA-07/QUA-24's
  labelling work verified by navigation rather than asserted. Exact totals drift — see the
  re-measure command in that file's triage comment, and prefer it to any number written down.
- **A trailing slash in CloudKit's Allowed Origins silently blocks every real browser.** Console stores
  the field verbatim — `akashic.no/` is kept as `https://akashic.no/`, and an HTTP `Origin` header never
  carries a path, so browsers send `https://akashic.no` and get `401 AUTHENTICATION_FAILED`. Measured
  on the production token: `Origin: https://akashic.no` → 401, `Origin: https://akashic.no/` → 200. The
  failure mode is nasty because a `curl` written to match the stored value passes, so the token looks
  fine from the terminal and is broken for every visitor.
  Two corollaries that cost me an hour of wrong conclusions:
  * **A request with NO `Origin` header is also rejected** by an origin-restricted token. So never
    compare two tokens with server-side curl unless you know both origin policies — the old development
    token is on "Any Domain" and passes without an `Origin`, which made a like-for-like curl comparison
    look like "the new token is invalid for this container" when it was valid and merely origin-locked.
  * The token IS environment-scoped (dev token: 200 on development, 401 on production), so a separate
    Production token is genuinely required. Test it with an explicit `Origin` header, from the exact
    scheme+host a browser would send.
- **MapKit's `origin` claim: a bare domain and a wildcard are DISJOINT, and using either alone breaks half
  the site.** Measured 2026-07-27 against `cdn.apple-mapkit.com/ma/bootstrap` with the real key — the only
  way to learn any of this, because no page says it:

  | claim | request `Origin` | result |
  |---|---|---|
  | `akashic.no` | `https://akashic.no` | 200 |
  | `akashic.no` | `https://sub.akashic.no` | **401 ORIGIN_CHECK_FAILURE** |
  | `*.akashic.no` | `https://akashic.no` | **401 ORIGIN_CHECK_FAILURE** |
  | `akashic.no,*.akashic.no` | apex **and** `www` | 200 both |
  | `akashic.no/` | `https://akashic.no` | 401 ORIGIN_CHECK_FAILURE |
  | `https://akashic.no` | `https://akashic.no` | **200** — the scheme is tolerated |
  | *(no `origin` claim)* | matching site | 200 |
  | *(no `scope` claim)* | matching site | 200 |
  | `akashic.no` | *(no `Origin` header)* | 200 |

  The site serves from the apex **and** `www` (a CNAME to `chaerem.github.io` that resolves), so the only
  correct value is the list: `--origin 'akashic.no,*.akashic.no'`. `localhost` works as a list entry and the
  port is not part of the claim.

  Two lessons beyond the table. **First**, the spec and the enforcement disagree, and not where you would
  guess: Apple documents `scope` and `origin` as required and tolerates both being absent, while the two
  things that actually 401 are a trailing slash and the apex/subdomain split. Write to the spec anyway — but
  do not claim a spec violation will fail until you have seen it fail. I asserted in a commit message that
  three spec violations "would 401"; measured, all three return 200, and I had to correct it.
  **Second**, "the token is protected by its origin claim, not by secrecy" holds only for browsers, which
  always send `Origin`. With no `Origin` header the token is served regardless of the claim, so a copied
  token works server-side from anywhere against the 250,000-views-per-day entitlement — which is billed per
  Program membership, not per token.

  And the sibling trap that started all this: CloudKit's Allowed Origins is matched against an HTTP
  `Origin` header, so it needs the scheme (`https://akashic.no`) and rejects a trailing slash. MapKit's is a
  domain pattern. Same word, two Apple services, opposite formats — carrying one lesson across produced a
  validator that rejected the documented value with an authoritative message.
- **A MapKit key cannot be created until a Maps ID exists**, and the portal says so only in red small
  print on a greyed row. Apple: "the MapKit JS checkbox isn't in an enabled state until you create a Maps
  ID." The identifier's first dot-separated field must literally be `maps` (`maps.no.akashic`), which is
  the one place reverse-domain muscle memory misleads you. Keys → the four rows carrying "There are no
  identifiers available" (Maps, Media Services, Sign in with Apple, iWork Document Exporting) are the
  identifier-scoped services; APNs, DeviceCheck and WeatherKit bind to nothing and are always selectable.
  Note also that Apple's own two pages disagree on whether a Maps ID is needed for the *token* route —
  `applemapsserverapi/creating-a-maps-identifier-and-a-private-key` states it twice, `mapkitjs/creating-a-maps-token`
  omits it. Create the Maps ID unconditionally; it is free and removes the ambiguity.
- **Entitlements are never embedded in an unsigned simulator build, so no simulator test can prove one.**
  Measured on Release-CloudKit with `CODE_SIGNING_ALLOWED=NO`: the log contains **zero** codesign steps
  and `codesign -d --entitlements - <app>` reports nothing at all. So `associated-domains`, App Groups,
  WeatherKit and the CloudKit container keys are all *declared* and none of them *take effect* in any
  simulator run. This is why SHIP-07's Universal Link can be fully unit-tested and still not be known to
  work — the test can read the `.entitlements` file and assert its contents (see `UniversalLinkTests`),
  which catches drift between the plist and the code, but it cannot observe the capability. Same blind
  spot as the Vision and Intelligence code: anything gated on signing or on a compilation condition is
  invisible to every tool that does not sign or compile it.

  **This bullet used to end "the device session (SHIP-15) is the only place these become facts", and
  that sentence was false — it is corrected rather than deleted because the distinction it missed is
  the useful part.** An entitlement is not *observable* in a simulator; the feature it gates often
  still is. SHIP-10B measured the entire publish → public-mirror → signed-out-browser → takedown
  path in a simulator signed into iCloud, which is exactly the kind of proof the old sentence said
  was impossible. So the rule is narrower than it looked: ask whether you are testing the
  *capability* (needs a device) or the *behaviour that depends on it* (often does not). SHIP-15 is
  still required for CKShare acceptance across two Apple IDs and for push, because those genuinely
  need two signed installs.
- **No Vision ML request works in the simulator, so the whole curation feature has never run in CI —
  and it fails SILENTLY.** Measured on iOS 26.5: `VNGenerateImageFeaturePrintRequest`,
  `VNClassifyImageRequest` and `VNCalculateImageAestheticsScoresRequest` all return *"Failed to create
  espresso context"*, and `VNDetectFaceRectanglesRequest` returns *"Could not create inference
  context"*. So DIFF-04 (aesthetics, near-duplicate grouping) and DIFF-05 (subject labels) are
  exercised nowhere automated, and cannot be — CI runs simulators too. This is the same blind spot as
  the Intelligence code (QUA-05) but more dangerous, because this code IS compiled and therefore looks
  covered. And `VisionPhotoScorer.score` catches the failure and degrades to "unscored", after which
  `PhotoCuration` falls back to `sortOrder` — so tapping Curate in the simulator is a no-op that looks
  like a working feature, and every screenshot taken so far has never exercised it. QUA-38 is the
  device check. When you must assert something about Vision, `XCTSkip` on the backend failure
  (`FeaturePrintVectorTests` does) so the requirement stays visible in the run log.
- **A warning count is only real from a CLEAN build, and only if the build succeeded.** Two separate
  ways to get a confidently wrong number, both of which caught me during QUA-08. (1) An incremental
  build does not re-emit warnings for files it did not recompile — it reported 19 app-target warnings
  where a clean build found 58, and later 9 where a clean build found 25. (2) A build **with errors**
  under-reports, because a file that failed to compile emits errors instead of its warnings: I read
  44, fixed the errors, and the same tree then reported 62. So a *falling* count can mean the build
  got worse. Always `clean` then `build-for-testing`, and check the error count is zero before you
  believe the warning count. And note `build` compiles the app target ONLY — the ledger's "63
  warnings" for QUA-08 was really 294, because `AkashicUITests` alone held 218 of them.
- **Inserting a member "just before" a Swift declaration lands between that declaration and its
  ATTRIBUTE, and the compiler then applies the attribute to your code instead.** Four times in one
  session, the last costing a full native build: appending a test class immediately above
  `final class ShowcaseViewModelTests` put it under that class's `@MainActor`, silently moving the
  annotation onto the new class and producing seven "main actor-isolated property can not be
  referenced" errors in code nobody had touched. Same shape for a `///` doc comment, a
  `@ViewBuilder`, or an `@available`. Two habits that avoid it: append new types at END OF FILE
  rather than before an anchor, and after any structural insertion check that no attribute line is
  followed by anything but a declaration.
- **Write multi-line `node -e` / `python3 -c` scripts to a FILE, always.** zsh parses a compound
  command in full before running any of it, so one stray quote in a long inline script means
  NOTHING executes — including the parts before the error. That silently skipped a ledger write in
  this project and a commit message then asserted the write had happened, because the confirmation
  line that never printed was in output already scrolled past. Three separate occurrences. If an
  inline script is long enough to contain a quote you have to think about, it belongs in a file.
- **Strict concurrency is on (`complete`, `project.yml:52`) and it earned its keep by finding two real
  races, not by tidying warnings.** `AkashicSyncEngine.nextBatch` read the main-queue Core Data
  context from CloudKit's own queue via the `@Sendable` `recordProvider`; `PhotoDayMatcher` shared two
  `ISO8601DateFormatter`s between `@MainActor` SwiftUI body evaluation and cooperative-pool curation.
  Treat a concurrency diagnostic in sync or persistence code as a probable defect, not noise.
  `SWIFT_VERSION` is still `5.0`; flipping to 6 turns every remaining diagnostic into an error.
- **`nonisolated(unsafe)` on an Apple type is often asserting what Apple declined to assert.** In
  `Foundation`'s own headers `NSDateFormatter` carries
  `NS_SWIFT_SENDABLE // All mutable state protected by locks`, while `NSISO8601DateFormatter` and
  `NSRelativeDateTimeFormatter`, in the same family, carry nothing. That is a per-class decision, and
  the proof is in this repo: `DateOnly.formatter` is a plain `DateFormatter` and never warns. Shared
  ISO-8601 formatting goes through `ISO8601Shared`, which serialises with an `OSAllocatedUnfairLock`
  and is *cheaper* than what it replaced — two sites were constructing a formatter per call.
- **SE-0411 isolated default values need Swift 6 mode, so `store: Foo = Foo()` breaks when `Foo`
  becomes main-actor.** Annotating the enclosing function does nothing — the expression is evaluated
  at the call site. Take a `nil` default and build the value in the body. Same family: a `@MainActor`
  class's `deinit` may not *read* its isolated stored properties (move the cleanup into a small
  non-isolated holder's own deinit), and XCTest's synchronous `setUp`/`tearDown` overrides are
  nonisolated — use the `async throws` forms, which do run on the class's actor.
- **Neither branch's numbers are the merged tree's, so verify after the merge, not before.** Merging
  QUA-10 auto-merged with no conflicts and still left two documents lying: the agent's branch had
  measured 787 unit tests before four of mine existed, so the table it updated was already false for
  the tree it landed in (791 + 14 = 805 is the real figure), and its audit comment pinned 123
  findings where the merged tree stably measures 124. A clean `git merge` proves the *text* composes,
  never that the claims do. The cheap habit that catches it: after any agent merge, re-run the suite
  and re-grep the counts, then fix every number the merge invalidated in the merge commit itself.
  Prose counts are the dangerous kind — an assertion goes red, a sentence just goes quietly stale.
- **The public CloudKit database is billed to us, not to the customer.** The cost table in
  `COMMERCIALIZATION-PLAN.md` says bandwidth is free; that is true of the private database
  only. Anything that increases showcase traffic has a real cost line.
- **A build with no `VITE_MAPKIT_TOKEN` does not fail — it silently ships no map loader at all.**
  Measured after MAP-05: `mapKitToken()` inlines to `void 0` with the variable unset, Rollup then
  dead-code-eliminates the whole loader, and `cdn.apple-mapkit.com` appears in **zero** files under
  `dist/`. With a token it appears in one. The failure is nasty because the landing globe is
  deliberately tokenless (MAP-02) and still renders, so the deployed site looks entirely healthy until
  a visitor opens a journey and gets an empty box. `deploy-pages.yml` now asserts the string is present
  in the built output; keep that assertion, and note it is the only thing standing between a forgotten
  repository secret and a half-broken production site. Same family as the CloudKit trailing slash and
  the missing `INFOPLIST_KEY_*`: the thing that is absent is invisible unless something asserts on the
  artefact.
- **`.camp-marker { z-index: 20 !important }` in `src/index.css` was load-bearing on Mapbox and is inert
  on MapKit, so deleting Mapbox made a known defect the SHIPPED behaviour rather than fixing it.**
  Measured: on Mapbox the element computed `position: absolute; z-index: 22` because mapbox-gl adopts
  `options.element` and adds its own absolutely-positioned class; on MapKit both the camp marker and the
  photo stack compute `position: static`, and neither `DisplayPriority` nor DOM order changes the paint
  order. So a photo stack can hide a camp marker and eat its clicks, and after MAP-05 there is no longer
  a surface where it cannot. That was QUA-49 — **closed since, with regression guards added under
  QUA-58** (`liftCampsAboveStacks` re-adds camps after any stack creation, because paint order is add
  order under MapKit's closed shadow root). This bullet used to end "it is open — do not read the
  surviving CSS rule as evidence the problem is handled", and the 2026-07-29 review found that sentence
  stale; the durable half is the mechanism, which is why the paragraph stays. The iOS map had the same
  defect class unfixed (photo annotations declared after camps steal their taps) — that is QUA-83.

## Conventions

- Norwegian in conversation with the owner; **English in the repo** — code, comments, docs,
  commit messages.
- Commit messages: `type(scope): what changed and why`. Reference task ids (`SHIP-01`).
- Never commit `.env*`, `apple/Akashic.xcodeproj/`, `apple/Generated/`, or DerivedData.
- Never delete a remote resource, rotate a key, or deploy. Those are owner tasks and are
  marked `owner: true` in the ledger. Read-only inspection is fine.
- Renovate automerges dependency updates on a nonOfficeHours schedule. A long-lived branch
  can find `package-lock.json` moved under it — rebase rather than reverting the bot.

## Reading the estimates

`effort` in the ledger is **dev-days: what the work would cost a human developer**, taken from
the review that produced the tasks. It is the right unit for deciding whether something is worth
doing and the wrong one for predicting how long you will take. Do not report the sum as "work
remaining"; it overstates it by a large factor. `WORKPLAN.md` renders the current counts, so read
them there rather than from any number written into prose — including this file.

**This paragraph used to carry two numbers and both went stale, which is the lesson.** It said "44
agent tasks estimated at 17.7 dev-days closed in about one working afternoon", and by 99 tasks and
70.8 dev-days the duration had become arithmetic fiction — the work demonstrably spans several days
of git history. The generator carried the same sentence, so the ledger's own header, the one
document that advertises it cannot drift, was asserting it too. Worth knowing what the fix was NOT:
deriving the span from dates in the ledger produced "2 calendar days", also wrong, because only
recently-annotated tasks carry ISO dates. A computed wrong number is worse than a stale sentence,
because it looks measured. Neither document states an elapsed time now.

The compression is also no longer unmeasured on the large items, and the old warning here has
inverted. Every agent task of 2 dev-days or more is closed — localisation, Swift 6 strict
concurrency, the UI test target, the PDF book, the MapKit port, the hand-drawn globe. What remains
large is **owner** work: an Apple agreement with banking forms, an external beta, a device session.
No amount of agent compression touches any of it, and that is now the whole shape of the schedule.

## Where the real constraints are

Calendar time is dominated by two things no amount of work shortens: the Paid Applications
agreement with banking and tax forms (1–2 weeks, entirely outside the build queue), and the
external beta (~3 weeks, and it is the gate that decides whether the remaining
differentiation work is worth building). Both are in the ledger. Start them early.
