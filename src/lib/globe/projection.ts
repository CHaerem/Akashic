/**
 * Orthographic projection for the landing globe. (MAP-02)
 *
 * No map vendor, no token, no tile service, no shader — see `../map/boundary.test.ts`, which asserts
 * mechanically that nothing in this directory so much as names one. That is the whole point of MAP-02:
 * on the day a MapKit token lapses, a visitor still sees a rotating Earth rather than a void.
 *
 * ## Everything in here is pure, and that is deliberate
 *
 * This project's durable lesson is that code no tool executes is code nobody has verified — Vision in
 * the simulator, Intelligence behind `canImport`, entitlements without signing. A globe drawn with GL
 * shaders would put its most subtle arithmetic somewhere `vitest` cannot reach: the unit suite runs in
 * jsdom, where `canvas.getContext()` returns null. So the projection, the horizon clip
 * (`./horizon.ts`) and the hit test all live in functions that take numbers and return numbers, and
 * `./projection.test.ts` and `./horizon.test.ts` check them with no DOM at all. The component is the
 * thin part.
 *
 * ## Why the trigonometry is not in the per-frame path
 *
 * `lonLat -> unit sphere` is the only trig in the system and it runs ONCE, at load, in
 * `prepareGeometry`. A frame is then a rotation: composing `Rz(-lon0)` with `Ry(lat0)` and collapsing
 * it by hand gives eight multiplies and four adds per vertex, with four trig calls per FRAME rather
 * than per vertex, no branches and no allocation.
 *
 * Measured on the prototype this was taken from: 8.3 µs to project all of Natural Earth's 110m
 * coastline (5015 points), i.e. 0.05 % of a 60 fps budget, and a whole frame including rasterisation
 * at 0.2 ms p50 / 0.3 ms p95. Canvas 2D is not the constraint here, which is why MAP-02 does not need
 * WebGL — and why it should not have it, given the testability cost above.
 */

const DEG = Math.PI / 180;

/** A ring as flat `[lon, lat, lon, lat, ...]` degrees, unclosed — the shape `./coastline.ts` returns. */
export type FlatRing = number[];

/** Where the camera is looking, in degrees. The sphere rotates; there is no zoom and no bearing. */
export interface GlobeCamera {
    lon: number;
    lat: number;
}

/**
 * Coastline geometry with world-space unit vectors precomputed and camera-space scratch buffers.
 *
 * `sx`/`sy`/`dep` are overwritten by every `projectGeometry` call. They are part of the struct rather
 * than freshly allocated because a landing globe that allocates three Float32Arrays per frame would
 * hand the garbage collector 60 collections a second on the app's most-viewed screen.
 */
export interface GlobeGeometry {
    /** Points per ring, and where each ring starts in the flat buffers. */
    readonly start: Int32Array;
    readonly count: Int32Array;
    readonly pointCount: number;
    /** World-space unit-sphere coordinates, computed once. */
    readonly px: Float32Array;
    readonly py: Float32Array;
    readonly pz: Float32Array;
    /** Camera space, rewritten per frame: x east, y north, `dep` > 0 on the near hemisphere. */
    readonly sx: Float32Array;
    readonly sy: Float32Array;
    readonly dep: Float32Array;
}

/** A point projected into camera space. `depth > 0` means the near hemisphere. */
export interface ProjectedPoint {
    /** East, in unit-sphere radii: multiply by the globe radius and add the centre. */
    x: number;
    /** North, in unit-sphere radii. Canvas y grows downward, so canvas y is `cy - y * R`. */
    y: number;
    depth: number;
}

/**
 * Lift rings onto the unit sphere. Call once per dataset, never per frame.
 *
 * Rings are expected UNCLOSED (no repeated final point) — `decodeRings` drops the GeoJSON closing
 * duplicate, and the renderer closes paths itself.
 */
