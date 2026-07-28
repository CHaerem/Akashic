#!/usr/bin/env node
/**
 * Prove a test can actually fail — mechanically, in a throwaway worktree.
 *
 * ## The failure class this exists to make impossible
 *
 * A process review named it exactly: **a claim decoupled from the mechanism that would make it true.** The
 * commonest instance in this repo is a regression test decoupled from the code path it is supposed to guard,
 * and it has happened three times:
 *
 * - QUA-47 shipped 28 tests for an imagery clamp. Every one called `clampToImageryBand`, `regionForBounds` or
 *   `regionForZoom` DIRECTLY. Deleting the clamp from all four camera call sites — a complete revert of the
 *   user-visible fix — left 678/678 green, typecheck clean and lint at its cap.
 * - QUA-45 shipped 15 tests for `verifyPresence`. The `.task` that CALLS it lives in a SwiftUI body no unit
 *   test reaches. Deleting that block left all 841 native tests green while the sheet never asked the mirror.
 * - Earlier, a bundle guard's marker was a decorative constant the bundler inlined away, so it reported
 *   success on a build that plainly contained what it was guarding against.
 *
 * All three passed the only test a cannot-fail test excels at: passing. The implementer certifying its own
 * test cannot detect this, because "my test passes and looks plausible" is not self-detecting. Adversarial
 * review caught all three — at full price, three times, reactively.
 *
 * ## What this does instead
 *
 *   new tests + OLD product code  ->  must be RED
 *   new tests + NEW product code  ->  must be GREEN
 *
 * Both halves are required. The first is the one nobody runs; the second stops a test that fails for an
 * unrelated reason from counting as proof.
 *
 * ## Why an ephemeral worktree, and not a stash or an in-place revert
 *
 * Because in-place mutation-for-proof has already gone wrong here. An agent reverted a fix in the SHARED tree
 * to demonstrate its test, reported success, and left the revert behind — `verification = .onShowcase(slug:
 * slug); return` under a `// DEFECT 4 REINTRODUCED` comment. The original defect shipped, verbatim. It
 * survived its own verification because a stale simulator test binary reported 0 failures with the residue
 * present.
 *
 * A detached worktree under `/tmp` cannot leak into the tree you are committing from, so that incident class
 * is closed by construction rather than by remembering to restore. `git stash` would not do: it leaves
 * untracked files behind, which is separately how a byte-count baseline came out flattering enough that three
 * passes disagreed about it.
 *
 * ## Usage
 *
 *   node scripts/prove.mjs --tests <pattern> --revert <path>[,<path>...] [--against <ref>] [--native]
 *
 *   # QUA-47: the imagery clamp's wiring
 *   node scripts/prove.mjs \
 *     --tests src/lib/map/mapkit/useMapKitJourney.test.ts \
 *     --revert src/lib/map/mapkit/useMapKitJourney.ts,src/lib/map/imagery.ts
 *
 * `--revert` names the PRODUCT files whose change the tests are supposed to detect. The test files named by
 * `--tests` are carried over from the working tree, so the new tests run against the old product code. That
 * asymmetry is the whole mechanism: reverting the tests too would prove nothing.
 *
 * `--against` defaults to HEAD, which is right while the fix is uncommitted. For an already-committed fix,
 * pass the commit before it.
 *
 * Exit 0 only when both directions hold. Prints a receipt suitable for `workplan done --evidence`.
 */

