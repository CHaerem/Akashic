#!/usr/bin/env node
/**
 * Assertions about the BUILT bundle. Two of them now:
 *   1. the E2E fixture is absent (QUA-40)
 *   2. no debug console output ships (QUA-44)
 *
 * Both are the same kind of claim — something must not be in dist/ — and this file is the
 * only dist/ scanner wired into CI (.github/workflows/test.yml:184) *and* the deploy path
 * (deploy-pages.yml:90), which is where a guard like this has to run. A second script would
 * have needed both workflows edited to be worth anything.
 *
 * --- 1. THE E2E FIXTURE (QUA-40) ---
 *
 * WHY THIS IS A SCRIPT AND NOT A SENTENCE. `src/lib/cloudkit.ts` reaches the fixture
 * through `await import(...)` inside a branch guarded by
 * `import.meta.env.VITE_E2E_TEST_MODE === 'true'`. Vite constant-folds that expression at
 * build time, so with the variable unset the branch is dead and Rollup drops the whole
 * dynamic-import subgraph. MEASURED in this tree: with the flag unset the marker appears
 * nowhere in `dist/` and no fixture chunk is emitted; with `VITE_E2E_TEST_MODE=true` the
 * marker lands in `dist/assets/*.js`. So the elimination works — but "the bundler removes
 * it" is exactly the class of build-tool belief this project has been burned by
 * (`INFOPLIST_KEY_*` was declared correctly and silently dropped from every shipped
 * plist; warning counts read off incremental builds were confidently wrong twice). An
 * assertion goes red; a sentence goes quietly stale.
 *
 * WHAT GOES WRONG IF THIS IS SKIPPED. A production build made with the flag set does not
 * merely skip the sign-in pill any more — it serves entirely fabricated journeys and never
 * contacts CloudKit, on a site that renders beautifully and passes a smoke check. That is
 * why this runs on the DEPLOY path, not only in web CI: `scripts/build.js` forwards the
 * whole `process.env` into `vite build`, and Vite additionally auto-loads `.env` /
 * `.env.local`, so an ambient flag reaches a build without any workflow referencing it.
 *
 * One correction to a claim worth not repeating: a GitHub *repository variable* named
 * VITE_E2E_TEST_MODE would NOT by itself reach the production build. Repo vars only exist
 * via an explicit `${{ vars.X }}` reference, and `deploy-pages.yml` never references it.
 * The real leak paths are the ambient environment and dotenv files above.
 *
 * --- 2. DEBUG CONSOLE OUTPUT (QUA-44) ---
 *
 * MEASURED on the live site 2026-07-27: https://akashic.no printed sixteen lines of
 * "[MapboxGlobe camera effect] …" before the globe settled, from four console.log calls in
 * src/components/MapboxGlobe.tsx that nobody meant to ship. The fix is a build setting
 * (`esbuild.pure` in vite.config.js), not four deletions, so the fifth call somebody adds
 * while debugging cannot ship either. This guard is what proves the setting is still there
 * and still working — a config key can be dropped in a merge as easily as a log can be added.
 *
 * The measurement trap that nearly produced the opposite conclusion, and the reason this
 * walks the whole tree: grepping the served assets/index-*.js for the needle returns ZERO
 * both before and after the fix. The calls were in assets/AkashicApp-*.js. One chunk proves
 * nothing about chunked output.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: console.warn and console.error, which carry real
 * diagnostics — the CloudKit adapter's error path is how QUA-40 was diagnosed at all. They
 * survive the build setting on purpose (measured after the change: 18 console.error and 6
 * console.warn in the app chunk, unchanged from before).
 *
 * IF THIS FIRES ON CODE YOU DID NOT WRITE: `esbuild.pure` reaches the minify pass, so it
 * strips vendor debug logs too (mapbox-gl's 13 went with ours). But dist/sw.js and
 * dist/workbox-*.js are minified by workbox's own pipeline, not by Vite, so a future workbox
 * release could land a console.log there that our setting never touches. That is a real
 * finding about our build, not noise: either the file is outside the mechanism and needs one,
 * or it belongs in a documented exception with a removal condition. Do not widen it silently.
 *
 * Usage: node scripts/assertNoFixtureInBundle.mjs [distDir]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * Three independent signals, because the first version of this guard had exactly one and
 * it was the wrong one. `E2E_FIXTURE_MARKER` was referenced decoratively in the container
 * module, Rollup inlined and dropped it, and the guard reported "ok" on a build that
 * demonstrably contained the fixture (chunk `assets/e2eCloudKitContainer-*.js`, with the
 * fixture slug in it). The marker is now part of returned data so it survives, and these
 * two extra signals mean no single tree-shaking surprise can make the guard blind again.
 *
 * Split into fragments so this file's own source does not contain the literals it greps
 * for — otherwise scanning a dist/ that happened to include this script self-reports.
 */
const NEEDLES = [
    ['AKASHIC_E2E_FIXTURE', 'DO_NOT_SHIP'].join('_'), // E2E_FIXTURE_MARKER (a fileChecksum prefix)
    ['e2e', 'alpine', 'loop'].join('-'), // PRIMARY_FIXTURE_SLUG
    ['/src/', 'fixtures/', 'assets'].join(''), // FIXTURE_ASSET_PATH
];

