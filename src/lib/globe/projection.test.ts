/**
 * Projection, back-face culling, pin placement and hit-testing. (MAP-02)
 *
 * This is where the landing globe is actually verified. The renderer needs a canvas and the unit suite is
 * jsdom, so `getContext('2d')` returns null here — which is exactly why the arithmetic was pushed out of
 * the component into pure functions. Everything below runs with no DOM.
 *
 * The pin hit test gets disproportionate attention on purpose: it is covered by ZERO e2e specs, because
 * every spec selects a journey through `window.testHelpers.selectTrek()`, which calls the React callback
 * directly and never touches the canvas. A broken hit test ships green.
 */

import { describe, it, expect } from 'vitest';
import {
    GLOBE_HOME,
    PIN_HIT_RADIUS_PX,
    clampLatitude,
    hitTestPins,
    prepareGeometry,
    projectGeometry,
    projectPins,
    projectPoint,
    unproject,
    viewportFor,
    wrapLongitude,
} from './projection';

/** The two fixture journeys, in Jotunheimen — the coordinates the committed baselines show over Norway. */
const ALPINE = { id: 'e2e-alpine-loop', lng: 8.42, lat: 61.672 };
const COASTAL = { id: 'e2e-coastal-ridge', lng: 5.36, lat: 60.42 };

describe('projectPoint', () => {
    it('puts the camera centre exactly at the middle of the disc, fully visible', () => {
        const p = projectPoint(30, 15, { lon: 30, lat: 15 });
        expect(p.x).toBeCloseTo(0, 12);
        expect(p.y).toBeCloseTo(0, 12);
        expect(p.depth).toBeCloseTo(1, 12);
    });

    it('places a point 90 degrees east of the camera on the right limb', () => {
        const p = projectPoint(90, 0, { lon: 0, lat: 0 });
        expect(p.x).toBeCloseTo(1, 12);
        expect(p.y).toBeCloseTo(0, 12);
        // Exactly on the horizon: depth 0 is NOT visible, which is what keeps the limb from double-drawing.
        expect(p.depth).toBeCloseTo(0, 12);
    });

    it('places north of the camera up-screen, and south down-screen', () => {
        expect(projectPoint(0, 45, { lon: 0, lat: 0 }).y).toBeGreaterThan(0);
        expect(projectPoint(0, -45, { lon: 0, lat: 0 }).y).toBeLessThan(0);
    });

    it('never projects outside the unit disc, at any camera', () => {
        for (let clon = -180; clon <= 180; clon += 37) {
            for (let clat = -90; clat <= 90; clat += 23) {
                for (let lon = -180; lon <= 180; lon += 41) {
                    for (let lat = -90; lat <= 90; lat += 29) {
                        const p = projectPoint(lon, lat, { lon: clon, lat: clat });
                        expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(1 + 1e-6);
                    }
                }
            }
        }
    });
});

describe('back-face culling', () => {
    it('hides the antipode of the camera and shows the camera point', () => {
        const camera = { lon: 30, lat: 15 };
        expect(projectPoint(30, 15, camera).depth).toBeGreaterThan(0);
        expect(projectPoint(-150, -15, camera).depth).toBeLessThan(0);
    });

    it('culls a Norwegian journey pin when the rotation carries Norway to the far side', () => {
        // The defect this prevents: a pin floating over the middle of the Pacific. The landing globe
        // sweeps every longitude, so this framing is reached on every revolution.
        const vp = viewportFor(1280, 800);
        const facing = projectPins([ALPINE, COASTAL], { lon: 8, lat: 61 }, vp);
        expect(facing.map(p => p.id)).toEqual([ALPINE.id, COASTAL.id]);

        const away = projectPins([ALPINE, COASTAL], { lon: -172, lat: -61 }, vp);
        expect(away).toEqual([]);
    });

    it('drops exactly the pins on the far hemisphere, sweeping a full revolution', () => {
        const vp = viewportFor(1280, 800);
        for (let lon = -180; lon < 180; lon += 15) {
            const camera = { lon, lat: 15 };
            const pins = projectPins([ALPINE, COASTAL], camera, vp);
            const expected = [ALPINE, COASTAL].filter(t => projectPoint(t.lng, t.lat, camera).depth > 0);
            expect(pins.map(p => p.id)).toEqual(expected.map(t => t.id));
        }
    });
});

