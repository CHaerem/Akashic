/**
 * Turning the globe to face a journey, and back. (MAP-02)
 *
 * The Mapbox globe used `flyTo` with a zoom change: zoom 3.5 (3 on mobile) over 2500 ms on selection,
 * back to `[30, 15]` at zoom 1.5 (1.2 mobile) over 3000 ms on deselect. **Literal zoom parity is
 * deliberately not reproduced.** Zooming an orthographic globe drawn from 110m vector coastlines rewards
 * the visitor with a bigger polygon and nothing else — there is no imagery underneath to resolve. So a
 * selection rotates the sphere to bring the pin to the centre and stops there; the journey view is what
 * shows detail.
 *
 * Dropping zoom also deletes a whole bug class rather than porting it. About 100 lines of the Mapbox
 * hook (`isFlyingToGlobeRef` / `needsGlobeRecenterRef` / `skipRecenterRef` / `targetCenterRef` and a
 * `moveend` handler that re-issues a 2000 ms `flyTo`) exist only because a user gesture can cancel a
 * `flyTo` mid-flight and leave the camera framed nowhere. With no free-pan and no zoom there is nothing
 * to recover from, so none of it is carried over.
 */

/** Matches the Mapbox globe's selection flight, so the screen's rhythm does not change. */
export const SELECT_DURATION_MS = 2500;
/** And its slower return, which reads as the globe relaxing rather than snapping back. */
export const RETURN_DURATION_MS = 3000;

/** Cubic ease-out — the same shape as the easing the Mapbox flight used. */
export function easeOutCubic(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    return 1 - Math.pow(1 - c, 3);
}

/**
 * Signed shortest way round from one longitude to another, in (-180, 180].
 *
 * Without this, rotating from +170° to -170° travels 340° the wrong way: the globe spins most of a
 * revolution to reach a point 20° away. Cheap to get wrong and very visible.
 */
export function shortestLonDelta(from: number, to: number): number {
    let d = (to - from) % 360;
    if (d > 180) d -= 360;
    if (d <= -180) d += 360;
    return d;
}

export interface CameraTween {
    fromLon: number;
    fromLat: number;
    toLon: number;
    toLat: number;
    startedAt: number;
    durationMs: number;
}

/**
 * Where the camera is part-way through a tween, and whether it is finished.
 *
 * `done` is what clears `hasPendingAnimations`. Auto-rotation must NOT report through this — see
 * `AkashicGlobe.tsx`, where that distinction is load-bearing for the e2e suite.
 */
export function tweenAt(tween: CameraTween, now: number): { lon: number; lat: number; done: boolean } {
    const raw = (now - tween.startedAt) / tween.durationMs;
    const done = raw >= 1;
    const e = easeOutCubic(raw);
    return {
        lon: tween.fromLon + shortestLonDelta(tween.fromLon, tween.toLon) * e,
        lat: tween.fromLat + (tween.toLat - tween.fromLat) * e,
        done,
    };
}
