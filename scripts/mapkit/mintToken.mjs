#!/usr/bin/env node
/**
 * Mint a MapKit JS token. (MAP-04A)
 *
 * ## Why this exists, and why it is better than the portal
 *
 * There is no Apple CLI for this — verified: `altool` and `notarytool` take a `.p8` but authenticate to
 * App Store Connect, not MapKit, and `xcrun` offers only `mapc` (the Metal shader compiler) and `vmmap`.
 * The Apple Developer portal can hand you a token directly, and that is the tempting path.
 *
 * It is the wrong one. A portal-generated token is a fixed string you must hand-edit to rotate, and there
 * is no backend here to replace it — so the day it lapses, `mapkit.init` fails with `unauthorized`, the
 * journey map becomes an empty box, and it stays broken until a human notices and pushes a build. On a
 * family keepsake that may go untouched for months, that is a fuse lit on the day you paste it.
 *
 * The private key does not expire. So holding the `.p8` and minting at build time means **every deploy
 * refreshes the token** — the fuse resets on every push instead of burning down once. The failure mode
 * changes from "breaks on a date nobody remembers" to "breaks only if nobody deploys for `--days`".
 *
 * ## Usage
 *
 *   MAPKIT_KEY_ID=ABC1234567 \
 *   MAPKIT_TEAM_ID=9LVCB72DT8 \
 *   MAPKIT_PRIVATE_KEY="$(cat AuthKey_ABC1234567.p8)" \
 *     node scripts/mapkit/mintToken.mjs --origin 'akashic.no,*.akashic.no' --days 180
 *
 * Note the origin value: BOTH the apex and the wildcard. See the measured matrix below — they are disjoint,
 * and using either one alone breaks half the site.
 *
 * In CI the key is a repository secret, so it never touches the filesystem. The minted token is public by
 * design — it ships in the client bundle — and is protected by the `origin` claim, not by secrecy.
 *
 * ## The claim spec — and what Apple ACTUALLY enforces, measured
 *
 * The spec below is from Apple's DocC source, re-fetched 2026-07-27. The enforcement matrix under it was
 * measured the same day against `cdn.apple-mapkit.com/ma/bootstrap` with the real key (9UN97VBZR8), which
 * is the only way to know which parts of the spec bite. **They mostly do not**, and the two that do are
 * not the two you would guess.
 *
 * Spec:
 * - **`scope`** — "A space-separated list of one or more Apple Maps frameworks you are authorizing the
 *   token to use", of `embed_api`, `mapkit_js`, `server_api`, `web_snapshots`.
 * - **`origin`** — "Use a domain pattern such as `*.example.com`, a specific domain such as
 *   `example.com`, or a comma-separated list of origins for multiple domains such as
 *   `example.com,*.subdomain.com`." Required whenever the scope runs in a browser.
 *
 * Measured (claim / request Origin / result):
 *
 *     akashic.no              https://akashic.no        200
 *     akashic.no              https://sub.akashic.no    401 ORIGIN_CHECK_FAILURE   <-- see below
 *     *.akashic.no            https://akashic.no        401 ORIGIN_CHECK_FAILURE   <-- see below
 *     akashic.no,*.akashic.no https://akashic.no        200
 *     akashic.no,*.akashic.no https://www.akashic.no    200
 *     akashic.no,*.akashic.no https://notakashic.no     401 ORIGIN_CHECK_FAILURE
 *     akashic.no/             https://akashic.no        401 ORIGIN_CHECK_FAILURE
 *     https://akashic.no      https://akashic.no        200   (Apple tolerates the scheme)
 *     (no origin claim)       https://example.com       403   (blocked, but at a CDN layer)
 *     (no scope claim)        https://akashic.no        200
 *     akashic.no              (no Origin header)        200   (unrestricted server-side)
 *
 * **THE ONE THAT WOULD HAVE BROKEN PRODUCTION.** A bare domain does not cover subdomains, and a wildcard
 * does not cover the apex — they are disjoint. akashic.no serves from BOTH the apex and `www`
 * (www.akashic.no is a CNAME to chaerem.github.io and resolves today), so either single form leaves half
 * the visitors looking at an empty box. Only the comma-separated list covers the deployment:
 *
 *     --origin akashic.no,*.akashic.no
 *
 * No amount of reading the documentation would have surfaced that; it took the real key and eleven
 * requests.
 *
 * **Honest correction to what this file used to claim.** An earlier version said the missing `scope`, the
 * scheme-form `origin` and the absent `origin` would each produce a token that 401s. Measured, Apple
 * returns **200 for all three** — they were non-canonical, not broken. The validation below is still
 * right (write to the spec, not to what the server currently tolerates), and it earns its keep on the one
 * case that genuinely fails: a trailing slash, which is 401 ORIGIN_CHECK_FAILURE and is exactly the
 * CloudKit trap wearing a different hat.
 *
 * **And the security claim above is weaker than it reads.** "Protected by the `origin` claim, not by
 * secrecy" holds for a browser, which always sends an `Origin` header. A request with NO `Origin` header
 * is served 200 regardless of the claim — so a copied token can be used server-side from anywhere, against
 * the 250,000-map-views-per-day entitlement that is billed per Program membership, not per token. That is
 * an abuse ceiling worth knowing about, not a reason to hide the token: MapKit JS has no other model.
 *
 * ## The detail that silently produces an invalid signature
 *
 * **`dsaEncoding: 'ieee-p1363'`.** Node's default ES256 signature is DER-encoded, which every JWT verifier
 * rejects. Omit this and you get a well-formed token that always fails auth — with no hint why. A P-256
 * JWS signature is exactly 64 raw bytes; DER is variable-length and starts with 0x30. The test asserts
 * both, so dropping the option fails the suite rather than production.
 */