describe('unproject', () => {
    it('round-trips every projected point back to its own coordinates', () => {
        const camera = { lon: 30, lat: 15 };
        let checked = 0;
        for (let lon = -180; lon <= 180; lon += 13) {
            for (let lat = -85; lat <= 85; lat += 11) {
                const p = projectPoint(lon, lat, camera);
                if (p.depth <= 1e-9) continue;     // far side has no unique inverse
                const back = unproject(p.x, p.y, camera);
                expect(back).not.toBeNull();
                const [blon, blat] = back as [number, number];
                expect(blat).toBeCloseTo(lat, 9);
                // Longitude is degenerate at the poles, where every meridian meets.
                if (Math.abs(lat) < 89.9) {
                    expect(wrapLongitude(blon - lon)).toBeCloseTo(0, 9);
                }
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(200);
    });

    it('returns null outside the disc', () => {
        expect(unproject(1.01, 0, GLOBE_HOME)).toBeNull();
        expect(unproject(0.8, 0.8, GLOBE_HOME)).toBeNull();
        expect(unproject(0.6, 0.6, GLOBE_HOME)).not.toBeNull();
    });
});

describe('hitTestPins', () => {
    const vp = viewportFor(1280, 800);
    const camera = { lon: 8, lat: 61 };

    it('hits a pin at its own drawn pixel', () => {
        const pins = projectPins([ALPINE, COASTAL], camera, vp);
        for (const pin of pins) {
            expect(hitTestPins(pins, pin.x, pin.y)).toBe(pin.id);
        }
    });

    it('misses when the pointer is beyond the slop radius', () => {
        // A lone synthetic pin, NOT one of the fixtures. Measured: at this camera the two Jotunheimen
        // journeys project about 9 px apart, so stepping 24 px off one of them lands inside the other's
        // slop — which is correct behaviour and would make this assertion test nothing.
        const pins = [{ id: 'lone', x: 400, y: 300 }];
        expect(hitTestPins(pins, 400, 300)).toBe('lone');
        expect(hitTestPins(pins, 400 + PIN_HIT_RADIUS_PX + 2, 300)).toBeNull();
        expect(hitTestPins(pins, 400, 300 + PIN_HIT_RADIUS_PX + 2)).toBeNull();
        // Just inside still hits.
        expect(hitTestPins(pins, 400 + PIN_HIT_RADIUS_PX - 1, 300)).toBe('lone');
    });

    it('resolves to the nearest pin when the fixtures crowd each other', () => {
        // The real fixture geometry: two journeys ~9 px apart at this camera. Whichever is nearer wins,
        // and both must be reachable — a hit test that always returned the first would be undetectable
        // in the e2e suite, which never clicks the canvas at all.
        const pins = projectPins([ALPINE, COASTAL], camera, vp);
        expect(pins).toHaveLength(2);
        for (const pin of pins) {
            expect(hitTestPins(pins, pin.x, pin.y)).toBe(pin.id);
        }
    });

    it('prefers the nearer pin when two are close together', () => {
        const pins = [
            { id: 'near', x: 100, y: 100 },
            { id: 'far', x: 112, y: 100 },
        ];
        expect(hitTestPins(pins, 101, 100)).toBe('near');
        expect(hitTestPins(pins, 111, 100)).toBe('far');
    });

    it('returns null when nothing is drawn — a far-side click selects nothing', () => {
        expect(hitTestPins([], 640, 400)).toBeNull();
    });

    /**
     * The devicePixelRatio regression, pinned.
     *
     * The hit test is specified in CSS pixels on both sides, so the backing-store scale must not appear
     * in the arithmetic at all. A 3x phone is where an implementation that forgot to divide it out looks
     * fine on the developer's 1x monitor and misses every pin in the field.
     */
    it('is identical at devicePixelRatio 1, 2 and 3 because it never sees one', () => {
        const pins = projectPins([ALPINE, COASTAL], camera, vp);
        const target = pins[0];
        for (const dpr of [1, 2, 3]) {
            // What a wrong implementation would compare: device pixels against CSS-pixel positions.
            const devicePixels = { x: target.x * dpr, y: target.y * dpr };
            const cssPixels = { x: devicePixels.x / dpr, y: devicePixels.y / dpr };
            expect(hitTestPins(pins, cssPixels.x, cssPixels.y)).toBe(target.id);
        }
        // And the failure mode itself, so the test above is not passing vacuously: at dpr 3 the raw
        // device coordinate is far from the pin and must NOT hit it.
        expect(hitTestPins(pins, target.x * 3, target.y * 3)).toBeNull();
    });
});

describe('prepareGeometry and projectGeometry', () => {
    // Two triangles, one on each side of the globe at the home camera.
    const rings = [
        [0, 0, 10, 0, 10, 10],
        [180, 0, 170, 0, 170, 10],
    ];

    it('lifts rings onto the unit sphere', () => {
        const g = prepareGeometry(rings);
        expect(g.pointCount).toBe(6);
        expect(Array.from(g.start)).toEqual([0, 3]);
        expect(Array.from(g.count)).toEqual([3, 3]);
        for (let i = 0; i < g.pointCount; i++) {
            expect(Math.hypot(g.px[i], g.py[i], g.pz[i])).toBeCloseTo(1, 6);
        }
    });

    it('agrees with projectPoint for every vertex, at several cameras', () => {
        const g = prepareGeometry(rings);
        for (const camera of [{ lon: 0, lat: 0 }, GLOBE_HOME, { lon: -120, lat: -55 }]) {
            projectGeometry(g, camera);
            let i = 0;
            for (const ring of rings) {
                for (let j = 0; j < ring.length; j += 2) {
                    const p = projectPoint(ring[j], ring[j + 1], camera);
                    expect(g.sx[i]).toBeCloseTo(p.x, 6);
                    expect(g.sy[i]).toBeCloseTo(p.y, 6);
                    expect(g.dep[i]).toBeCloseTo(p.depth, 6);
                    i++;
                }
            }
        }
    });

    it('splits the two rings into visible and hidden at the home camera', () => {
        const g = prepareGeometry(rings);
        projectGeometry(g, { lon: 5, lat: 5 });
        const near = [g.dep[0], g.dep[1], g.dep[2]].every(d => d > 0);
        const far = [g.dep[3], g.dep[4], g.dep[5]].every(d => d < 0);
        expect(near).toBe(true);
        expect(far).toBe(true);
    });

    it('reuses its buffers rather than allocating per frame', () => {
        const g = prepareGeometry(rings);
        const sx = g.sx;
        projectGeometry(g, GLOBE_HOME);
        projectGeometry(g, { lon: 90, lat: 0 });
        expect(g.sx).toBe(sx);
    });
});

describe('viewport and camera helpers', () => {
    it('centres the sphere and leaves room for the atmosphere bloom', () => {
        const vp = viewportFor(1280, 800);
        expect(vp.cx).toBe(640);
        expect(vp.cy).toBe(400);
        // Bloom reaches 1.11 R, so the sphere must clear the shorter edge by more than that.
        expect(vp.radius * 1.11).toBeLessThan(400);
    });

    it('uses the SHORTER edge, so a wide desktop and a tall phone both fit', () => {
        expect(viewportFor(1280, 800).radius).toBe(viewportFor(800, 800).radius);
        expect(viewportFor(393, 851).radius).toBe(viewportFor(393, 393).radius);
    });

    it('wraps longitude into (-180, 180] so rotation cannot drift unbounded', () => {
        expect(wrapLongitude(0)).toBe(0);
        expect(wrapLongitude(190)).toBeCloseTo(-170, 9);
        expect(wrapLongitude(-190)).toBeCloseTo(170, 9);
        expect(wrapLongitude(720 + 45)).toBeCloseTo(45, 9);
        expect(wrapLongitude(-3600 - 45)).toBeCloseTo(-45, 9);
        expect(wrapLongitude(180)).toBe(180);
        expect(wrapLongitude(-180)).toBe(180);
    });

    it('clamps drag latitude short of the poles', () => {
        expect(clampLatitude(0)).toBe(0);
        expect(clampLatitude(95)).toBe(80);
        expect(clampLatitude(-95)).toBe(-80);
    });

    // Deliberately not naming the previous vendor in this title: `boundary.test.ts` bans a vendor name in
    // executable code under `lib/globe/`, and a test name is a string literal, not a comment. It caught
    // this exact line on the first run, which is the assertion doing its job.
    it('starts at the framing the incumbent globe used, so the swap does not move the camera', () => {
        expect(GLOBE_HOME).toEqual({ lon: 30, lat: 15 });
    });
});
