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
 *   node scripts/prove.mjs --tests <pattern> --revert <path>[,<path>...] [--against <ref>]
 *   node scripts/prove.mjs --tests <pattern> --revert <path>[,...] --native --only-testing <Target/Class>[,...]
 *
 *   # QUA-47: the imagery clamp's wiring
 *   node scripts/prove.mjs \
 *     --tests src/lib/map/mapkit/useMapKitJourney.test.ts \
 *     --revert src/lib/map/mapkit/useMapKitJourney.ts,src/lib/map/imagery.ts
 *
 *   # DIFF-15: the first-sync size estimate, natively
 *   node scripts/prove.mjs \
 *     --tests apple/AkashicTests/SyncSizeEstimateTests.swift \
 *     --revert apple/Akashic/Sync/SyncDownloadPrompt.swift \
 *     --against 7ede7ad~1 --native --only-testing AkashicTests/SyncSizeEstimateTests
 *
 * `--revert` names the PRODUCT files whose change the tests are supposed to detect. The test files named by
 * `--tests` are carried over from the working tree, so the new tests run against the old product code. That
 * asymmetry is the whole mechanism: reverting the tests too would prove nothing.
 *
 * `--against` defaults to HEAD, which is right while the fix is uncommitted. For an already-committed fix,
 * pass the commit before it.
 *
 * Exit 0 only when both directions hold. Prints a receipt suitable for `workplan done --evidence`.
 *
 * ## Why --native needs the tests named TWICE (QUA-57)
 *
 * `--tests` is a git pathspec — it is what carries the new test files into the reverted worktree. xcodebuild's
 * `-only-testing:` takes a TARGET/CLASS[/method] identifier. No string is both, and this script's first native
 * use demonstrated both halves of the confusion: a path yielded `-only-testing:apple/AkashicTests/Foo.swift`
 * and "Tests in the target 'apple' can't be run", while an identifier matched no files under git, so the new
 * tests were never carried over and the reverted run tested the old tree against itself. Either way the RED run
 * dies on an environment error rather than a failing assertion, which the counts() guard below correctly refuses
 * — loud, but unusable.
 *
 * Deriving the identifier from the file's basename is the tempting fix and it LIES: a file holding two test
 * classes maps to two identifiers, a class can be renamed without renaming its file, and `-only-testing` also
 * accepts a whole target or a single method. Two explicit flags cannot lie, so `--only-testing` is REQUIRED
 * whenever `--native` is set, and a value that looks like a path is refused rather than interpolated.
 *
 * ## The native red must be an ASSERTION failure, not a compile error
 *
 * This is the subtle half, and it is the same failure the counts() guard was written for on the web side. A new
 * test file that references symbols the fix INTRODUCED cannot compile against the revert; xcodebuild then fails
 * before running anything, and a red that is really a build error proves nothing about whether the assertions
 * can fail. Measured on DIFF-15's own test files: `SyncSizeEstimateTests` touches only `SyncSizeEstimate`, which
 * predates the fix, so it compiles against `7ede7ad~1` and fails on gigabytes-versus-megabytes assertions;
 * `DeferredDownloadPreviewTests` references `RemoteJourneySummary`, which appears nowhere before the fix, so it
 * fails to build. The first is proof, the second is refused with the reason named.
 *
 * Two native details that are load-bearing rather than tidy. `apple/Akashic.xcodeproj` is GENERATED and not
 * committed (`apple/.gitignore:2`), so the throwaway worktree must run `xcodegen generate` before any
 * xcodebuild or it looks like a broken checkout. And the two runs share one simulator, where `xcodebuild test`
 * can silently reuse a stale `.xctest` — the exact mechanism by which the incident above ("reported success
 * with the revert still present") survived its own verification. So each run uninstalls the app first.
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
const onlyTesting = (flag('only-testing') ?? '').split(',').map(s => s.trim()).filter(Boolean);

function die(message) {
    console.error(`\n✗ ${message}\n`);
    process.exit(2);
}

if (!testPattern) die('--tests is required: the test file(s) whose ability to fail is being proven');
if (!revertList.length) {
    die('--revert is required: the PRODUCT file(s) whose change these tests are supposed to detect.\n'
        + '  Without it there is nothing to take away, and "the tests pass" is not proof of anything.');
}

if (native && !onlyTesting.length) {
    die('--only-testing is required with --native: the xcodebuild TARGET/CLASS identifier(s) to run.\n'
        + '  --tests stays a git pathspec (it is what carries the new tests into the reverted worktree);\n'
        + '  -only-testing needs an identifier, and no string is both. For example:\n'
        + '    --tests apple/AkashicTests/SyncSizeEstimateTests.swift \\\n'
        + '    --only-testing AkashicTests/SyncSizeEstimateTests');
}
if (!native && onlyTesting.length) {
    die('--only-testing only applies to --native (vitest takes the file patterns in --tests directly).\n'
        + '  Add --native, or drop --only-testing so the run cannot silently ignore it.');
}

const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

// A path where an identifier belongs is QUA-57's exact defect, and xcodebuild's own diagnostic for it
// ("Tests in the target 'apple' can't be run") names a target nobody typed, so it reads like a project
// misconfiguration. Refuse it here, where the remedy is obvious. The tell is a `.swift` suffix or a first
// segment that is a real directory in the repo — a target name never is, since targets live under `apple/`.
for (const id of onlyTesting) {
    const firstSegment = id.split('/')[0];
    if (id.endsWith('.swift') || existsSync(join(repo, firstSegment))) {
        die(`--only-testing "${id}" looks like a file path. It must be an xcodebuild test identifier:\n`
            + `    <Target>[/<Class>[/<testMethod>]]   e.g. AkashicTests/SyncSizeEstimateTests\n`
            + `  The file path belongs in --tests, which is a git pathspec. That is the whole point of the\n`
            + `  two flags: interpolating a path here gives "Tests in the target '${firstSegment}' can't be run".`);
    }
}

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
        // execSync's default maxBuffer is 1 MiB, and exceeding it KILLS the child and throws ENOBUFS with
        // truncated stdout — which here would look like a test run that failed for no stated reason, since
        // every count line is printed at the very end. Measured: a cold build plus FOUR tests is 552 KB, so
        // the default is not a comfortable margin, it is the same order of magnitude as an ordinary run. The
        // limit wants to be larger than any log we could produce, not than the last one measured.
        const stdout = execSync(command, {
            cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024,
        });
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
    const x = nativeExecuted(out);
    if (x) return x;
    return { failed: 0, passed: 0, ran: 0 };
}

