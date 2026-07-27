/**
 * Ground truth for the horizon clip. (MAP-02)
 *
 * ## What this test is, and why it is shaped so strangely
 *
 * `buildLandPath` is the one piece of the landing globe that can be wrong in a way no screenshot of the
 * default framing reveals, and wrong across the entire screen. So it is not checked against expected
 * coordinates — it is checked against a SECOND, INDEPENDENT answer to the question "is this pixel land?":
 *
 *   - side A: take a pixel in the disc, `unproject` it to lon/lat, and ray-cast the ORIGINAL decoded
 *     coastline rings in lon/lat space. Shares no code with the renderer.
 *   - side B: ask whether that same pixel is inside the path `buildLandPath` produced, by winding number
 *     over the recorded and flattened subpaths.
 *
 * Disagreement is then measured over many cameras. Sampling the ray-cast side against the SOURCE rings
 * rather than against anything the renderer touched is the point: it measures total error, so a bug in
 * the clip, in the projection, or in the geometry decode all show up here.
 *
 * ## It also asserts that it can detect failure
 *
 * A correctness test that cannot tell right from wrong is worse than no test, because it reports success.
 * So the two shortcuts that MAP-02's design rejected — clamping hidden vertices onto the limb, and
 * mirroring them across it — are implemented below and required to FAIL this same harness. They fail
 * enormously (whole-frame inversion, ocean drawn as land) at framings the auto-rotation reaches twice per
 * revolution, at `GLOBE_HOME.lat`. If someone ever "simplifies" the clipper into one of them, this catches
 * it. See `./horizon.ts` for the full history.
 *
 * Runs with no DOM: jsdom has no canvas and no `Path2D`, hence the `PathSink` seam and the recorder here.
 */

import { describe, it, expect } from 'vitest';
import { buildLandPath, LIMB_DIRECTION, type PathSink } from './horizon';
import { decodeRings } from './coastline';
import { PACKED_COASTLINE } from './coastline.generated';
import { prepareGeometry, projectGeometry, unproject, type FlatRing, type GlobeGeometry } from './projection';

const RINGS: FlatRing[] = decodeRings(PACKED_COASTLINE);
const GEOMETRY: GlobeGeometry = prepareGeometry(RINGS);

// ---------------------------------------------------------------------------------------------------
// side A: ray-cast the source rings in lon/lat. Independent of everything the renderer does.
// ---------------------------------------------------------------------------------------------------

/** Ring bounding boxes, so the cast is fast enough to run 30-odd cameras in a unit test. */
const RING_BBOX = RINGS.map(ring => {
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    for (let i = 0; i < ring.length; i += 2) {
        if (ring[i] < minLon) minLon = ring[i];
        if (ring[i] > maxLon) maxLon = ring[i];
        if (ring[i + 1] < minLat) minLat = ring[i + 1];
        if (ring[i + 1] > maxLat) maxLat = ring[i + 1];
    }
    return { minLon, maxLon, minLat, maxLat };
});

/**
 * Even-odd across rings: a point inside an outer ring AND inside the Caspian hole toggles twice and comes
 * out as water, which is the correct answer and the reason this is a toggle rather than an early return.
 */
function isLandLonLat(lon: number, lat: number): boolean {
    let inside = false;
    for (let r = 0; r < RINGS.length; r++) {
        const bb = RING_BBOX[r];
        if (lat < bb.minLat || lat > bb.maxLat || lon < bb.minLon || lon > bb.maxLon) continue;
        const ring = RINGS[r];
        const n = ring.length >> 1;
        let crossings = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = ring[i * 2], yi = ring[i * 2 + 1];
            const xj = ring[j * 2], yj = ring[j * 2 + 1];
            // Segments that wrap the antimeridian are not meaningful in flat lon/lat; skip them.
            if (Math.abs(xi - xj) > 180) continue;
            if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
                crossings = !crossings;
            }
        }
        if (crossings) inside = !inside;
    }
    return inside;
}

// ---------------------------------------------------------------------------------------------------
// side B: record the emitted path, flatten arcs, and ask for a winding number.
// ---------------------------------------------------------------------------------------------------

interface SubPath {
    pts: number[];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

class PathRecorder implements PathSink {
    readonly subpaths: SubPath[] = [];
    private current: number[] = [];
    private x = 0;
    private y = 0;

