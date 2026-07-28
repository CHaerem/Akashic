import { describe, it, expect } from 'vitest';
import {
    APPLE_SATELLITE_BAND, clampToImageryBand, EARTH_CIRCUMFERENCE_M, metersPerPixel,
    worldUnitsPerPixelFor,
} from './imagery';

/**
 * The pure half of QUA-47 — the clamp arithmetic, with no camera and no viewport. (`./camera.test.ts` owns
 * what it does to the four framings the app actually requests.)
 *
 * The tests worth reading are the two that state properties rather than values: the floor may only ever
 * LOOSEN a frame and the ceiling may only ever tighten one, because that asymmetry is the whole reason
 * `regionForBounds` takes one end and `regionForZoom` takes both.
 */

/** Zoom → world units per pixel, the same 256-px-tile convention `./mapkit/camera.ts` uses. */
function scaleForZoom(zoom: number): number {
    return 1 / (256 * Math.pow(2, zoom));
}

describe('ground resolution arithmetic (QUA-47)', () => {
    it('reproduces the standard Web Mercator resolutions', () => {
        // The textbook figures for a 256 px tile pyramid: 156543.03 m/px at zoom 0 on the equator, halving
        // per level and falling with cos(latitude). Asserted against literals rather than against the
        // inverse function, so a sign error in BOTH directions cannot cancel out.
        expect(metersPerPixel(scaleForZoom(0), 0)).toBeCloseTo(156_543.034, 2);
        expect(metersPerPixel(scaleForZoom(16), 0)).toBeCloseTo(2.3887, 4);
        expect(metersPerPixel(scaleForZoom(16), 61.6)).toBeCloseTo(1.1361, 4);
        expect(metersPerPixel(scaleForZoom(16), 75)).toBeCloseTo(0.6182, 4);
    });

    it('is the reason a zoom level cannot express an imagery limit', () => {
        // 3.9x across the latitudes this app's journeys sit at — Kilimanjaro at 3 S, Svalbard at 78 N. One
        // number in zoom levels is therefore four different demands on the tile service, which is exactly how
        // `DAY_FIT_MAX_ZOOM = 16` came to be generous in Tanzania and too deep in Norway.
        const equator = metersPerPixel(scaleForZoom(16), -3);
        const arctic = metersPerPixel(scaleForZoom(16), 78);
        expect(equator / arctic).toBeGreaterThan(3.9);
    });

    it('round-trips through worldUnitsPerPixelFor', () => {
        for (const lat of [-78, -3, 0, 28, 61.6, 78]) {
            for (const mpp of [0.3, 1.2, 5, 20, 150]) {
                expect(metersPerPixel(worldUnitsPerPixelFor(mpp, lat), lat)).toBeCloseTo(mpp, 9);
            }
        }
    });

    it('does not divide by zero at the poles', () => {
        // cos(90 deg) is 0, so an unclamped latitude would make worldUnitsPerPixelFor return Infinity and the
        // clamp would zoom to the whole planet. Both functions saturate at Mercator's own limit instead.
        expect(Number.isFinite(worldUnitsPerPixelFor(1.2, 90))).toBe(true);
        expect(Number.isFinite(worldUnitsPerPixelFor(1.2, -90))).toBe(true);
        expect(metersPerPixel(scaleForZoom(16), 90)).toBeGreaterThan(0);
        expect(worldUnitsPerPixelFor(1.2, 90)).toBeCloseTo(worldUnitsPerPixelFor(1.2, 85.05112878), 12);
    });

    it('uses the WGS-84 equatorial circumference, not a rounded one', () => {
        // A 1 % error here is a 1 % error in every clamp, silently, forever. Pinned so a "tidy up the
        // constant" edit has to argue with a test.
        expect(EARTH_CIRCUMFERENCE_M).toBe(40_075_016.686);
    });
});