import { createSign } from 'node:crypto';

const REQUIRED = ['MAPKIT_KEY_ID', 'MAPKIT_TEAM_ID', 'MAPKIT_PRIVATE_KEY'];

/** Apple's four documented scope values. */
export const SCOPES = ['embed_api', 'mapkit_js', 'server_api', 'web_snapshots'];

/** The scopes Apple documents as requiring an `origin` claim — i.e. everything that runs in a browser. */
const BROWSER_SCOPES = new Set(['embed_api', 'mapkit_js', 'web_snapshots']);

/** What this repo needs: the browser JavaScript SDK. */
export const DEFAULT_SCOPE = 'mapkit_js';

/** Deliberately shy of a year, and refreshed on every deploy, so the lifetime is never load-bearing. */
export const DEFAULT_DAYS = 180;

/**
 * One entry of the `origin` claim: `example.com`, `*.example.com`, or bare `localhost`.
 *
 * `localhost` is a deliberate exception — it has no dot, so it does not match Apple's "specific domain"
 * shape, and Apple documents nothing about it. Allowed because `npm run dev` and Playwright serve from
 * `http://localhost:5173` and there is no other way for the dev loop to authenticate. No longer a guess:
 * MEASURED 2026-07-27 against Apple's bootstrap endpoint, both `localhost` alone and `akashic.no,localhost`
 * return 200 for a request from `http://localhost:5173`. Note the port is not part of the claim.
 */
const ORIGIN_ENTRY = /^(?:\*\.)?(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;

function base64url(input) {
    return Buffer.from(input).toString('base64url');
}

/**
 * Validate one `origin` claim value, which may be a comma-separated list.
 *
 * Throws with the remedy rather than the rule, because the overwhelmingly likely mistake is pasting a URL
 * — that is what every other origin-shaped field in this project takes.
 */
function assertValidOrigin(origin) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(origin)) {
        throw new Error(`origin must be a bare domain, not a URL — Apple's origin claim takes `
            + `"akashic.no" or "*.akashic.no", never "https://akashic.no". Got "${origin}". `
            + `(CloudKit's Allowed Origins is the opposite and DOES need the scheme; they are different fields.)`);
    }
    const entries = origin.split(',');
    for (const raw of entries) {
        const entry = raw.trim();
        if (entry !== raw) {
            throw new Error(`origin entries must not carry surrounding whitespace: "${raw}" in "${origin}"`);
        }
        if (!entry) throw new Error(`origin has an empty entry: "${origin}"`);
        if (entry.includes('/')) {
            throw new Error(`origin must not contain a path or trailing slash: "${entry}"`);
        }
        if (!ORIGIN_ENTRY.test(entry)) {
            throw new Error(`origin entry "${entry}" is not a domain or wildcard pattern — expected `
                + `"example.com", "*.example.com", or a comma-separated list of those`);
        }
    }
}

/** Validate the space-separated `scope` claim against Apple's four documented values. */
function assertValidScope(scope) {
    const parts = scope.split(' ');
    for (const part of parts) {
        if (!SCOPES.includes(part)) {
            throw new Error(`unknown scope "${part}" — Apple documents exactly: ${SCOPES.join(', ')}`);
        }
    }
    return parts;
}

/**
 * Sign a MapKit JS token.
 *
 * `now` is injectable so a test can pin `iat`/`exp` rather than racing the clock.
 */
