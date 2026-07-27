#!/usr/bin/env node
/**
 * Mint a `localhost` MapKit token and print it bare, so the dev loop is one line. (MAP-03)
 *
 *   VITE_MAPKIT_TOKEN=$(node scripts/mapkit/devToken.mjs) \
 *   VITE_E2E_TEST_MODE=true npm run dev
 *
 * MAP-05 removed `VITE_MAP_VENDOR=mapkit` from that line: Mapbox is deleted, so MapKit is not a mode you
 * opt into any more. It is also why this token is no longer optional for the journey view — without it the
 * map is `MapErrorFallback`. The landing globe still needs nothing (MAP-02).
 *
 * That gives the MapKit journey surface over the two fixture journeys in Jotunheimen (~61.6 N, 8.3 E —
 * measured at imagery PARITY in `imagery-compare/FINDINGS.md`), with five days, camps and photos, and no
 * Apple ID and no CloudKit.
 *
 * `localhost` with no port: measured accepted by Apple, and the port is not part of the origin claim. All the
 * signing detail — including `dsaEncoding: 'ieee-p1363'`, whose absence yields a well-formed token that always
 * fails auth with no hint why — lives in `mintToken.mjs`.
 *
 * Deliberately separate from `imagery-compare/tokens.mjs`: that writes a gitignored `tokens.js` for a static
 * harness page, this writes nothing and prints one value for an env var. Both go through `mintMapKitToken`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintMapKitToken } from './mintToken.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `.env` / `.env.local` are gitignored and live only in the main checkout — a worktree may have neither. */
function envValue(name) {
    for (const file of ['.env.local', '.env']) {
        const path = join(REPO, file);
        if (!existsSync(path)) continue;
        for (const line of readFileSync(path, 'utf8').split('\n')) {
            const match = line.match(new RegExp(`^${name}=(.+)$`));
            if (match) return match[1].trim();
        }
    }
    return undefined;
}

// Repository VARIABLES in CI, not secrets — only the .p8 is secret.
const keyId = process.env.MAPKIT_KEY_ID || envValue('MAPKIT_KEY_ID') || '9UN97VBZR8';
const teamId = process.env.MAPKIT_TEAM_ID || envValue('MAPKIT_TEAM_ID') || '9LVCB72DT8';

const keyPath = process.env.MAPKIT_PRIVATE_KEY_PATH || join(homedir(), '.keys', `AuthKey_${keyId}.p8`);
if (!process.env.MAPKIT_PRIVATE_KEY && !existsSync(keyPath)) {
    console.error(`no MapKit private key: set MAPKIT_PRIVATE_KEY, or put the .p8 at ${keyPath}.`);
    console.error('A .p8 downloads exactly once and is unrecoverable — it is not in this repo and never can be.');
    process.exit(2);
}
const privateKey = process.env.MAPKIT_PRIVATE_KEY?.replace(/\\n/g, '\n') ?? readFileSync(keyPath, 'utf8');

const { token, expiresAt } = mintMapKitToken({ keyId, teamId, privateKey, origin: 'localhost', days: 1 });

// stdout is the token ALONE so it can be captured with $(...); everything else goes to stderr.
process.stdout.write(token);
console.error(`\nminted for origin "localhost", expires ${new Date(expiresAt * 1000).toISOString()}`);
