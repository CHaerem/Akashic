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

## The loop

1. `node scripts/workplan.mjs next` — pick one task. Prefer lower `priority` numbers.
2. `node scripts/workplan.mjs claim <id> --agent <who> --branch <branch>` — this is the
   write-lock. It refuses if another in-flight task owns overlapping files.
3. Do the work. Touch only the files in the task's `files` list. If you need a file outside
   it, stop and check whether another task owns it.
4. Run every command in the task's `verify` list. They must pass.
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

`npm run workplan:check` runs in CI and fails if the ledger is invalid, if two in-flight
tasks own the same files, or if `WORKPLAN.md` has drifted from `tasks.json`.

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


`.env` and `.env.local` are gitignored and live only in the main checkout at
`/Users/cher/Privat/Akashic/`. `git worktree add` does not copy them. Without them the
Playwright suite fails **37 of 37 tests over ten minutes**, every failure a missing Mapbox
canvas — and it reads exactly like a regression you caused. It is not. Copy them first:

```bash
cp /Users/cher/Privat/Akashic/.env* .
```

## Verification commands that actually work

These are measured, not guessed. Prefer them over inventing your own.

| What | Command | Expected |
|---|---|---|
| Native build + tests | `cd apple && xcodegen generate && xcodebuild -project Akashic.xcodeproj -scheme Akashic -configuration Debug -destination "platform=iOS Simulator,id=$(xcrun simctl list devices available \| grep -o '[0-9A-F-]\{36\}' \| tail -1)" CODE_SIGNING_ALLOWED=NO test` | 608 tests, 0 failures, ~15 s warm |
| Native coverage | add `-enableCodeCoverage YES -resultBundlePath /tmp/cov.xcresult`, then `xcrun xccov view --report --only-targets /tmp/cov.xcresult` | app 28.4 %; `Views/` 5.9 % |
| Built Info.plist | `plutil -p "$(find ~/Library/Developer/Xcode/DerivedData/Akashic-*/Build/Products -name Akashic.app -maxdepth 3 \| head -1)/Info.plist"` | see the trap below |
| Web unit tests | `npx vitest --run` | 406 tests, ~4 s |
| Web typecheck | `npm run typecheck` | clean, and a type error now fails CI and the commit |
| Web lint | `npm run lint` | 171 files inspected, 0 errors, warnings capped at 25 |
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

- **`INFOPLIST_KEY_*` in `apple/project.yml` silently drops keys.** Xcode honours a fixed
  allowlist. `CKSharingSupported` and `UIBackgroundModes` were declared this way and are
  absent from every build shipped so far, which killed CKShare acceptance and push sync.
  Arrays, dictionaries and anything non-scalar must go in the `info: properties:` block at
  `apple/project.yml:53`. Assert against the *built* plist, never the spec.
- **Push sync needed two halves**, and finding one hid the other: the plist key was dropped
  *and* nothing called `registerForRemoteNotifications`. Both are fixed (SHIP-01, SHIP-02) but
  neither can be proven without two devices on two Apple IDs — that is SHIP-15, and it is why
  SHIP-15 is sequenced before the rest of the owner list.
- **CI still does not type-check the Intelligence code.** `apple-ci.yml` now builds
  Release-CloudKit and asserts the built plist (QUA-01), but it runs on `macos-15` (Xcode 16.4),
  so `canImport(FoundationModels)` is false and ~700 lines of shipped, paid-tier Intelligence
  code are compiled by nothing automated. QUA-05 is the tripwire for it.
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
- **The public CloudKit database is billed to us, not to the customer.** The cost table in
  `COMMERCIALIZATION-PLAN.md` says bandwidth is free; that is true of the private database
  only. Anything that increases showcase traffic has a real cost line.

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
doing and the wrong one for predicting how long you will take — measured on this project, 44 agent
tasks estimated at 17.7 dev-days closed in about one working afternoon across three parallel
tracks. Do not report the sum as "work remaining"; it overstates it by a large factor.

Do not assume a fixed ratio either. Every task closed so far was under two dev-days, so the
compression is entirely unmeasured on the large ones — localisation, Swift 6 strict concurrency, a
UI test target, the PDF book. Those turn on design judgement and broad blast radius rather than
localised edits, and that is exactly where a human estimate is most likely to be honest.

## Where the real constraints are

Calendar time is dominated by two things no amount of work shortens: the Paid Applications
agreement with banking and tax forms (1–2 weeks, entirely outside the build queue), and the
external beta (~3 weeks, and it is the gate that decides whether the remaining
differentiation work is worth building). Both are in the ledger. Start them early.