import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const testPattern = flag('tests');
const revertList = (flag('revert') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const against = flag('against') ?? 'HEAD';
const native = has('native');

function die(message) {
    console.error(`\n✗ ${message}\n`);
    process.exit(2);
}

if (!testPattern) die('--tests is required: the test file(s) whose ability to fail is being proven');
if (!revertList.length) {
    die('--revert is required: the PRODUCT file(s) whose change these tests are supposed to detect.\n'
        + '  Without it there is nothing to take away, and "the tests pass" is not proof of anything.');
}

const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

// Refuse to run against a ref that does not contain the files we are asked to revert — otherwise the
// "reverted" worktree simply lacks them, every import fails, and the red we demand is a red about nothing.
for (const path of revertList) {
    try {
        execFileSync('git', ['cat-file', '-e', `${against}:${path}`], { cwd: repo, stdio: 'pipe' });
    } catch {
        die(`${path} does not exist at ${against}, so reverting to it would delete the file rather than undo `
            + `the fix. A red run would then prove only that the import broke. Pass --against <the commit `
            + `before the fix>.`);
    }
}

const scratch = mkdtempSync(join(tmpdir(), 'akashic-prove-'));
const worktree = join(scratch, 'wt');
let created = false;

function run(command, cwd) {
    try {
        const stdout = execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, out: stdout };
    } catch (err) {
        return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
}

/**
 * How many tests actually RAN, and how many failed.
 *
 * This exists because of a defect in this very script, caught by its own negative control on first use. A
 * suite that only exercised pure helpers was reported as "proven in both directions": the reverted run did
 * exit 1, but with `collect 0ms, tests 0ms` — the test file imported a module that did not exist at the
 * revert point, so the import threw and NOTHING RAN. A red for a broken import is not evidence that an
 * assertion can fail, and treating it as such is exactly the claim-decoupled-from-mechanism failure this
 * script was written to make impossible. So the proof now requires a real failing assertion.
 */
function counts(out) {
    const v = out.match(/Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed/);
    if (v) return { failed: Number(v[1] ?? 0), passed: Number(v[2]), ran: Number(v[1] ?? 0) + Number(v[2]) };
    const vf = out.match(/Tests\s+(\d+) failed(?!\s*\|)/);
    if (vf) return { failed: Number(vf[1]), passed: 0, ran: Number(vf[1]) };
    const x = out.match(/Executed (\d+) tests?, with (?:\d+ tests? skipped and )?(\d+) failures?/);
    if (x) return { failed: Number(x[2]), passed: Number(x[1]) - Number(x[2]), ran: Number(x[1]) };
    return { failed: 0, passed: 0, ran: 0 };
}

/** The count line, so the receipt says what actually ran rather than only whether it was green. */
function summarise(out) {
    // Match the SUMMARY line specifically. A looser /Tests\s+(.+)/ catches vitest's failure banner
    // ("⎯⎯ Failed Tests 2 ⎯⎯") and puts box-drawing characters in the receipt instead of a count.
    const vitest = out.match(/Tests\s+(\d+ failed \| \d+ passed.*|\d+ passed.*|\d+ failed.*)$/m);
    const xc = out.match(/Executed (\d+) tests?, with (\d+) failures?/);
    if (vitest) return vitest[1].trim();
    if (xc) return `${xc[1]} native tests, ${xc[2]} failures`;
    const tail = out.trim().split('\n').filter(Boolean).at(-1) ?? '';
    return tail.slice(0, 90);
}

const testCommand = native
    ? `cd apple && xcodegen generate >/dev/null && xcodebuild -project Akashic.xcodeproj -scheme Akashic `
      + `-configuration Debug -destination "platform=iOS Simulator,name=iPhone 17 Pro" `
      + `CODE_SIGNING_ALLOWED=NO test -only-testing:${testPattern} 2>&1`
    : `npx vitest --run ${testPattern} 2>&1`;

/**
 * Remove the worktree and the scratch directory. Idempotent, and registered on SIGNALS as well as run from
 * `finally`.
 *
 * The signal handlers are not defensive programming, they are a measured fix. Two dead worktrees accumulated
 * during this script's own development, and the cause was piping its output: `node scripts/prove.mjs | tail`
 * gives the process SIGPIPE the moment `tail` exits, the process dies, and `finally` NEVER COMPLETES. So the
 * directory survived, and `git worktree prune` then correctly refused to deregister a worktree that is still
 * there — leaving two entries visible only to `git worktree list`, which nobody runs.
 *
 * A cleanup that only runs on the happy path is the same shape as a test that only passes: it looks like a
 * mechanism and is not one.
 */
let cleanedUp = false;
function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    if (created) {
        try { execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repo, stdio: 'pipe' }); }
        catch { /* the rm + prune below are the backstop */ }
    }
    rmSync(scratch, { recursive: true, force: true });
    // `prune` is load-bearing rather than tidy: removing the DIRECTORY leaves git's worktree REGISTRY entry
    // behind. And plain `prune` is not enough — it honours gc.worktreePruneExpire, three months by default, so
    // a registration made seconds ago is exempt. `--expire now` is the difference between a cleanup that runs
    // and one that merely looks like it does.
    if (created) {
        try { execFileSync('git', ['worktree', 'prune', '--expire', 'now'], { cwd: repo, stdio: 'pipe' }); }
        catch { /* nothing further to try */ }
    }
}