/**
 * QUA-44. The debug console methods that must not survive a production build, kept in step
 * with `esbuild.pure` in vite.config.js — if you add a method there, add it here, because the
 * config is the mechanism and this is the only thing that notices when the mechanism stops.
 *
 * Built from fragments for the same reason as NEEDLES above: this script calls console.log
 * itself, so a literal here would make it self-report if it were ever scanned.
 */
const DEBUG_CONSOLE_METHODS = ['log', 'debug', 'info', 'trace', 'dir', 'table'];
const DEBUG_CONSOLE_NEEDLES = DEBUG_CONSOLE_METHODS.map((m) => ['console', m].join('.'));

/**
 * Methods that MUST survive — asserted positively, so "stripped everything" cannot pass.
 *
 * The floor is not zero, and that is the whole point: the first version of this check merely
 * required *some* console.warn/error somewhere in dist/, and it PASSED a build made with
 * `drop: ["console"]` — because dist/workbox-*.js and dist/sw-share-target.js are minified by
 * workbox's pipeline, not by Vite, so they kept 1 warn and 3 error while every diagnostic in
 * our own code was gone. Same shape of mistake as grepping one chunk. So the count is taken
 * over `assets/` only, which is exactly the output Vite's esbuild touches.
 *
 * MEASURED in dist/assets on the correct build: 40 console.error, 26 console.warn (ours plus
 * the vendor chunks'). MEASURED with `drop: ["console"]`: 0 and 0. A floor of 10 sits far from
 * both. If a legitimate refactor ever pushes a real build below it, re-measure and move it —
 * do not delete it.
 */
const KEPT_CONSOLE_NEEDLES = ['warn', 'error'].map((m) => ['console', m].join('.'));
const KEPT_CONSOLE_FLOOR = 10;

const dist = process.argv[2] ?? 'dist';
const SCANNED = /\.(js|mjs|cjs|css|html|json|map)$/;

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (SCANNED.test(entry)) out.push(full);
    }
    return out;
}

let files;
try {
    files = walk(dist);
} catch (err) {
    console.error(`[fixture-guard] cannot read ${dist}/ — run the build first (${err.message})`);
    process.exit(1);
}

const hits = [];
const debugHits = [];
const keptCounts = new Map(KEPT_CONSOLE_NEEDLES.map((n) => [n, 0]));

// Scripts only for the console scan: a .css or .json string containing the needle would be
// text, not a call, and sourcemaps carry pre-minification source by definition.
const IS_SCRIPT = /\.(js|mjs|cjs)$/;

for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const needle of NEEDLES) {
        if (source.includes(needle)) hits.push(`${file}  (matched ${JSON.stringify(needle)})`);
    }
    if (!IS_SCRIPT.test(file)) continue;
    for (const needle of DEBUG_CONSOLE_NEEDLES) {
        const count = source.split(needle).length - 1;
        if (count > 0) debugHits.push(`${file}  (${count} × ${needle})`);
    }
    // Vite-emitted output only — see KEPT_CONSOLE_FLOOR for why the wider tree does not count.
    if (!file.includes(`${sep}assets${sep}`)) continue;
    for (const needle of KEPT_CONSOLE_NEEDLES) {
        keptCounts.set(needle, keptCounts.get(needle) + source.split(needle).length - 1);
    }
}

if (hits.length > 0) {
    console.error(
        `[fixture-guard] FAIL: E2E fixture code is in the built bundle:\n  ${hits.join('\n  ')}\n` +
            '  This build would serve fabricated journeys to real visitors and never contact\n' +
            '  CloudKit — and it would render perfectly, so a smoke check would not notice.\n' +
            '  Was VITE_E2E_TEST_MODE set in the build environment (ambient env, .env, .env.local)?'
    );
    process.exit(1);
}

console.log(
    `[fixture-guard] ok: ${NEEDLES.length} fixture signals absent from ${files.length} files in ${dist}/`
);

// QUA-44
if (debugHits.length > 0) {
    console.error(
        `[console-guard] FAIL: debug console calls survived the production build:\n  ${debugHits.join('\n  ')}\n` +
            '  Every visitor would run these on every visit. This is a build setting, not a\n' +
            '  code-review habit: check that `esbuild.pure` is still present in vite.config.js.\n' +
            '  It works by annotating the calls /* @__PURE__ */ so Rollup tree-shakes them, so\n' +
            '  losing that key or disabling treeshake breaks it — build.minify is not involved\n' +
            '  (measured: `vite build --minify false` also strips them).'
    );
    process.exit(1);
}

const keptSummary = [...keptCounts].map(([needle, n]) => `${n} × ${needle}`).join(', ');
const starved = [...keptCounts].filter(([, n]) => n < KEPT_CONSOLE_FLOOR);
if (starved.length > 0) {
    console.error(
        `[console-guard] FAIL: the build kept too few real diagnostics in ${dist}/assets:\n` +
            `  ${keptSummary} (floor is ${KEPT_CONSOLE_FLOOR} of each)\n` +
            '  The stripping is too broad — almost certainly `drop: ["console"]` where `pure` on\n' +
            '  the debug methods was meant. console.warn and console.error are how production is\n' +
            '  debugged at all; QUA-40 was diagnosed through the CloudKit adapter\'s error path.'
    );
    process.exit(1);
}

console.log(
    `[console-guard] ok: ${DEBUG_CONSOLE_NEEDLES.length} debug console methods absent from ${dist}/; ` +
        `kept ${keptSummary}`
);