export function prepareGeometry(rings: readonly FlatRing[]): GlobeGeometry {
    let pointCount = 0;
    for (const r of rings) pointCount += r.length >> 1;

    const px = new Float32Array(pointCount);
    const py = new Float32Array(pointCount);
    const pz = new Float32Array(pointCount);
    const start = new Int32Array(rings.length);
    const count = new Int32Array(rings.length);

    let i = 0;
    rings.forEach((ring, k) => {
        start[k] = i;
        count[k] = ring.length >> 1;
        for (let j = 0; j < ring.length; j += 2) {
            const lon = ring[j] * DEG;
            const lat = ring[j + 1] * DEG;
            const cosLat = Math.cos(lat);
            px[i] = cosLat * Math.cos(lon);
            py[i] = cosLat * Math.sin(lon);
            pz[i] = Math.sin(lat);
            i++;
        }
    });

    return {
        start,
        count,
        pointCount,
        px,
        py,
        pz,
        sx: new Float32Array(pointCount),
        sy: new Float32Array(pointCount),
        dep: new Float32Array(pointCount),
    };
}

/**
 * Rotate every vertex into camera space. This is the per-frame hot loop; see the header for its cost.
 *
 * `dep` is a LINEAR functional of the world-space point, which `./horizon.ts` depends on: it means a
 * chord between a visible and a hidden vertex meets the horizon at exactly `t = depA / (depA - depB)`,
 * with no iteration and no trig.
 */
export function projectGeometry(g: GlobeGeometry, camera: GlobeCamera): void {
    const lon0 = camera.lon * DEG;
    const lat0 = camera.lat * DEG;
    const a = Math.cos(lon0);
    const b = Math.sin(lon0);
    const c = Math.cos(lat0);
    const d = Math.sin(lat0);
    const { pointCount, px, py, pz, sx, sy, dep } = g;

    for (let i = 0; i < pointCount; i++) {
        const X = px[i];
        const Y = py[i];
        const Z = pz[i];
        const u = a * X + b * Y;
        sx[i] = a * Y - b * X;
        dep[i] = c * u + d * Z;
        sy[i] = c * Z - d * u;
    }
}

/**
 * Project one lon/lat without touching the buffers — for journey pins and for hit-testing.
 *
 * Back-face culling for a pin is just `depth > 0`. Skipping it would float a pin for a journey in
 * Norway over the middle of the Pacific whenever the rotation carried Norway to the far side.
 */
export function projectPoint(lon: number, lat: number, camera: GlobeCamera): ProjectedPoint {
    const lonR = lon * DEG;
    const latR = lat * DEG;
    const cosLat = Math.cos(latR);
    const X = cosLat * Math.cos(lonR);
    const Y = cosLat * Math.sin(lonR);
    const Z = Math.sin(latR);

    const lon0 = camera.lon * DEG;
    const lat0 = camera.lat * DEG;
    const a = Math.cos(lon0);
    const b = Math.sin(lon0);
    const c = Math.cos(lat0);
    const d = Math.sin(lat0);
    const u = a * X + b * Y;

    return { x: a * Y - b * X, y: c * Z - d * u, depth: c * u + d * Z };
}

/**
 * Inverse projection: a screen offset in unit-sphere radii back to lon/lat on the NEAR hemisphere.
 * Returns null outside the disc.
 *
 * Used for drag-to-spin, and as the other half of a round-trip assertion on `projectPoint` — a forward
 * projection that agrees with an independent inverse over a grid of samples is hard to be subtly wrong
 * about, which the pin hit test is otherwise the likeliest thing here to be.
 *
 * Note pins are NOT hit-tested through this. See `hitTestPins`.
 */
export function unproject(ux: number, uy: number, camera: GlobeCamera): [number, number] | null {
    const r2 = ux * ux + uy * uy;
    if (r2 > 1) return null;

    const uz = Math.sqrt(1 - r2);
    const lon0 = camera.lon * DEG;
    const lat0 = camera.lat * DEG;
    const c = Math.cos(lat0);
    const d = Math.sin(lat0);

    const u = c * uz - d * uy;
    const Z = d * uz + c * uy;
    const a = Math.cos(lon0);
    const b = Math.sin(lon0);
    const X = a * u - b * ux;
    const Y = b * u + a * ux;

    return [Math.atan2(Y, X) / DEG, Math.asin(Math.max(-1, Math.min(1, Z))) / DEG];
}

