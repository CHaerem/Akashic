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
| Native build + tests | `cd apple && xcodegen generate && xcodebuild -project Akashic.xcodeproj -scheme Akashic -configuration Debug -destination "platform=iOS Simulator,id=$(xcrun simctl list devices available \| grep -o '[0-9A-F-]\{36\}' \| tail -1)" CODE_SIGNING_ALLOWED=NO test` | 599 tests, 0 failures, ~15 s warm |
| Native coverage | add `-enableCodeCoverage YES -resultBundlePath /tmp/cov.xcresult`, then `xcrun xccov view --report --only-targets /tmp/cov.xcresult` | app 28.4 %; `Views/` 5.9 % |
| Built Info.plist | `plutil -p "$(find ~/Library/Developer/Xcode/DerivedData/Akashic-*/Build/Products -name Akashic.app -maxdepth 3 \| head -1)/Info.plist"` | see the trap below |
| Web unit tests | `npx vitest --run` | 402 tests, ~4 s |
| Web typecheck | `npx tsc --noEmit` | **fails today, 117 errors** — see QUA-02 |
| Web lint | `npm run lint` | passes and proves nothing — see QUA-02 |
| Web build | `npm run build` | ~4 s, no env needed |
| Web e2e | `VITE_E2E_TEST_MODE=true CI=true npx playwright test --project=chromium --ignore-snapshots` | needs `.env.local` |
| Export tooling | `npx tsc -p scripts/export/tsconfig.json && node scripts/export/smoke.ts` | clean; 26 checks |
| Ledger | `npm run workplan:check` | ok |

Do not run `apple/Scripts/testflight-upload.sh` or `scripts/export/verifyExport.ts` — both
mutate things and need the owner's credentials. `verifyExport.ts` also overwrites the dated
verification report inside the archive bundle.

## Traps that have already cost real time

- **`INFOPLIST_KEY_*` in `apple/project.yml` silently drops keys.** Xcode honours a fixed
  allowlist. `CKSharingSupported` and `UIBackgroundModes` were declared this way and are
  absent from every build shipped so far, which killed CKShare acceptance and push sync.
  Arrays, dictionaries and anything non-scalar must go in the `info: properties:` block at
  `apple/project.yml:53`. Assert against the *built* plist, never the spec.
- **Push sync needs two halves.** There is no `registerForRemoteNotifications` call anywhere
  in the codebase, so the plist key alone does not revive it (SHIP-01, SHIP-02).
- **CI does not compile what ships.** `apple-ci.yml` builds only unsigned `Debug`, so the
  entitlement-carrying configurations and the plist merge are never exercised. CI also runs
  `macos-15` (Xcode 16.4), so `canImport(FoundationModels)` is false and ~700 lines of
  shipped Intelligence code have never been type-checked by anything automated.
- **Four web gates are open at once**, which is how 117 type errors accumulated:
  `eslint.config.js:9` globally ignores every `.ts`/`.tsx` file, lint-staged wraps `tsc` in
  `|| true`, CI sets `continue-on-error`, and there is no `typecheck` script.
- **Two workflows are red on main** and have been for several merges: Security Audit and
  Performance Tests. Do not read a red main as your own breakage — check QUA-03 and QUA-04.
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

## Where the real constraints are

The remaining distance to a paid v1.0 is roughly **48 agent-days and 8 owner-days**, but
calendar time is dominated by two things no amount of work shortens: the Paid Applications
agreement with banking and tax forms (1–2 weeks, entirely outside the build queue), and the
external beta (~3 weeks, and it is the gate that decides whether the remaining
differentiation work is worth building). Both are in the ledger. Start them early.
