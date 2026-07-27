/**
 * Clip the coastline to the visible hemisphere and emit it as a fillable path. (MAP-02)
 *
 * This is the one genuinely subtle piece of a hand-written orthographic globe. Read the failure history
 * before changing it, because two cheaper approaches look obviously correct and are catastrophically
 * wrong in a way that a screenshot of the default framing does not reveal.
 *
 * ## Both cheap tricks invert the fill, and the rotation reaches the framing that does it
 *
 * A ring that straddles the horizon has to be closed ALONG THE LIMB. The two tempting shortcuts are to
 * take each hidden vertex and either
 *
 *   - **clamp** it radially onto the limb (`r -> 1`), or
 *   - **mirror** it across the limb (`r -> 2 - r`), which is a continuous bijection of the sphere onto
 *     a disc of radius 2 and therefore *looks* provably sound,
 *
 * and both draw ocean as land whenever a ring encloses the camera's ANTIPODE. Measured at camera
 * 160°W / 0°, where the antipode falls in Africa so the Africa–Eurasia ring contains it: **99.995 % of
 * sampled pixels wrong** — the Pacific fills as a continent and Australia renders as ocean.
 *
 * Reproduced independently during review at latitude 15, sweeping longitude: under the nonzero winding
 * that `fill()` actually uses, whole-frame-wrong output at longitudes −160, −140 and +120. **Latitude 15
 * is `GLOBE_HOME.lat`** — the band the auto-rotation sweeps continuously — so this is not a corner case
 * reachable by a determined tester. It is a guaranteed full-screen defect with a ~30-second period, on
 * the first screen a paying customer sees, and it passes "a canvas is visible", passes `isMapReady()`,
 * and CI runs `--ignore-snapshots` so no baseline catches it.
 *
 * A third attempt — closing each ring along the limb using the ring's own winding — fails too, and the
 * numbers show why there is no cheap fix: at one camera the Africa–Eurasia ring needs a 270.2° closing
 * arc while its neighbour needs 2.2°, and a shared winding cannot separate those cases.
 *
 * ## The algorithm, which is the standard clip of a polygon set to a circular window
 *
 *   1. cut each ring into runs of consecutive VISIBLE vertices, with exact limb crossings;
 *   2. record every run's entry and exit angle on the limb;
 *   3. stitch: at a run's exit, follow the limb to the next ENTRY angle and continue from that run.
 *
 * Runs from *different* rings stitch to each other, and that is correct rather than a bug — what gets
 * filled is the boundary of (land ∩ near hemisphere), and along the limb that boundary alternates
 * entry/exit by construction.
 *
 * Two things make it cheap. `dep` is a linear functional of the world-space point (see
 * `./projection.ts`), so a crossing is exact at `t = depA / (depA - depB)` — no iteration, no trig — and
 * normalising the result lands it on the limb because scaling cannot change a linear functional's sign.
 * And crossings are rare: measured 8 straddling rings and ~20 crossings at the worst framing, against
 * 5015 projected vertices, so 120 of 128 rings take a fast path with no crossing logic at all.
 *
 * `./horizon.test.ts` verifies this against an independent ray-cast of the source rings over 40 cameras,
 * and asserts that the two broken variants above still fail — a correctness test that cannot tell right
 * from wrong is worse than none.
 */

import type { GlobeGeometry } from './projection';

const TAU = Math.PI * 2;

/**
 * The subset of `CanvasRenderingContext2D` / `Path2D` this needs.
 *
 * Named as an interface so the clipper can be driven by a plain recorder object in tests. The unit
 * suite runs in jsdom, where `getContext('2d')` returns null and `Path2D` does not exist, so without
 * this seam the most defect-prone function in MAP-02 would be reachable only from a browser.
 */
export interface PathSink {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arc(
        x: number,
        y: number,
        radius: number,
        startAngle: number,
        endAngle: number,
        counterclockwise?: boolean,
    ): void;
    closePath(): void;
}

/**
 * Direction to travel along the limb when stitching runs together.
 *
 * Fixed by measurement, not by reasoning about winding: `horizon.test.ts` runs the ground-truth check
 * at both values and only one of them agrees with the ray-cast. Natural Earth's rings are 127 CW and
 * 1 CCW (the CCW one is the Caspian Sea, a hole inside the Africa–Eurasia ring), and a shared winding
 * is exactly what the failed third attempt above proved insufficient — so this constant is pinned by a
 * test and must stay pinned by one.
 */
export const LIMB_DIRECTION = 1;