    moveTo(x: number, y: number): void {
        this.flush();
        this.current = [x, y];
        this.x = x;
        this.y = y;
    }

    lineTo(x: number, y: number): void {
        if (this.current.length === 0) this.current = [this.x, this.y];
        this.current.push(x, y);
        this.x = x;
        this.y = y;
    }

    /** Canvas semantics: sweep from startAngle towards endAngle in the given direction, wrapping once. */
    arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): void {
        let sweep = ccw ? a0 - a1 : a1 - a0;
        sweep %= Math.PI * 2;
        if (sweep < 0) sweep += Math.PI * 2;
        // ~1 degree per segment: at the shipped radius that is a 0.01 px chord deviation, well below the
        // rasterisation noise this harness is trying to see past.
        const steps = Math.max(2, Math.ceil((sweep * 180) / Math.PI));
        for (let i = 0; i <= steps; i++) {
            const a = a0 + (ccw ? -1 : 1) * sweep * (i / steps);
            this.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
    }

    closePath(): void {
        if (this.current.length >= 2) {
            this.current.push(this.current[0], this.current[1]);
        }
        this.flush();
    }

    private flush(): void {
        if (this.current.length >= 6) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < this.current.length; i += 2) {
                if (this.current[i] < minX) minX = this.current[i];
                if (this.current[i] > maxX) maxX = this.current[i];
                if (this.current[i + 1] < minY) minY = this.current[i + 1];
                if (this.current[i + 1] > maxY) maxY = this.current[i + 1];
            }
            this.subpaths.push({ pts: this.current, minX, maxX, minY, maxY });
        }
        this.current = [];
    }

    finish(): void {
        this.flush();
    }

    /** Nonzero winding, matching the fill rule `render.ts` uses. */
    contains(px: number, py: number): boolean {
        let winding = 0;
        for (const sp of this.subpaths) {
            if (px < sp.minX || px > sp.maxX || py < sp.minY || py > sp.maxY) continue;
            const pts = sp.pts;
            for (let i = 0; i + 3 < pts.length; i += 2) {
                const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
                if (y0 <= py) {
                    if (y1 > py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) > 0) winding++;
                } else if (y1 <= py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) < 0) {
                    winding--;
                }
            }
        }
        return winding !== 0;
    }
}

// ---------------------------------------------------------------------------------------------------
// the two rejected shortcuts, kept so the harness is proven to discriminate.
// ---------------------------------------------------------------------------------------------------

/** Push hidden vertices radially onto the limb. Inverts the fill when a ring holds the antipode. */
function buildClampedPath(sink: PathSink, g: GlobeGeometry, cx: number, cy: number, R: number): void {
    foldPath(sink, g, cx, cy, R, r => (r > 0 ? 1 / r : 1));
}

/** Mirror hidden vertices across the limb to radius 2-r. Looks bijective; fails identically. */
function buildMirroredPath(sink: PathSink, g: GlobeGeometry, cx: number, cy: number, R: number): void {
    foldPath(sink, g, cx, cy, R, r => (r > 0 ? (2 - r) / r : 1));
}

function foldPath(
    sink: PathSink,
    g: GlobeGeometry,
    cx: number,
    cy: number,
    R: number,
    scaleFor: (r: number) => number,
): void {
    const { start, count, sx, sy, dep } = g;
    for (let k = 0; k < start.length; k++) {
        const s = start[k];
        const c = count[k];
        for (let i = s; i < s + c; i++) {
            let x = sx[i];
            let y = sy[i];
            if (dep[i] <= 0) {
                const r = Math.hypot(x, y);
                const f = scaleFor(r);
                x *= f;
                y *= f;
            }
            const gx = cx + x * R;
            const gy = cy - y * R;
            if (i === s) sink.moveTo(gx, gy);
            else sink.lineTo(gx, gy);
        }
        sink.closePath();
    }
}

// ---------------------------------------------------------------------------------------------------
// the comparison
// ---------------------------------------------------------------------------------------------------

const CX = 640;
const CY = 400;
const R = 336;

type Builder = (sink: PathSink, g: GlobeGeometry, cx: number, cy: number, r: number) => void;

