#!/usr/bin/env node
/**
 * Mint a MapKit JS token. (MAP-04)
 *
 * ## Why this exists, and why it is better than the portal
 *
 * There is no Apple CLI for this — verified: `altool` and `notarytool` take a `.p8` but authenticate to
 * App Store Connect, not MapKit, and `xcrun` offers only `mapc` (the Metal shader compiler) and `vmmap`.
 * The Apple Developer portal can hand you a token directly, and that is the tempting path.
 *
 * It is the wrong one. A portal-generated token is a fixed string with a fixed expiry, and there is no
 * backend here to replace it — so the day it lapses, `mapkit.init` fails with `unauthorized`, the journey
 * map becomes an empty box, and it stays broken until a human notices and pushes a build. On a family
 * keepsake that may go untouched for months, that is a fuse lit on the day you paste it.
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
 *     node scripts/mapkit/mintToken.mjs --origin https://akashic.no --days 180
 *
 * In CI the key is a repository secret, so it never touches the filesystem. The minted token is public by
 * design — it ships in the client bundle — and is protected by the `origin` claim, not by secrecy.
 *
 * ## The two details that silently produce an invalid token
 *
 * 1. **`dsaEncoding: 'ieee-p1363'`.** Node's default ES256 signature is DER-encoded, which JWT verifiers
 *    reject. Omit this and you get a well-formed token that always fails auth — with no hint why.
 * 2. **The `origin` claim must match the browser's `Origin` exactly**, scheme and host, no path and no
 *    trailing slash. This is the same trap that cost an hour on the CloudKit token, where Allowed Origins
 *    had been entered as `akashic.no/` and every real browser was rejected while a curl matching the
 *    stored string passed. See the CLAUDE.md trap.
 */

import { createSign } from 'node:crypto';

const REQUIRED = ['MAPKIT_KEY_ID', 'MAPKIT_TEAM_ID', 'MAPKIT_PRIVATE_KEY'];

/** Apple's maximum accepted lifetime is undocumented here; see MAP-04. 180 days is deliberately shy of a year. */
export const DEFAULT_DAYS = 180;

function base64url(input) {
    return Buffer.from(input).toString('base64url');
}

/**
 * Sign a MapKit JS token.
 *
 * `now` is injectable so a test can pin `iat`/`exp` rather than racing the clock.
 */
export function mintMapKitToken({ keyId, teamId, privateKey, origin, days = DEFAULT_DAYS, now = Date.now() }) {
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
    if (origin && !/^https?:\/\/[^/]+$/.test(origin)) {
        // Refused rather than normalised: a silently-corrected origin is how the CloudKit trailing-slash
        // bug survived for hours, passing from curl and failing from every browser.
        throw new Error(`origin must be scheme://host with no path or trailing slash, got "${origin}"`);
    }
    if (!(days > 0)) throw new Error(`days must be positive, got ${days}`);

    const issuedAt = Math.floor(now / 1000);
    const header = { alg: 'ES256', typ: 'JWT', kid: keyId };
    const payload = {
        iss: teamId,
        iat: issuedAt,
        exp: issuedAt + Math.round(days * 24 * 60 * 60),
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
    const originIndex = argv.indexOf('--origin');
    const daysIndex = argv.indexOf('--days');
    const { token, expiresAt } = mintMapKitToken({
        keyId: process.env.MAPKIT_KEY_ID,
        teamId: process.env.MAPKIT_TEAM_ID,
        // A secret pasted through a shell often arrives with literal \n; repair that one case only.
        privateKey: process.env.MAPKIT_PRIVATE_KEY.replace(/\\n/g, '\n'),
        origin: originIndex >= 0 ? argv[originIndex + 1] : undefined,
        days: daysIndex >= 0 ? Number(argv[daysIndex + 1]) : DEFAULT_DAYS,
    });
    // stdout is the token alone, so it can be piped straight into an env file or a build arg.
    process.stdout.write(token);
    console.error(`\nminted, expires ${new Date(expiresAt * 1000).toISOString()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