/** Geometry of the drawn sphere within a canvas, in CSS pixels. */
export interface GlobeViewport {
    cx: number;
    cy: number;
    radius: number;
}

/** Where the sphere sits in a container: centred, with a margin so the limb glow is not clipped. */
export function viewportFor(width: number, height: number): GlobeViewport {
    // 0.86 of the half-minor-axis leaves room for the atmosphere bloom, which extends to 1.11 R.
    return { cx: width / 2, cy: height / 2, radius: (Math.min(width, height) / 2) * 0.86 };
}

/** A journey pin as drawn: canvas position in CSS pixels, already culled to the near hemisphere. */
export interface ScreenPin {
    id: string;
    x: number;
    y: number;
}

/** Project journey coordinates to canvas CSS pixels, dropping anything on the far hemisphere. */
export function projectPins(
    treks: readonly { id: string; lng: number; lat: number }[],
    camera: GlobeCamera,
    vp: GlobeViewport,
): ScreenPin[] {
    const out: ScreenPin[] = [];
    for (const t of treks) {
        const p = projectPoint(t.lng, t.lat, camera);
        if (p.depth <= 0) continue;
        out.push({ id: t.id, x: vp.cx + p.x * vp.radius, y: vp.cy - p.y * vp.radius });
    }
    return out;
}

/** Pointer slop for a 6 px pin. Generous on purpose: the pin is small and the sphere is moving. */
export const PIN_HIT_RADIUS_PX = 22;

/**
 * Which pin is under a pointer, or null.
 *
 * Deliberately a FORWARD projection compared in CSS pixels, rather than inverse-projecting the click
 * into lon/lat and asking which journey is nearest. Two reasons, and the second is the one that matters:
 *
 * - There are two journeys, so projecting both is cheaper than one `unproject`.
 * - **`devicePixelRatio` cancels by construction.** Both sides of the comparison are CSS pixels —
 *   `event.clientX - rect.left` against a pin position derived from the same CSS-pixel viewport — so
 *   the backing-store scale never enters the arithmetic. The inverse-projection route has to divide it
 *   out explicitly, and getting that wrong is invisible on a 1x display and wrong on every phone.
 *
 * This matters more than it looks: pin clicking is covered by NO e2e spec, because every spec selects
 * a journey through `window.testHelpers.selectTrek()`, which calls the React callback directly and
 * never touches the canvas. A broken hit test ships green. Hence `./projection.test.ts` covers it at
 * three device pixel ratios.
 */
export function hitTestPins(pins: readonly ScreenPin[], x: number, y: number): string | null {
    let best: string | null = null;
    let bestDist = PIN_HIT_RADIUS_PX * PIN_HIT_RADIUS_PX;
    for (const p of pins) {
        const dx = p.x - x;
        const dy = p.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestDist) {
            bestDist = d2;
            best = p.id;
        }
    }
    return best;
}

/** Normalise a longitude to (-180, 180]. Rotation accumulates without bound otherwise. */
export function wrapLongitude(lon: number): number {
    let l = ((lon + 180) % 360 + 360) % 360 - 180;
    if (l === -180) l = 180;
    return l;
}

/**
 * Where the camera sits when nothing is selected: `[30, 15]`.
 *
 * Same value as the Mapbox globe's `GLOBE_CENTER` (`src/hooks/mapbox/types.ts`), so the landing framing
 * does not shift as part of this swap. Latitude 15 is also the band the auto-rotation sweeps, which is
 * why `./horizon.test.ts` samples it densely.
 */
export const GLOBE_HOME: GlobeCamera = { lon: 30, lat: 15 };

/** Clamp for hand-dragging: past ±80° the pole is on screen and further tilt just disorients. */
export function clampLatitude(lat: number): number {
    return Math.max(-80, Math.min(80, lat));
}