/**
 * xcodebuild's own totals for a native run.
 *
 * Two things here were measured off a real log (2291 lines, 552 KB, four tests against `7ede7ad~1`) after
 * guessing both of them wrong, and each guess produces a plausible-looking wrong number rather than an error:
 *
 * 1. **The roll-up suite is named 'Selected tests', not 'All tests', under `-only-testing`** — and since
 *    `--only-testing` is required here, 'All tests' never appears in any log this script produces. xcodebuild
 *    prints `Executed N tests, with M failures` for EVERY suite (the class, the `.xctest` bundle, then the
 *    roll-up), so keying on the wrong roll-up name silently falls through to whichever line is picked as a
 *    fallback. Both names are matched now; the last-bare-line fallback stays, because the log format is
 *    Xcode's to change and a receipt with a loose count beats one with no count.
 * 2. **`with M failures` counts FAILING ASSERTIONS, not failed tests.** The measured run reads
 *    `Executed 4 tests, with 4 failures` and its per-case lines are three failed and one PASSED — one test
 *    failed two assertions. So `ran - failed` is not the number that passed, and with a test that fails
 *    several assertions it can go negative. Failed tests are counted from the per-case lines instead.
 */
function nativeExecuted(out) {
    const rollups = [...out.matchAll(
        /Test Suite '(?:All|Selected) tests' (?:passed|failed) at [^\n]*\n\s*Executed (\d+) tests?, with (?:(\d+) tests? skipped and )?(\d+) failures?/g)];
    const totals = rollups.length
        ? { ran: rollups.reduce((n, m) => n + Number(m[1]), 0),
            failed: rollups.reduce((n, m) => n + Number(m[3]), 0) }
        : undefined;
    const bare = [...out.matchAll(/Executed (\d+) tests?, with (?:(\d+) tests? skipped and )?(\d+) failures?/g)];
    const fallback = bare.length
        ? { ran: Number(bare.at(-1)[1]), failed: Number(bare.at(-1)[3]) }
        : undefined;
    const t = totals ?? fallback;
    if (!t) return undefined;
    const failedTests = [...out.matchAll(/Test Case '[^']+' failed \(/g)].length;
    return { failed: t.failed, failedTests, passed: Math.max(0, t.ran - failedTests), ran: t.ran };
}

/**
 * Why a native run executed nothing — quoted back verbatim, because the remedy depends entirely on which of
 * these it is: a compile error against the revert, a bad `-only-testing` identifier, a missing simulator.
 *
 * Callers MUST gate this on "no tests ran". It cannot be used to detect a build failure on its own, because
 * XCTest reports a failed assertion with the same `error:` prefix a compiler uses
 * (`…Tests.swift:31: error: -[AkashicTests.SyncSizeEstimateTests testX] : XCTAssertLessThan failed`), so
 * grepping for `error:` calls a perfectly good red a build failure. Whether any test executed is the only
 * discriminator that does not depend on parsing Xcode's prose.
 */
function whyNothingRan(out) {
    const lines = out.split('\n');
    const errors = lines.filter(l => /(?:^|\s)(?:error|fatal error):/.test(l)
        // xcodebuild's environment complaints carry no `error:` prefix at all. The first is QUA-57's own
        // symptom, worth naming even though the flag validation above should now prevent it.
        || /Tests in the target '.*' can't be run/.test(l)
        || /Unable to find a destination matching/.test(l)
        || /The following build commands failed/.test(l));
    return errors.map(l => l.trim()).filter(Boolean).slice(0, 8);
}

/** The count line, so the receipt says what actually ran rather than only whether it was green. */
function summarise(out) {
    // Match the SUMMARY line specifically. A looser /Tests\s+(.+)/ catches vitest's failure banner
    // ("⎯⎯ Failed Tests 2 ⎯⎯") and puts box-drawing characters in the receipt instead of a count.
    const vitest = out.match(/Tests\s+(\d+ failed \| \d+ passed.*|\d+ passed.*|\d+ failed.*)$/m);
    if (vitest) return vitest[1].trim();
    const xc = nativeExecuted(out);
    if (xc) return `${xc.ran} native tests, ${xc.failed} failures`;
    // A native run that executed NOTHING has to say so rather than fall through to the tail line. Measured on
    // the negative control (DeferredDownloadPreviewTests against 7ede7ad~1): the last line of a failed test
    // build is `(3 failures)` — xcodebuild counting something that is not tests, since zero tests ran — and
    // the status line presented it as three failing tests. That is the exact class of wrong number this file
    // exists to prevent, sitting in its own output.
    if (native) return 'no tests ran — the build failed';
    const tail = out.trim().split('\n').filter(Boolean).at(-1) ?? '';
    return tail.slice(0, 90);
}

const SIMULATOR = 'iPhone 17 Pro';
const BUNDLE_ID = 'no.akashic.app';

/**
 * The command that runs the tests in a given tree.
 *
 * `derivedData` is passed only for the throwaway worktree, and for two reasons. Xcode keys DerivedData by
 * workspace path, so a detached worktree under /tmp would otherwise leave a ~400 MB directory behind in
 * ~/Library after the worktree it belongs to is gone — there were eleven `Akashic-*` directories on this
 * machine when this was written, and `find DerivedData/Akashic-* | head -1` handing you another tree's build
 * is a trap that has already cost real time here. Putting it inside the scratch dir means cleanup() removes
 * it with everything else. The HEAD run keeps the default location, where it is warm.
 */
function testCommand(derivedData) {
    if (!native) return `npx vitest --run ${testPattern} 2>&1`;
    const onlyFlags = onlyTesting.map(id => `-only-testing:${id}`).join(' ');
    const dd = derivedData ? `-derivedDataPath ${derivedData} ` : '';
    // The uninstall is not hygiene: `xcodebuild test` can silently reuse a stale `.xctest` already on the
    // simulator, and both runs here install the same bundle id from different source trees. That is precisely
    // how the incident in this file's header ("reported success with the revert still present") passed its own
    // verification. `|| true` because the app is legitimately absent on a clean simulator.
    return `xcrun simctl uninstall "${SIMULATOR}" ${BUNDLE_ID} 2>/dev/null || true; `
        // `apple/Akashic.xcodeproj` is generated and not committed, so the reverted worktree has no project
        // at all until this runs. Without it the failure looks like a broken checkout rather than a missing step.
        + `cd apple && xcodegen generate >/dev/null && xcodebuild -project Akashic.xcodeproj -scheme Akashic `
        + `-configuration Debug -destination "platform=iOS Simulator,name=${SIMULATOR}" `
        + `${dd}CODE_SIGNING_ALLOWED=NO test ${onlyFlags} 2>&1`;
}

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
    if (native) console.log(`  running: ${onlyTesting.map(id => `-only-testing:${id}`).join(' ')}`);
    console.log(`  taking away: ${revertList.join(', ')}`);
    console.log(`  reverting to: ${against}\n`);

    // ---- direction 1: the tests must PASS as things stand, or nothing below means anything ----
    const green = run(testCommand(), repo);
    console.log(`  HEAD          exit ${green.code}  ${summarise(green.out)}`);
    if (green.code !== 0) {
        // "Fix the tests first" is the wrong remedy when nothing ran: on the current tree that means the
        // build, the identifier or the simulator, and none of those is a test to fix.
        if (native && counts(green.out).ran === 0) {
            die('the run on the CURRENT tree executed no tests at all, so this is an environment failure and\n'
                + '  not a statement about the tests. Likely: an --only-testing identifier that names no test,\n'
                + `  a simulator named "${SIMULATOR}" that is unavailable, or a build error. What it said:\n`
                + whyNothingRan(green.out).map(l => `    ${l}`).join('\n'));
        }
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

    const red = run(testCommand(join(scratch, 'dd')), worktree);
    console.log(`  ${against.padEnd(13)} exit ${red.code}  ${summarise(red.out)}`);

    const redCounts = counts(red.out);
    if (red.code !== 0 && redCounts.ran === 0) {
        const detail = native ? whyNothingRan(red.out) : [];
        console.error(`
✗ THE REVERTED RUN FAILED WITHOUT RUNNING ANY TEST.

  exit ${red.code}, but ${redCounts.ran} tests collected — so this is a ${native ? 'BUILD' : 'load or import'} error, not a failing
  assertion. Almost always: the test file ${native ? 'references a symbol' : 'imports a module'} that does not exist at ${against},
  because the fix ADDED it. A red for a ${native ? 'build failure' : 'broken import'} proves nothing about whether the assertions can fail.
${detail.length ? `\n  What the build said:\n${detail.map(l => `    ${l}`).join('\n')}\n` : ''}
  Point --against at a commit where every symbol the test names already exists, or move the assertions into
  a test file that only names pre-existing ones. ${native ? '(DIFF-15 did exactly that: SyncSizeEstimateTests\n  was split out from DeferredDownloadPreviewTests so the estimate stayed provable.)' : ''}
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

    // The receipt is what gets pasted into `workplan done --evidence`, so it is the worst possible place for a
    // number that means something other than what it says. Native and vitest count differently — xcodebuild's
    // "M failures" is failing ASSERTIONS while vitest's "N failed" is failing TESTS — so each gets the phrasing
    // that is true of its own numbers rather than one sentence that is only true of one of them.
    const redReceipt = native
        ? `${redCounts.failed} failing assertion(s) in ${redCounts.failedTests} of ${redCounts.ran} test(s)`
        : `${redCounts.failed} of ${redCounts.ran} assertion(s) FAILED`;
    console.log(`
✓ proven in both directions.

  receipt: ${redReceipt} against ${against}, and
           ${summarise(green.out)} on the current tree; took away ${revertList.join(', ')}
`);
} finally {
    cleanup();
}