/**
 * Build the visible-hemisphere land path into `sink`.
 *
 * Expects `projectGeometry` to have already run for the camera being drawn. Returns whether anything
 * was emitted, so a caller can skip a pointless `fill()`.
 *
 * The caller owns `beginPath()` and the fill rule. **Fill NONZERO**: the 127 outer rings share a
 * winding and the single hole carries the opposite one, so nonzero punches the Caspian out with no
 * hole bookkeeping here. Even-odd would also work for the hole but would cancel wherever two stitched
 * runs overlap.
 */
export function buildLandPath(
    sink: PathSink,
    g: GlobeGeometry,
    cx: number,
    cy: number,
    R: number,
    dir: number = LIMB_DIRECTION,
): boolean {
    const { start, count, sx, sy, dep } = g;
    const runs: {
        enter: [number, number];
        leave: [number, number];
        pts: number[];
        enterAng: number;
        leaveAng: number;
        used: boolean;
    }[] = [];
    let drewAnything = false;

    for (let k = 0; k < start.length; k++) {
        const s = start[k];
        const c = count[k];

        let visible = 0;
        for (let i = s; i < s + c; i++) if (dep[i] > 0) visible++;
        if (visible === 0) continue;

        if (visible === c) {
            // Wholly visible: the common case (120 of 128 rings at the worst framing), no crossings.
            for (let i = s; i < s + c; i++) {
                const gx = cx + sx[i] * R;
                const gy = cy - sy[i] * R;
                if (i === s) sink.moveTo(gx, gy);
                else sink.lineTo(gx, gy);
            }
            sink.closePath();
            drewAnything = true;
            continue;
        }

        const idx = (i: number) => s + (((i % c) + c) % c);

        /** Exact horizon crossing on the chord a->b. Linear in `dep`, so no iteration and no trig. */
        const cross = (a: number, b: number): [number, number] => {
            const t = dep[a] / (dep[a] - dep[b]);
            const X = sx[a] + (sx[b] - sx[a]) * t;
            const Y = sy[a] + (sy[b] - sy[a]) * t;
            const m = Math.hypot(X, Y) || 1;
            return [X / m, Y / m];
        };

        // Start at a vertex that is visible while its predecessor is not: the first entry.
        let first = -1;
        for (let j = 0; j < c; j++) {
            if (dep[idx(j)] > 0 && dep[idx(j - 1)] <= 0) {
                first = j;
                break;
            }
        }
        if (first < 0) continue;

        for (let j = first; j < first + c; ) {
            const enter = cross(idx(j - 1), idx(j));
            const pts: number[] = [];
            let j2 = j;
            while (dep[idx(j2)] > 0) {
                pts.push(idx(j2));
                j2++;
            }
            const leave = cross(idx(j2 - 1), idx(j2));
            runs.push({
                enter,
                leave,
                pts,
                // Canvas angles: y grows downward, so the y component is negated.
                enterAng: Math.atan2(-enter[1], enter[0]),
                leaveAng: Math.atan2(-leave[1], leave[0]),
                used: false,
            });
            while (j2 < first + c && dep[idx(j2)] <= 0) j2++;
            j = j2;
        }
    }

    if (runs.length === 0) return drewAnything;

    /** Angular distance from a to b following `dir`, always in [0, TAU). */
    const forward = (a: number, b: number): number => {
        let d = dir > 0 ? b - a : a - b;
        d %= TAU;
        if (d < 0) d += TAU;
        return d;
    };

    for (let r0 = 0; r0 < runs.length; r0++) {
        if (runs[r0].used) continue;
        let run = runs[r0];
        sink.moveTo(cx + run.enter[0] * R, cy - run.enter[1] * R);
        const startAng = run.enterAng;

        // Bounded by the run count: every iteration consumes one run, so a malformed stitch cannot
        // spin forever on the landing screen.
        let guard = 0;
        while (guard++ <= runs.length) {
            run.used = true;
            for (const i of run.pts) sink.lineTo(cx + sx[i] * R, cy - sy[i] * R);
            sink.lineTo(cx + run.leave[0] * R, cy - run.leave[1] * R);

            // Which run's ENTRY comes next along the limb from this exit?
            let best: typeof run | null = null;
            let bestD = Infinity;
            for (const cand of runs) {
                const d = forward(run.leaveAng, cand.enterAng);
                if (d < bestD) {
                    bestD = d;
                    best = cand;
                }
            }

            // A used run means the loop has closed — normally back to where this path began, since the
            // current run is marked used above and a single-run loop finds its own entry.
            if (!best || best.used) {
                sink.arc(cx, cy, R, run.leaveAng, best ? best.enterAng : startAng, dir < 0);
                break;
            }
            sink.arc(cx, cy, R, run.leaveAng, best.enterAng, dir < 0);
            run = best;
        }
        sink.closePath();
        drewAnything = true;
    }

    return drewAnything;
}
