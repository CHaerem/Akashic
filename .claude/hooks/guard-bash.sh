#!/usr/bin/env bash
# PreToolUse guard on Bash. Turns three rules from CLAUDE.md that have each already cost real time
# from things an agent must remember into things the harness enforces.
#
# Exit 2 is the whole mechanism: it BLOCKS the tool call and feeds stderr back to the model. Exit 1
# does not block — it is treated as a non-fatal hook error and the command runs anyway — so a guard
# written with `exit 1` looks exactly like a working guard and stops nothing. That distinction is
# the single most important line in this file.
#
# Every block below names an escape hatch, because a guard with no way past it gets deleted the
# first time it is wrong, and then it protects nothing at all.

set -uo pipefail

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
[ -z "$cmd" ] && exit 0

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# ---------------------------------------------------------------- 1. `git add -A`
#
# CLAUDE.md: "When several agents work at once, commit with an explicit path list, never
# `git add -A` — someone else's half-finished file will otherwise ride along in your commit." This
# has happened. The variants matter as much as the canonical form: `-A`, `--all`, and a bare `.`
# all stage the whole tree, and a guard that only knows the first one is a guard that reads as
# present and is absent.
if printf '%s' "$cmd" | grep -Eq '(^|[;&|] *)git +add +([^;&|]* )?(-A\b|--all\b|\. *($|[;&|]))'; then
  cat >&2 <<'MSG'
BLOCKED: `git add -A` / `git add .` stages the whole tree.

Other agents work in parallel worktrees off this repo, and a whole-tree add is how a
half-finished file from someone else's task ends up inside your commit — which then makes
BOTH commits wrong, and the ledger entry for their work stays open while their code is gone.

Stage an explicit path list instead:
    git add docs/workplan/tasks.json WORKPLAN.md scripts/workplan.mjs

If you genuinely want everything and you have checked `git status --short`, run the add and
the commit in one command with GUARD_OK=1 set:
    GUARD_OK=1 git add -A
MSG
  printf '%s' "$cmd" | grep -q 'GUARD_OK=1' && exit 0
  exit 2
fi

# ------------------------------------------------- 2. the two scripts that mutate the owner's world
#
# CLAUDE.md: "Do not run apple/Scripts/testflight-upload.sh or scripts/export/verifyExport.ts —
# both mutate things and need the owner's credentials. verifyExport.ts also overwrites the dated
# verification report inside the archive bundle."
#
# The check is deliberately crude — the path appearing anywhere in the command — with one carve-out:
# if the command STARTS with a reader, it is talking about the script rather than running it, which
# is what `grep -rn verifyExport docs/` does and what this must not block. Neither script appears in
# any task's `verify` list (checked), so nothing in the ledger needs this to be permissive.
if printf '%s' "$cmd" | grep -Eq 'testflight-upload\.sh|verifyExport\.ts'; then
  first=$(printf '%s' "$cmd" | awk '{print $1}')
  case "$first" in
    grep|rg|cat|head|tail|less|wc|ls|find|git|awk|sed|echo|python3) exit 0 ;;
  esac
  cat >&2 <<'MSG'
BLOCKED: this script mutates something outside the repo and needs the owner's credentials.

  apple/Scripts/testflight-upload.sh   uploads a build to App Store Connect
  scripts/export/verifyExport.ts       OVERWRITES the dated verification report inside the
                                       archive bundle, destroying the previous record

Both are owner tasks in the ledger (`owner: true`). Read them, quote them, reason about them —
but the owner runs them. For export tooling, the safe equivalents are:
    npx tsc -p scripts/export/tsconfig.json && node scripts/export/smoke.ts
MSG
  exit 2
fi

# --------------------------------------------- 3. a commit carrying someone else's rename or delete
#
# CLAUDE.md: "`git mv` and `git rm` stage themselves immediately, so a concurrent agent's file move
# lands in YOUR commit no matter how careful your `git add` is. Run `git status --short` before
# committing and look for R/D in the first column."
#
# A hook cannot know whether a staged delete is yours — intent is not in the index. So this does not
# try to judge; it makes the check that CLAUDE.md asks for happen, prints what it found, and asks
# once. A commit that legitimately deletes files passes on the second attempt with GUARD_OK=1, which
# costs one round-trip and is the whole point: the trap is silent, and this makes it loud.
if printf '%s' "$cmd" | grep -Eq '(^|[;&|] *)git +([^;&|]* )?commit\b'; then
  printf '%s' "$cmd" | grep -q 'GUARD_OK=1' && exit 0
  staged=$(git -C "$root" diff --cached --name-status --diff-filter=RD 2>/dev/null)
  if [ -n "$staged" ]; then
    {
      echo "BLOCKED once: this commit stages renames or deletions."
      echo
      echo "$staged" | sed 's/^/    /'
      echo
      cat <<'MSG'
`git mv` and `git rm` stage themselves the moment they run, including from another agent's
worktree, so these may not be yours. If they are not, hand them back to their owner:
    git restore --staged <path>
and say so in your report — the ledger entry for that work is still open.

If they ARE yours, re-run the same commit with GUARD_OK=1 prefixed.
MSG
    } >&2
    exit 2
  fi
fi

exit 0
