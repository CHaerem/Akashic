#!/usr/bin/env node
/**
 * Assert the E2E fixture is absent from the built bundle (QUA-40).
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
 * Usage: node scripts/assertNoFixtureInBundle.mjs [distDir]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const needle of NEEDLES) {
        if (source.includes(needle)) hits.push(`${file}  (matched ${JSON.stringify(needle)})`);
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