describe('clampToImageryBand (QUA-47)', () => {
    const LAT = 61.636;   // Jotunheimen, where the ladder in imagery.ts was measured

    it('raises a frame that is finer than the floor, to exactly the floor', () => {
        const asked = worldUnitsPerPixelFor(0.3, LAT);
        const got = clampToImageryBand(asked, LAT, { finestMetersPerDevicePixel: 1.2 });
        expect(metersPerPixel(got, LAT)).toBeCloseTo(1.2, 9);
        expect(got).toBeGreaterThan(asked);
    });

    it('lowers a frame that is coarser than the ceiling, to exactly the ceiling', () => {
        const asked = worldUnitsPerPixelFor(40, LAT);
        const got = clampToImageryBand(asked, LAT, { coarsestMetersPerDevicePixel: 5 });
        expect(metersPerPixel(got, LAT)).toBeCloseTo(5, 9);
        expect(got).toBeLessThan(asked);
    });

    it('leaves a frame inside the band alone', () => {
        const asked = worldUnitsPerPixelFor(3, LAT);
        expect(clampToImageryBand(asked, LAT, APPLE_SATELLITE_BAND)).toBe(asked);
    });

    it('THE FLOOR MAY ONLY LOOSEN AND THE CEILING MAY ONLY TIGHTEN — never the other way round', () => {
        // This is the property `./mapkit/camera.ts` relies on to give `regionForBounds` the floor and withhold
        // the ceiling. If the floor could ever tighten a frame, a containment fit could crop, and the
        // "lands every route corner inside the padded sub-rect" invariant would become conditional on the
        // bounds' size — the kind of breakage that shows up as one journey framed wrong, not as a red test.
        for (const lat of [-3, 0, 28, 61.636, 78]) {
            for (const mpp of [0.1, 0.5, 1.2, 3, 5, 12, 40, 200]) {
                const asked = worldUnitsPerPixelFor(mpp, lat);
                const floorOnly = clampToImageryBand(asked, lat, { finestMetersPerDevicePixel: 1.2 });
                const ceilOnly = clampToImageryBand(asked, lat, { coarsestMetersPerDevicePixel: 5 });
                expect(floorOnly).toBeGreaterThanOrEqual(asked);
                expect(ceilOnly).toBeLessThanOrEqual(asked);
            }
        }
    });

    it('scales the band by devicePixelRatio, because the pyramid is indexed by device pixels', () => {
        // MapKit requests size=2 (512 px) tiles on a retina display, so the same CSS-pixel frame draws imagery
        // one level deeper there. Measured consequence: the arrival smear was invisible under Playwright
        // (dpr 1) and immediate on a Mac (dpr 2) — see imagery.ts.
        const asked = worldUnitsPerPixelFor(0.2, LAT);
        for (const dpr of [1, 2, 3]) {
            const got = clampToImageryBand(asked, LAT, { finestMetersPerDevicePixel: 1.2 }, dpr);
            expect(metersPerPixel(got, LAT)).toBeCloseTo(1.2 * dpr, 6);
        }
    });

    it('treats an absurd devicePixelRatio as 1 rather than propagating it', () => {
        const asked = worldUnitsPerPixelFor(0.2, LAT);
        const sane = clampToImageryBand(asked, LAT, APPLE_SATELLITE_BAND, 1);
        for (const dpr of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(clampToImageryBand(asked, LAT, APPLE_SATELLITE_BAND, dpr)).toBe(sane);
        }
    });

    it('resolves a floor/ceiling conflict in the FLOOR\'s favour', () => {
        // A band with finest > coarsest is a misconfiguration, and the two ends disagree about what to do
        // with every scale. Legible imagery is the point of the file, so the floor wins — a frame coarser
        // than someone intended is cosmetic, a magnified smear is the defect. Pinned because the answer is
        // decided by nothing but the ORDER of two lines, which is exactly the kind of thing a refactor
        // reorders without noticing.
        const inverted = { finestMetersPerDevicePixel: 20, coarsestMetersPerDevicePixel: 5 };
        for (const mpp of [0.5, 5, 12, 20, 60]) {
            const got = clampToImageryBand(worldUnitsPerPixelFor(mpp, LAT), LAT, inverted);
            expect(metersPerPixel(got, LAT)).toBeCloseTo(20, 6);
        }
    });

    it('RAISES a scale of zero to the floor — it is the single-point case, not bad input', () => {
        // `regionForBounds` on a one-coordinate route computes `Number.MIN_VALUE / availableWidth`, which
        // underflows to exactly 0. Raising it is the job the old `maxZoom` did. The first version of this
        // function bailed out on `scale <= 0` and therefore left the point case completely unclamped while
        // every other test here passed — `./mapkit/camera.test.ts`'s single-point assertion is what found it.
        expect(metersPerPixel(clampToImageryBand(0, LAT, APPLE_SATELLITE_BAND), LAT))
            .toBeCloseTo(APPLE_SATELLITE_BAND.finestMetersPerDevicePixel, 9);
    });

    it('passes NON-FINITE input through instead of inventing a number', () => {
        // NaN or Infinity means the caller already has a bug. Substituting something plausible here would hide
        // it at the one place it is still cheap to find.
        for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(clampToImageryBand(bad, LAT, APPLE_SATELLITE_BAND)).toBe(bad);
        }
        const fine = worldUnitsPerPixelFor(3, LAT);
        expect(clampToImageryBand(fine, Number.NaN, APPLE_SATELLITE_BAND)).toBe(fine);
    });

    it('ignores an end that is absent or non-positive', () => {
        const asked = worldUnitsPerPixelFor(0.1, LAT);
        expect(clampToImageryBand(asked, LAT, {})).toBe(asked);
        expect(clampToImageryBand(asked, LAT, { finestMetersPerDevicePixel: 0 })).toBe(asked);
        expect(clampToImageryBand(asked, LAT, { finestMetersPerDevicePixel: -1 })).toBe(asked);
    });

    it('applies the floor at the frame\'s own latitude, not at some reference latitude', () => {
        // The bug this would be: converting the band once at the equator and reusing the number. At 61.6 N a
        // world-units scale buys 47 % of the ground it buys at the equator, so a latitude-blind floor is the
        // same mistake `DAY_FIT_MAX_ZOOM` made, one level of indirection further in.
        const asked = worldUnitsPerPixelFor(0.2, 0);
        const atEquator = clampToImageryBand(asked, 0, { finestMetersPerDevicePixel: 1.2 });
        const atNorth = clampToImageryBand(asked, 61.6, { finestMetersPerDevicePixel: 1.2 });
        expect(atNorth / atEquator).toBeCloseTo(1 / Math.cos((61.6 * Math.PI) / 180), 6);
        expect(metersPerPixel(atEquator, 0)).toBeCloseTo(1.2, 9);
        expect(metersPerPixel(atNorth, 61.6)).toBeCloseTo(1.2, 9);
    });
});

