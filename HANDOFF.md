# Handoff — branch `claude/remote-control-d38598` (updated 2026-07-30)

Written for the next session, because this branch is **22 commits ahead of `main` and exists only
locally**. Delete this file when the branch merges; it is a breadcrumb, not documentation.

**The branch this file was born on is no longer where the work lives.** It started as
`claude/project-review-code-ux-c5c48b`; on 2026-07-30 that branch was fast-forwarded into
`claude/remote-control-d38598` (a pure FF — the receiving branch had no commits of its own) so a
Remote-Control-reachable session could carry it on, and the two now-redundant worktrees under
`.claude/worktrees/` were removed. `claude/project-review-code-ux-c5c48b` still exists as a branch
and still points at `581591f`, which is an ancestor of this branch — nothing was lost, and nothing
lives there that is not here.

## What this branch is

A full project review (code quality + UX + map, with Polarsteps/market research), then the highest-value
findings implemented. The review itself is an Artifact:
<https://claude.ai/code/artifact/e9813153-fb28-4c2d-8db4-cd7153de5064>

Two things the review produced that are NOT in the artifact:

- **34 new ledger tasks** (`docs/workplan/tasks.json`) — every finding, with file:line evidence in its
  `why`. That is the authoritative list; the artifact is the readable version.
- **Corrections to two documents that had gone stale**: `CLAUDE.md` claimed QUA-49 was open (closed under
  QUA-58) and that the agent queue was nearly empty; `COMMERCIALIZATION-PLAN.md` §5b claimed Polarsteps
  has no collaborative trips (Travel Buddies since 2024).

## Closed here (13 tasks, each with its own commit)

| Area | Tasks |
|---|---|
| Multi-device data integrity (P0) | QUA-61 shared-engine UI refresh · QUA-62 Release ignores the DEBUG store override · QUA-63 nothing irreversible before the local commit · QUA-86 comment identity across devices |
| Conversion funnel | QUA-64 free-tier budget at the picker + draft protection · QUA-65 showcase link outlives the publish run |
| Built-but-unwired engines | QUA-70 Get Journey Photos · QUA-71 DIFF-05/08 wiring · QUA-77 the PDF book's entry point |
| Map / performance | QUA-66 sheet-aware day framing · QUA-67 story fetches + strip tap · QUA-68 lightbox bounded decode · QUA-69 04:00 day boundary |
| Web showcase | QUA-72 shared-link failure states · QUA-73 URL/history/title · QUA-74 precache 6.1 MB → 838 KB |

## Closed after the merge

- **`QUA-83`** (`aa59254`) — iOS photo clustering, camps win the tap again, coincident camps merged
  into one badge. **Read its ledger note before touching the map.** The clustering, clearance and
  camp-merging math is guarded by 15 pure tests in `MapMathTests`; the *tap-precedence* half is
  guarded by nothing, because the fix is declaration order inside a `@MapContentBuilder` and `prove`
  correctly refuses tests whose every symbol the fix introduced. That gap is `QUA-90`, and it is the
  first item below.

Gate at `49c68ae`, measured on the pinned iPhone 17 Pro: **941 unit (1 skipped) + 14 UI, 0 failures**;
web **691 tests / 54 files**, typecheck, lint and build clean; `npm run workplan:check` ok — 185 tasks.
The 926-unit figure this file used to carry was the pre-QUA-83 baseline; it was re-measured in this
tree after the fast-forward rather than inherited, which is the only reason the +15 can be trusted.

## Next, in the order the review ranked it

1. **`QUA-90`** — the guard QUA-83 could not provide: `accessibilityIdentifier`s for `CampBadge` and
   `PhotoMarker` in `A11yID.swift`, then a UI test that taps a camp badge with a photo geotagged on
   top of it. Provable in the way QUA-83's tests were not — reverting the two-line declaration-order
   swap is a cheap, honest RED to point `--against`.
2. **`QUA-87`** (reload republishes the whole library per edit), **`QUA-76`** (no fetch indexes),
   **`QUA-84`** (keyframe camera arcs + the 30 Hz spin timer).
3. **`QUA-89`** unassigned photos read as loss · **`QUA-88`** Norwegian data entry · **`QUA-75`/`QUA-82`** web.
4. **`DIFF-18` → `DIFF-19`** (replay → shareable flyover video). The measured market gap versus
   Polarsteps; `QUA-66` unblocked the framing it needs. `QUA-83`'s `zoom(forDistance:)` and the
   clustering grid are the pieces a replay's photo markers will want.

**Blocked, not forgotten:** `QUA-78`–`QUA-81` are the rest of the sync-integrity findings — including a
journey deletion that the owner's *second* device resurrects — and they all need
`apple/Akashic/Sync/AkashicSyncEngine.swift`, which `DIFF-16` (WIP) holds. Claim them the moment DIFF-16
closes; they are the ones SHIP-15 will otherwise hit as "sync is broken".

## Getting this branch into a fresh session

An app-spawned session usually branches a NEW worktree from the base commit, so it will not see any of
this. Either open the new session in **this** directory
(`.claude/worktrees/remote-control-d38598`), or:

```bash
git fetch origin claude/remote-control-d38598   # after the branch is pushed
```

Two things a fresh worktree needs before any command here means anything, both learned the slow way
on 2026-07-30: `npm ci` (a new worktree has no `node_modules`, and vitest simply cannot run), and
`cp /Users/cher/Privat/Akashic/.env* .` (gitignored, main checkout only, never copied by
`git worktree add`).

The conversations behind this branch are readable without a summary, through the session-management
tools (`list_events` / `search_session_transcripts`): the review that produced the 34 tasks is CLI
session `9f4ca580-506c-43b6-83b5-17ced5a1aea4`, and QUA-83 plus this cleanup was done from a
Remote-Control session on 2026-07-30.
