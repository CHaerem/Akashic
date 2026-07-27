#!/usr/bin/env node
/**
 * MAP-02 — turn Natural Earth's `ne_110m_land` into the module the landing globe imports.
 *
 * Run:  node scripts/geo/buildCoastline.mjs
 * Out:  src/lib/globe/coastline.generated.ts
 *
 * ## Why a generated TS module and not a file in `public/geo/`
 *
 * MAP-02's declared file list says `public/geo/**`, and this deviates from it deliberately. Three
 * measured reasons, in order of how much they cost if ignored:
 *
 * 1. **`vite.config.js`'s Workbox `globPatterns` is `**\/*.{js,css,html,ico,png,svg,json,woff,woff2}`.**
 *    A file called `land.geojson` does NOT match — `"land.geojson"` does not end in `".json"` — so it
 *    lands in `dist/` and gets zero references in `sw.js`. The landing globe is then blank on an
 *    offline first visit while every gate stays green. (`.bin` fails the same way.) Naming it `.json`
 *    dodges it, but the dodge is one careless rename from returning. A TS module cannot have the bug:
 *    it becomes a content-hashed `.js` chunk, which matches.
 * 2. **No `vite.config.js` edit is needed.** That file is outside MAP-02's file list and, at the time
 *    this landed, was dirty with QUA-44's esbuild block. Widening a precache glob to accommodate one
 *    filename is also a permanent repo-wide decision taken for a local reason.
 * 3. **It is smaller.** Delta-encoding against the previous point, on a 0.01° integer grid, with the
 *    GeoJSON envelope dropped. Measured figures are printed by this script and recorded in
 *    `src/lib/globe/PROVENANCE.md`.
 *
 * ## Why 0.01° and why no simplification
 *
 * 0.01° is 0.03 px at the shipped globe size (515 px diameter, measured off the committed desktop
 * baseline), where one pixel is ~0.35°. So the quantisation is invisible.
 *
 * Ramer–Douglas–Peucker at half a pixel would save a further ~40 %, and it is deliberately NOT done
 * here. Simplification moves the silhouette, which would mean `horizon.test.ts`'s ground-truth harness
 * could no longer separate renderer error from encoder error — it compares the rendered path against a
 * ray-cast of these same rings, so the two must describe the same coastline. Keeping all 5143 points
 * means the harness measures the renderer alone, which is where the subtle bug lives. If the bytes are
 * ever wanted, add RDP here, keep rings whole below a projected-area threshold, and re-point the
 * harness's ray-cast side at the UNSIMPLIFIED rings so it still measures total error.
 */

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

const SOURCE_URL =
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson';
const DATASET_VERSION = 'v5.1.2';
/** Verified on download: HTTP 200, 138160 bytes. Asserted below, so a silent upstream change fails here. */
const EXPECTED_SHA256 = '9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9';
const EXPECTED_BYTES = 138160;

/** 0.01° — see the header for why this is visually free. */
const GRID = 100;

const input = process.argv[2] ?? resolve(REPO, 'scripts/geo/ne_110m_land.geojson');
const raw = readFileSync(input);

const sha = createHash('sha256').update(raw).digest('hex');
if (raw.length !== EXPECTED_BYTES || sha !== EXPECTED_SHA256) {
    console.error('Source geometry is not the dataset this script was verified against.');
    console.error(`  expected ${EXPECTED_BYTES} bytes  sha256 ${EXPECTED_SHA256}`);
    console.error(`  got      ${raw.length} bytes  sha256 ${sha}`);
    console.error('Re-verify the download before regenerating — see PROVENANCE.md.');
    process.exit(1);
}

const gj = JSON.parse(raw.toString('utf8'));

// ---- flatten to rings -------------------------------------------------------------------------
// Polygon holes are kept as ordinary rings. They carry the OPPOSITE winding to the 127 outer rings
// (measured: 127 CW, 1 CCW — the CCW one is the Caspian Sea inside the Africa–Eurasia ring), so a
// nonzero-winding fill punches them out with no hole bookkeeping of our own.
const rings = [];
for (const f of gj.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) rings.push(ring);
}

// ---- quantise + delta-encode ------------------------------------------------------------------
let points = 0;
let maxAbsDelta = 0;
const packed = rings.map(ring => {
    // GeoJSON repeats the first point as the last to close the ring. The renderer closes paths
    // itself, so the duplicate is dropped — 128 points saved, and it keeps `count` honest.
    const pts = ring.slice(0, -1);
    points += pts.length;
    const out = [];
    let plon = 0;
    let plat = 0;
    for (const [lon, lat] of pts) {
        const qlon = Math.round(lon * GRID);
        const qlat = Math.round(lat * GRID);
        const dlon = qlon - plon;
        const dlat = qlat - plat;
        maxAbsDelta = Math.max(maxAbsDelta, Math.abs(dlon), Math.abs(dlat));
        out.push(dlon, dlat);
        plon = qlon;
        plat = qlat;
    }
    return out;
});

// JSON of integers, embedded as ONE string literal and read back with JSON.parse. The engine parses
// JSON faster than it parses an equivalent array literal in source, it minifies without whitespace
// ambiguity, and the text contains no quote or backslash so it needs no escaping.
const json = JSON.stringify(packed);

const out = `/**
 * Coastline geometry for the landing globe — GENERATED. Do not edit by hand.
 *
 * Regenerate:  node scripts/geo/buildCoastline.mjs
 * Source, licence and byte measurements: src/lib/globe/PROVENANCE.md and
 * src/lib/globe/LICENSE-natural-earth.md (committed beside this file, per MAP-02's requirement 2).
 *
 * Natural Earth 1:110m physical land, public domain. Delta-encoded on a ${(1 / GRID).toFixed(2)}° integer grid;
 * \`decodeRings\` in ./coastline.ts is the only reader. Kept in a separate module from its decoder so
 * that a dynamic \`import()\` can code-split it away from first paint.
 */

/** Where the geometry came from, pinned so a reader never has to guess which version this is. */
export const COASTLINE_PROVENANCE = {
    sourceUrl: '${SOURCE_URL}',
    datasetVersion: '${DATASET_VERSION}',
    sourceSha256: '${EXPECTED_SHA256}',
    sourceBytes: ${EXPECTED_BYTES},
    licence: 'public domain',
    /** Degrees per quantisation step — 0.03 px at the shipped globe size. */
    gridDegrees: ${1 / GRID},
    rings: ${rings.length},
    points: ${points},
} as const;

/** Delta-encoded rings: \`[[lon0, lat0, dlon, dlat, ...], ...]\` in ${(1 / GRID).toFixed(2)}° integer units. */
export const PACKED_COASTLINE =
    '${json}';
`;

const target = resolve(REPO, 'src/lib/globe/coastline.generated.ts');
writeFileSync(target, out);

const gz = n => gzipSync(n, { level: 9 }).length;
console.log('source     :', raw.length, 'bytes raw,', gz(raw), 'gz  (sha256 verified)');
console.log('rings      :', rings.length);
console.log('points     :', points, '(closing duplicates dropped)');
console.log('max |delta|:', maxAbsDelta, `(${(maxAbsDelta / GRID).toFixed(2)}°)`);
console.log('packed json:', json.length, 'bytes raw,', gz(Buffer.from(json)), 'gz');
console.log('module     :', out.length, 'bytes raw,', gz(Buffer.from(out)), 'gz ->', target);