describe('APPLE_SATELLITE_BAND (QUA-47)', () => {
    it('pins the measured numbers', () => {
        // MEASURED 2026-07-28 at dpr 2 over six panes per location, judged after full tile load. 1.2 is the
        // Khumbu Icefall row — crisp at 1.2 m/device px, soft at 0.6, featureless at 0.3 — and the Khumbu is
        // the correct source for a global floor because it is the worst-covered ground this app frames.
        // 5 is the coarsest level measured CLEAN over Everest base camp in the same session; 10 there is heavy
        // cloud. imagery.ts's header has both tables and how to re-measure.
        expect(APPLE_SATELLITE_BAND.finestMetersPerDevicePixel).toBe(1.2);
        expect(APPLE_SATELLITE_BAND.coarsestMetersPerDevicePixel).toBe(5);
    });

    it('is a band and not a point — the floor is finer than the ceiling', () => {
        expect(APPLE_SATELLITE_BAND.finestMetersPerDevicePixel)
            .toBeLessThan(APPLE_SATELLITE_BAND.coarsestMetersPerDevicePixel);
    });

    it('is FINER than zoom 16 at the equator and COARSER than zoom 16 in Norway', () => {
        // The one-line statement of why the old clamp could not work. zoom 16 asks for 2.39 m/px on the
        // equator, which the imagery has and to spare; the same zoom 16 asks for 1.14 m/px at 61.6 N, which it
        // does not. No single zoom level is both.
        const floor = APPLE_SATELLITE_BAND.finestMetersPerDevicePixel;
        expect(metersPerPixel(scaleForZoom(16), 0)).toBeGreaterThan(floor);
        expect(metersPerPixel(scaleForZoom(16), 61.6)).toBeLessThan(floor);
    });
});
