# Handoff — branch `claude/project-review-code-ux-c5c48b` (2026-07-29)

Written for the next session, because this branch is **18 commits ahead of `main` and exists only
locally**. Delete this file when the branch merges; it is a breadcrumb, not documentation.

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

Gate at `12170bc`, measured on the pinned iPhone 17 Pro: **926 unit (1 skipped) + 14 UI, 0 failures**;
web **691 tests / 54 files**, typecheck, lint and build clean; `npm run workplan:check` ok.

## Next, in the order the review ranked it

1. **`QUA-83`** — iOS photo clustering + camp-over-photo tap precedence. The unfixed iOS twin of web
   QUA-49, and the biggest single map-quality win left.
2. **`QUA-87`** (reload republishes the whole library per edit), **`QUA-76`** (no fetch indexes),
   **`QUA-84`** (keyframe camera arcs + the 30 Hz spin timer).
3. **`QUA-89`** unassigned photos read as loss · **`QUA-88`** Norwegian data entry · **`QUA-75`/`QUA-82`** web.
4. **`DIFF-18` → `DIFF-19`** (replay → shareable flyover video). The measured market gap versus
   Polarsteps; `QUA-66` unblocked the framing it needs.

**Blocked, not forgotten:** `QUA-78`–`QUA-81` are the rest of the sync-integrity findings — including a
journey deletion that the owner's *second* device resurrects — and they all need
`apple/Akashic/Sync/AkashicSyncEngine.swift`, which `DIFF-16` (WIP) holds. Claim them the moment DIFF-16
closes; they are the ones SHIP-15 will otherwise hit as "sync is broken".

## Getting this branch into a fresh session

An app-spawned session usually branches a NEW worktree from the base commit, so it will not see any of
this. Either open the new session in **this** directory, or:

```bash
git fetch origin claude/project-review-code-ux-c5c48b   # after the branch is pushed
```

The conversation itself is readable without a summary: this session's transcript can be fetched by id
through the session-management tools (`list_events` / `search_session_transcripts`), and the CLI session
id is `9f4ca580-506c-43b6-83b5-17ced5a1aea4`.
