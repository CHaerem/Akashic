/**
 * Read the generated coastline back into rings. (MAP-02)
 *
 * Kept apart from `./coastline.generated.ts` so that the decoder is reviewable and unit-testable while
 * the data stays a machine-written blob nobody edits by hand. `./coastline.test.ts` checks the decode
 * against invariants the generator promises — ring count, point count, latitude reach, ring closure —
 * so a regenerated blob that lost Antarctica or truncated a ring fails a test rather than looking
 * slightly wrong on screen.
 */

import type { FlatRing } from './projection';

/** Steps per degree in the packed integers. Must match `GRID` in `scripts/geo/buildCoastline.mjs`. */
const GRID = 100;

/**
 * Undo the delta encoding: `[[lon0, lat0, dlon, dlat, ...], ...]` in 0.01° integer units, back to
 * flat `[lon, lat, ...]` degree rings.
 *
 * Rings come back UNCLOSED — the generator drops GeoJSON's repeated final point, because the renderer
 * closes its own paths and `prepareGeometry` counts points.
 */
export function decodeRings(packed: string): FlatRing[] {
    const deltas = JSON.parse(packed) as number[][];
    return deltas.map(ring => {
        const out = new Array<number>(ring.length);
        let lon = 0;
        let lat = 0;
        for (let i = 0; i < ring.length; i += 2) {
            lon += ring[i];
            lat += ring[i + 1];
            out[i] = lon / GRID;
            out[i + 1] = lat / GRID;
        }
        return out;
    });
}

/**
 * Load the coastline, code-split away from first paint.
 *
 * A dynamic `import()` on purpose. The globe draws its sphere, atmosphere and journey pins on the first
 * frame and reports ready THEN; continents arrive when this resolves. Two things depend on that
 * ordering: `openApp()` in the e2e suite hard-fails if `isMapReady()` has not gone true within 15 s,
 * and more importantly a visitor on a slow connection sees a rotating Earth immediately rather than an
 * empty container. The chunk is still precached by Workbox — it is a `.js` file under `dist/assets/`,
 * which `globPatterns` matches — so an offline first visit gets the continents too.
 */
export async function loadCoastlineRings(): Promise<FlatRing[]> {
    const { PACKED_COASTLINE } = await import('./coastline.generated');
    return decodeRings(PACKED_COASTLINE);
}