export function mintMapKitToken({
    keyId,
    teamId,
    privateKey,
    origin,
    scope = DEFAULT_SCOPE,
    days = DEFAULT_DAYS,
    now = Date.now(),
}) {
    if (!keyId) throw new Error('keyId is required (the MapKit key ID from the Apple Developer portal)');
    if (!teamId) throw new Error('teamId is required (your Apple Developer Team ID)');
    if (!privateKey) throw new Error('privateKey is required (the contents of AuthKey_<keyId>.p8)');
    if (!privateKey.includes('BEGIN PRIVATE KEY')) {
        throw new Error('privateKey does not look like a PEM .p8 — expected a "BEGIN PRIVATE KEY" block.');
    }
    // Checked SEPARATELY from the header, because the header survives newline mangling: a key whose
    // newlines became the two characters \n still contains "BEGIN PRIVATE KEY" and passes the test above,
    // then dies inside OpenSSL as `DECODER routines::unsupported` — a message that tells the reader
    // nothing about what to fix. This is the single commonest way an Apple .p8 arrives broken through a
    // shell or a CI secret, so it gets its own error naming the remedy.
    if (privateKey.includes('\\n')) {
        throw new Error('privateKey contains literal backslash-n instead of real newlines — the PEM cannot '
            + 'be decoded. If it came from a shell or a CI secret, restore the newlines '
            + '(the CLI entry point does this for you).');
    }
    if (!(days > 0)) throw new Error(`days must be positive, got ${days}`);

    const scopes = assertValidScope(scope);
    const needsOrigin = scopes.some(s => BROWSER_SCOPES.has(s));
    if (needsOrigin && !origin) {
        throw new Error(`scope "${scope}" runs in a browser, so Apple requires an origin claim — `
            + `pass one (e.g. "akashic.no"). A browser token without it is unusable.`);
    }
    if (origin) assertValidOrigin(origin);

    const issuedAt = Math.floor(now / 1000);
    const header = { alg: 'ES256', typ: 'JWT', kid: keyId };
    const payload = {
        iss: teamId,
        iat: issuedAt,
        exp: issuedAt + Math.round(days * 24 * 60 * 60),
        scope,
        ...(origin ? { origin } : {}),
    };

    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    let signature;
    try {
        signature = createSign('sha256')
            .update(signingInput)
            .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })   // NOT default DER — see the header note
            .toString('base64url');
    } catch (cause) {
        // OpenSSL's own text ("DECODER routines::unsupported") names nothing the reader can act on.
        throw new Error(`could not sign with the supplied private key: ${cause.message}. Expected the `
            + `contents of an Apple AuthKey_<keyId>.p8 (a PKCS#8 EC P-256 key).`, { cause });
    }

    return { token: `${signingInput}.${signature}`, issuedAt, expiresAt: payload.exp };
}

/** Decode a token's payload without verifying it — used by the CI expiry guard. */
export function decodePayload(token) {
    const parts = String(token).split('.');
    if (parts.length !== 3) throw new Error('not a JWT: expected three dot-separated parts');
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

/** Days until the token expires, negative once it has. */
export function daysUntilExpiry(token, now = Date.now()) {
    const { exp } = decodePayload(token);
    if (typeof exp !== 'number') throw new Error('token has no numeric exp claim');
    return (exp - Math.floor(now / 1000)) / (24 * 60 * 60);
}

function main(argv) {
    const missing = REQUIRED.filter(k => !process.env[k]);
    if (missing.length) {
        console.error(`missing required env: ${missing.join(', ')}`);
        console.error('see the header of this file for usage');
        process.exit(2);
    }
    const value = (name) => {
        const i = argv.indexOf(`--${name}`);
        return i === -1 ? undefined : argv[i + 1];
    };
    const days = value('days');
    const { token, expiresAt } = mintMapKitToken({
        keyId: process.env.MAPKIT_KEY_ID,
        teamId: process.env.MAPKIT_TEAM_ID,
        // A secret pasted through a shell often arrives with literal \n; repair that one case only.
        privateKey: process.env.MAPKIT_PRIVATE_KEY.replace(/\\n/g, '\n'),
        origin: value('origin'),
        scope: value('scope') ?? DEFAULT_SCOPE,
        days: days === undefined ? DEFAULT_DAYS : Number(days),
    });
    // stdout is the token alone, so it can be piped straight into an env file or a build arg.
    process.stdout.write(token);
    console.error(`\nminted, expires ${new Date(expiresAt * 1000).toISOString()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
