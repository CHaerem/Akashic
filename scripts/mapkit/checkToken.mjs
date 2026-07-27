#!/usr/bin/env node
/**
 * Prove the MapKit credential actually works, and fail before it lapses. (MAP-04A)
 *
 * ## Why a name in `gh secret list` is not verification
 *
 * A secret's value cannot be read back — that is the point of it — so "MAPKIT_PRIVATE_KEY appears in the
 * list" says nothing about whether the value is the right key, a truncated paste, or a PEM whose newlines
 * became the two characters `\n` on the way through a shell. That last one is the commonest way an Apple
 * `.p8` arrives broken, and it fails inside OpenSSL with `DECODER routines::unsupported`, which names
 * nothing. The only way to know is to sign with it, so that is what this does.
 *
 * ## What it checks, and which failures are ours
 *
 * 1. **The secret is present and is a usable key.** Deterministic, no network. A failure here is our
 *    configuration and is always worth failing the build for.
 * 2. **The token has more than `MIN_DAYS` of life left.** Deterministic, no network. This is the guard that
 *    makes the whole build-time-minting design work: the fuse resets on every deploy, and if nobody
 *    deploys for long enough that the *next* token would be short-lived, the build says so.
 * 3. **Apple accepts it**, from the apex and from `www`. This one needs the network, and it is the only
 *    check that can catch a revoked key or a mis-scoped token.
 *
 * The origin value is `akashic.no,*.akashic.no` and both halves are checked deliberately. MEASURED
 * 2026-07-27: a bare-domain claim is `401 ORIGIN_CHECK_FAILURE` from any subdomain, and a wildcard claim is
 * 401 from the apex — they are disjoint, and this site serves from both. A check that only tested the apex
 * would have passed for a token that left every `www` visitor looking at an empty map.
 *
 * ## Deliberately NOT a required status check
 *
 * Step 3 depends on Apple being up, and a required check that depends on a third party blocks unrelated
 * merges during someone else's outage — the mistake QUA-40 exists to undo. So this lives in its own
 * workflow and gates nothing. Red here is a real signal about the credential, visible without holding up
 * the queue.
 *
 * And NOT on a `schedule:` either: GitHub disables scheduled workflows after 60 days of repository
 * inactivity, so a scheduled health check dies in exactly the quiet period it exists to protect. Running on
 * every push to main means the check is as fresh as the last deploy, which is the same thing the token's
 * lifetime already depends on.
 */

import { mintMapKitToken, daysUntilExpiry, decodePayload } from './mintToken.mjs';

/** Enough runway that a normal week of not deploying cannot strand the site. */
const MIN_DAYS = 14;

const ORIGIN = 'akashic.no,*.akashic.no';

/** Apple's MapKit JS handshake. A 200 here is the same call the browser SDK makes on init. */
const BOOTSTRAP = 'https://cdn.apple-mapkit.com/ma/bootstrap?apiVersion=2&mkjsVersion=5.79.0&poi=1';

/** Every host the deployment actually answers on. Both are checked; see the header. */
const SITES = ['https://akashic.no', 'https://www.akashic.no'];

function fail(message) {
    console.error(`\n✗ ${message}\n`);
    process.exit(1);
}

const keyId = process.env.MAPKIT_KEY_ID;
const teamId = process.env.MAPKIT_TEAM_ID;
const privateKey = process.env.MAPKIT_PRIVATE_KEY;

if (!keyId || !teamId) {
    fail('MAPKIT_KEY_ID / MAPKIT_TEAM_ID are not set. They are repository VARIABLES, not secrets — both '
        + 'travel in clear text inside every token (as kid and iss) and ship in the public bundle. See MAP-04.');
}
if (!privateKey) {
    fail('MAPKIT_PRIVATE_KEY is not set. It is a repository SECRET holding the contents of the Apple '
        + 'AuthKey_<keyId>.p8. See MAP-04.');
}

// A secret pasted through a shell often arrives with literal \n. Repair that one case, exactly as the
// minter's CLI entry point does, so a recoverable formatting slip is not reported as a broken key.
const pem = privateKey.replace(/\\n/g, '\n');

let token;
try {
    ({ token } = mintMapKitToken({ keyId, teamId, privateKey: pem, origin: ORIGIN }));
} catch (err) {
    fail(`could not mint a token from the configured credential: ${err.message}`);
}

const payload = decodePayload(token);
const remaining = daysUntilExpiry(token);

// The token is public by design — it ships in the client bundle — but there is no reason to put it in a log.
console.log('minted from the configured credential:');
console.log(`  kid    ${payload.iss === teamId ? keyId : '(mismatch!)'}`);
console.log(`  iss    ${payload.iss}`);
console.log(`  scope  ${payload.scope}`);
console.log(`  origin ${payload.origin}`);
console.log(`  expires ${new Date(payload.exp * 1000).toISOString()} (${remaining.toFixed(1)} days)`);

if (remaining < MIN_DAYS) {
    fail(`the minted token would have only ${remaining.toFixed(1)} days of life, below the ${MIN_DAYS}-day `
        + `floor. Raise --days in the deploy step, or shorten the gap between deploys.`);
}

console.log('\nchecking Apple accepts it, from every host the site answers on:');
const failures = [];
for (const site of SITES) {
    let status = 'ERR';
    let note = '';
    try {
        const res = await fetch(BOOTSTRAP, {
            headers: { Authorization: `Bearer ${token}`, Origin: site, Referer: `${site}/` },
            signal: AbortSignal.timeout(20_000),
        });
        status = res.status;
        if (status !== 200) {
            const text = await res.text();
            // Apple returns a typed error for the cases we can act on (ORIGIN_CHECK_FAILURE) and bare
            // HTML for the ones we cannot, so fall back to the raw body rather than reporting nothing.
            const typed = text.match(/"errorType":"([A-Z_]+)"/);
            note = typed ? typed[1] : text.slice(0, 80).replace(/\s+/g, ' ');
        }
    } catch (err) {
        note = err.message;
    }
    console.log(`  ${String(status).padEnd(4)} ${site}${note ? `  ${note}` : ''}`);
    if (status !== 200) failures.push(`${site} -> ${status} ${note}`);
}

if (failures.length) {
    fail(`Apple rejected the token from ${failures.length} of ${SITES.length} hosts:\n    `
        + failures.join('\n    ')
        + `\n\n  ORIGIN_CHECK_FAILURE means the origin claim does not cover that host — note that a bare`
        + `\n  domain and a wildcard are DISJOINT, so the claim must list both. Anything else points at the`
        + `\n  key itself: revoked in the portal, or a different key than the one MAPKIT_KEY_ID names.`
        + `\n  Before rewriting anything, check a trivial local page with the same token — there are`
        + `\n  unresolved reports of Apple-side 401s on this endpoint.`);
}

console.log('\n✓ the configured MapKit credential mints a token Apple accepts, from every host.');