/** Percentage of sampled in-disc pixels where the two independent answers disagree. */
function disagreementPct(camera: { lon: number; lat: number }, build: Builder, step = 11): number {
    projectGeometry(GEOMETRY, camera);
    const rec = new PathRecorder();
    build(rec, GEOMETRY, CX, CY, R);
    rec.finish();

    let checked = 0;
    let disagreed = 0;
    for (let py = CY - R; py <= CY + R; py += step) {
        for (let px = CX - R; px <= CX + R; px += step) {
            const ux = (px - CX) / R;
            const uy = -(py - CY) / R;
            // Stay clear of the limb: that last 2 % is where flattening and rasterisation noise live,
            // and it is not what this test is about.
            if (ux * ux + uy * uy > 0.9604) continue;
            const ll = unproject(ux, uy, camera);
            if (!ll) continue;
            checked++;
            if (isLandLonLat(ll[0], ll[1]) !== rec.contains(px, py)) disagreed++;
        }
    }
    expect(checked).toBeGreaterThan(500);
    return (disagreed / checked) * 100;
}

/**
 * The cameras. Latitude 15 is swept densely because it is `GLOBE_HOME.lat` — the band the auto-rotation
 * actually visits, and the band where the rejected shortcuts produce whole-frame-wrong output.
 */
const CAMERAS: { lon: number; lat: number }[] = [];
for (let lon = -180; lon < 180; lon += 20) CAMERAS.push({ lon, lat: 15 });
for (let lon = -180; lon < 180; lon += 60) CAMERAS.push({ lon, lat: -40 }, { lon, lat: 60 });
CAMERAS.push(
    { lon: 30, lat: 15 },      // the landing framing
    { lon: 8, lat: 61 },       // the fixture journeys in Jotunheimen
    { lon: 0, lat: -90 },      // straight down at Antarctica: the full polar cap
    { lon: 0, lat: 90 },
);

/** The framings that broke the shortcuts: the antipode falls inside the Africa-Eurasia ring. */
const INVERTING_CAMERAS = [
    { lon: -160, lat: 0 },
    { lon: -160, lat: 15 },
    { lon: -140, lat: 15 },
    { lon: 120, lat: 15 },
];

describe('buildLandPath agrees with an independent ray-cast of the source rings', () => {
    it('decoded the coastline the generator promised', () => {
        expect(RINGS.length).toBe(128);
        expect(GEOMETRY.pointCount).toBe(5015);
    });

    /**
     * MEASURED in this repo, 34 cameras at ~2826 in-disc samples each: mean disagreement **0.0167 %**,
     * worst **0.071 %** at camera (-140, 15). The residual is coastline-boundary sampling — a pixel whose
     * centre falls within half a pixel of a coast can legitimately land either side of it.
     *
     * The thresholds below sit roughly an order of magnitude above those figures, which is headroom for
     * float variation across platforms and NOT room for a real defect: every failure mode this test was
     * written to catch scores above 95 %, not 0.5 %.
     */
    it('disagrees with the ray-cast on under 1% of pixels at every camera', () => {
        const worst = { pct: 0, camera: CAMERAS[0] };
        let total = 0;
        for (const camera of CAMERAS) {
            const pct = disagreementPct(camera, (s, g, cx, cy, r) => {
                buildLandPath(s, g, cx, cy, r);
            });
            total += pct;
            if (pct > worst.pct) {
                worst.pct = pct;
                worst.camera = camera;
            }
            // Per-camera, not just on average: an average hides one catastrophic framing among 34 good
            // ones, and one catastrophic framing is what the rotation would park on twice a revolution.
            expect(
                pct,
                `camera ${camera.lon},${camera.lat} disagreed on ${pct.toFixed(3)}% of pixels`,
            ).toBeLessThan(1);
        }
        expect(total / CAMERAS.length).toBeLessThan(0.1);
    });

    it('is correct at the framings that invert the rejected shortcuts', () => {
        for (const camera of INVERTING_CAMERAS) {
            const pct = disagreementPct(camera, (s, g, cx, cy, r) => {
                buildLandPath(s, g, cx, cy, r);
            });
            expect(pct, `camera ${camera.lon},${camera.lat}`).toBeLessThan(1);
        }
    });

    /**
     * `LIMB_DIRECTION` is not a stylistic choice and cannot be reasoned out from the rings' winding.
     * MEASURED at camera (-160, 15): the pinned direction disagrees on 0.000 % of pixels and the opposite
     * one on **100.00 %**. So the constant is load-bearing, and this is the test that pins it.
     */
    it('only agrees in the pinned limb direction, which is why LIMB_DIRECTION is a measured constant', () => {
        const camera = { lon: -160, lat: 15 };
        const right = disagreementPct(camera, (s, g, cx, cy, r) => {
            buildLandPath(s, g, cx, cy, r, LIMB_DIRECTION);
        });
        const wrong = disagreementPct(camera, (s, g, cx, cy, r) => {
            buildLandPath(s, g, cx, cy, r, -LIMB_DIRECTION);
        });
        expect(right).toBeLessThan(1);
        expect(wrong).toBeGreaterThan(90);
    });
});