// `process.exit()` DOES NOT RUN `finally` BLOCKS, and both rejection paths below call it — so the negative
// control leaked a worktree on its very first use, after the signal handlers were already in place. An exit
// handler is the only one of these that covers a deliberate early exit as well as a signal.
process.on('exit', cleanup);

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGPIPE']) {
    process.on(signal, () => { cleanup(); process.exit(130); });
}
process.on('uncaughtException', (err) => { cleanup(); console.error(err); process.exit(1); });
// EPIPE arrives as a write error rather than a signal when stdout is a closed pipe.
process.stdout.on('error', (err) => { if (err.code === 'EPIPE') { cleanup(); process.exit(0); } });

try {
    console.log(`prove: ${testPattern}`);
    console.log(`  taking away: ${revertList.join(', ')}`);
    console.log(`  reverting to: ${against}\n`);

    // ---- direction 1: the tests must PASS as things stand, or nothing below means anything ----
    const green = run(testCommand, repo);
    console.log(`  HEAD          exit ${green.code}  ${summarise(green.out)}`);
    if (green.code !== 0) {
        die('the tests do not pass on the current tree, so their failure under revert would prove nothing.\n'
            + '  Fix the tests first, then prove them.');
    }

    // ---- direction 2: new tests against OLD product code must FAIL ----
    execFileSync('git', ['worktree', 'add', '--detach', worktree, against],
        { cwd: repo, stdio: 'pipe' });
    created = true;

    // node_modules is enormous and identical; symlink rather than install.
    const modules = join(repo, 'node_modules');
    if (existsSync(modules)) execFileSync('ln', ['-s', modules, join(worktree, 'node_modules')]);
    for (const env of ['.env', '.env.local']) {
        if (existsSync(join(repo, env))) copyFileSync(join(repo, env), join(worktree, env));
    }

    // Carry the NEW tests into the OLD tree. This asymmetry is the mechanism: revert the product, keep the
    // tests. `--tests` may be a directory or a glob, so resolve it through git rather than guessing.
    const testFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', testPattern],
        { cwd: repo, encoding: 'utf8' }).split('\n').filter(Boolean);
    if (!testFiles.length) die(`--tests "${testPattern}" matched no files under git`);
    for (const file of testFiles) {
        const target = join(worktree, file);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(repo, file), target);
    }
    console.log(`  carried ${testFiles.length} test file(s) into the reverted worktree`);

    const red = run(testCommand, worktree);
    console.log(`  ${against.padEnd(13)} exit ${red.code}  ${summarise(red.out)}`);

    const redCounts = counts(red.out);
    if (red.code !== 0 && redCounts.ran === 0) {
        console.error(`
✗ THE REVERTED RUN FAILED WITHOUT RUNNING ANY TEST.

  exit ${red.code}, but ${redCounts.ran} tests collected — so this is a load or import error, not a failing
  assertion. Almost always: the test file imports a module that does not exist at ${against}, because the fix
  ADDED it. A red for a broken import proves nothing about whether the assertions can fail.

  Point --against at a commit where every module the test imports already exists, or move the assertions into
  a test file that only imports pre-existing modules.
`);
        process.exit(1);
    }

    if (red.code === 0) {
        console.error(`
✗ THE TESTS PASS WITHOUT THE FIX.

  Taking away ${revertList.join(', ')} changed nothing they can see, so they do not guard the change they
  were written for. That is the QUA-47 shape: assertions that call the pure helper directly while the
  product wiring goes untested, and a full revert stays green.

  Assert on the seam the user's behaviour actually flows through, not on the function you just wrote.
`);
        process.exit(1);
    }

    console.log(`
✓ proven in both directions.

  receipt: ${redCounts.failed} of ${redCounts.ran} assertion(s) FAILED against ${against}, and
           ${summarise(green.out)} on the current tree; took away ${revertList.join(', ')}
`);
} finally {
    cleanup();
}
