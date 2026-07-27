/**
 * The generated coastline, checked against what the generator promised. (MAP-02)
 *
 * These are the assertions that would catch a bad regeneration. The failure mode they exist for is not a
 * crash — it is geometry that is subtly wrong and still draws: a truncated Antarctic cap (which is what
 * the world-atlas TopoJSON alternative would have given us, clipped at -85.6 degrees, showing as a
 * straight notch on any southern camera), a ring that lost its tail, or a decoder and generator that
 * disagree about the quantisation grid and put every continent in the wrong place by a factor.
 */

import { describe, it, expect } from 'vitest';
import { decodeRings } from './coastline';
import { COASTLINE_PROVENANCE, PACKED_COASTLINE } from './coastline.generated';

const rings = decodeRings(PACKED_COASTLINE);

describe('coastline provenance', () => {
    // Requirement 2 of MAP-02: vendored data carries its source, version and licence. The licence text
    // itself is committed at ./LICENSE-natural-earth.md; these are the machine-readable claims.
    it('records where the geometry came from, pinned to a version', () => {
        expect(COASTLINE_PROVENANCE.sourceUrl).toContain('natural-earth-vector');
        expect(COASTLINE_PROVENANCE.datasetVersion).toBe('v5.1.2');
        expect(COASTLINE_PROVENANCE.sourceSha256).toBe(
            '9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9',
        );
        expect(COASTLINE_PROVENANCE.sourceBytes).toBe(138160);
        expect(COASTLINE_PROVENANCE.licence).toBe('public domain');
    });

    it('agrees with the geometry it ships alongside', () => {
        expect(rings.length).toBe(COASTLINE_PROVENANCE.rings);
        expect(rings.reduce((n, r) => n + (r.length >> 1), 0)).toBe(COASTLINE_PROVENANCE.points);
    });
});

describe('decodeRings', () => {
    it('recovers Natural Earth 110m at the counts measured on download', () => {
        // 127 features, 128 rings (the extra is the Caspian Sea, a hole inside Africa-Eurasia), 5143
        // points of which 128 are GeoJSON's repeated closing points, dropped by the generator.
        expect(rings.length).toBe(128);
        expect(rings.reduce((n, r) => n + (r.length >> 1), 0)).toBe(5015);
    });

    it('produces flat lon/lat pairs, every ring with at least a triangle', () => {
        for (const ring of rings) {
            expect(ring.length % 2).toBe(0);
            expect(ring.length >> 1).toBeGreaterThanOrEqual(3);
        }
    });

    it('keeps every coordinate on the globe', () => {
        for (const ring of rings) {
            for (let i = 0; i < ring.length; i += 2) {
                expect(ring[i]).toBeGreaterThanOrEqual(-180);
                expect(ring[i]).toBeLessThanOrEqual(180);
                expect(ring[i + 1]).toBeGreaterThanOrEqual(-90);
                expect(ring[i + 1]).toBeLessThanOrEqual(90);
            }
        }
    });

    it('reaches the south pole — the Antarctic cap is NOT clipped', () => {
        let minLat = 90;
        let maxLat = -90;
        for (const ring of rings) {
            for (let i = 1; i < ring.length; i += 2) {
                if (ring[i] < minLat) minLat = ring[i];
                if (ring[i] > maxLat) maxLat = ring[i];
            }
        }
        // Exactly -90 in the source. Anything around -85.6 means someone swapped in a countries-derived
        // dataset and the south polar cap is now a straight cut.
        expect(minLat).toBe(-90);
        expect(maxLat).toBeCloseTo(83.65, 1);
    });

    it('leaves rings UNCLOSED, because the renderer closes its own paths', () => {
        let closed = 0;
        for (const ring of rings) {
            const n = ring.length;
            if (ring[0] === ring[n - 2] && ring[1] === ring[n - 1]) closed++;
        }
        expect(closed).toBe(0);
    });

    it('quantises to 0.01 degrees and no finer', () => {
        expect(COASTLINE_PROVENANCE.gridDegrees).toBeCloseTo(0.01, 12);
        for (const ring of rings) {
            for (const v of ring) {
                // Every value must be an exact multiple of the grid step, within float noise.
                expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
            }
        }
    });

    it('puts the big landmasses where they belong', () => {
        // A sanity check on the delta decoding as a whole: if the running sum were wrong, or the grid
        // divisor off by a factor, continents would land in the ocean and this would fail.
        const areaOf = (ring: number[]) => {
            let a = 0;
            const n = ring.length >> 1;
            for (let i = 0, j = n - 1; i < n; j = i++) {
                a += ring[j * 2] * ring[i * 2 + 1] - ring[i * 2] * ring[j * 2 + 1];
            }
            return Math.abs(a / 2);
        };
        const biggest = [...rings].sort((a, b) => areaOf(b) - areaOf(a))[0];
        // Africa-Eurasia: the largest ring, spanning from the Atlantic to the Pacific.
        let minLon = 180, maxLon = -180;
        for (let i = 0; i < biggest.length; i += 2) {
            if (biggest[i] < minLon) minLon = biggest[i];
            if (biggest[i] > maxLon) maxLon = biggest[i];
        }
        expect(biggest.length >> 1).toBeGreaterThan(500);
        expect(minLon).toBeLessThan(-15);
        expect(maxLon).toBeGreaterThan(175);
    });

    it('round-trips a hand-built encoding, so the decoder is checked against the format not itself', () => {
        // deltas: start at (100, 200) = (1.00, 2.00), then +50 lon, -100 lat, then -150 lon, +25 lat
        const packed = JSON.stringify([[100, 200, 50, -100, -150, 25]]);
        expect(decodeRings(packed)).toEqual([[1, 2, 1.5, 1, 0, 1.25]]);
    });
});