describe('the harness detects the failures MAP-02 rejected', () => {
    // Without these, "0.0167 % disagreement" would be an unfalsifiable claim.

    /** MEASURED: 95.90 % – 100.00 % of sampled pixels wrong at the four inverting framings. */
    it('catches radial clamping, which inverts the fill', () => {
        const worst = Math.max(
            ...INVERTING_CAMERAS.map(c => disagreementPct(c, buildClampedPath)),
        );
        expect(worst).toBeGreaterThan(90);
    });

    /** MEASURED: 99.93 % – 100.00 %. */
    it('catches limb mirroring, which fails the same way', () => {
        const worst = Math.max(
            ...INVERTING_CAMERAS.map(c => disagreementPct(c, buildMirroredPath)),
        );
        expect(worst).toBeGreaterThan(90);
    });

    /**
     * The finding that makes this whole harness necessary, and the reason a screenshot review would not
     * have saved us.
     *
     * MEASURED at the landing camera (30, 15): the correct clip disagrees on 0.035 % of pixels and BOTH
     * broken variants on 0.04 %. They are indistinguishable from correct on the first screen — so the
     * defect is invisible in the default framing, in the committed baselines, and to any reviewer who
     * looks at the globe without waiting for it to rotate a third of the way round.
     */
    it('shows the shortcuts are correct at the DEFAULT framing, which is how they would have shipped', () => {
        const correct = disagreementPct({ lon: 30, lat: 15 }, (s, g, cx, cy, r) => {
            buildLandPath(s, g, cx, cy, r);
        });
        const clamped = disagreementPct({ lon: 30, lat: 15 }, buildClampedPath);
        const mirrored = disagreementPct({ lon: 30, lat: 15 }, buildMirroredPath);
        expect(correct).toBeLessThan(1);
        expect(clamped).toBeLessThan(1);
        expect(mirrored).toBeLessThan(1);
    });
});

describe('buildLandPath structural behaviour', () => {
    it('emits nothing when the geometry is entirely behind the horizon', () => {
        const g = prepareGeometry([[0, 0, 1, 0, 1, 1]]);
        projectGeometry(g, { lon: 180, lat: 0 });
        const rec = new PathRecorder();
        expect(buildLandPath(rec, g, CX, CY, R)).toBe(false);
    });

    it('emits a closed subpath for a wholly visible ring, on the fast path', () => {
        const g = prepareGeometry([[0, 0, 4, 0, 4, 4, 0, 4]]);
        projectGeometry(g, { lon: 2, lat: 2 });
        const rec = new PathRecorder();
        expect(buildLandPath(rec, g, CX, CY, R)).toBe(true);
        rec.finish();
        expect(rec.subpaths.length).toBe(1);
        const pts = rec.subpaths[0].pts;
        // closePath repeats the first point.
        expect(pts.slice(0, 2)).toEqual(pts.slice(-2));
    });

    it('keeps a straddling ring inside the disc', () => {
        // A ring crossing the horizon must be closed along the limb, never chorded across the disc, and
        // must never leave the sphere.
        const g = prepareGeometry([[80, -10, 100, -10, 100, 10, 80, 10]]);
        projectGeometry(g, { lon: 0, lat: 0 });
        const rec = new PathRecorder();
        expect(buildLandPath(rec, g, CX, CY, R)).toBe(true);
        rec.finish();
        expect(rec.subpaths.length).toBeGreaterThan(0);
        for (const sp of rec.subpaths) {
            for (let i = 0; i < sp.pts.length; i += 2) {
                const d = Math.hypot(sp.pts[i] - CX, sp.pts[i + 1] - CY);
                expect(d).toBeLessThanOrEqual(R + 1e-6);
            }
        }
    });
});
