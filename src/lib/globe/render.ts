/**
 * Paint the globe into a 2D canvas. (MAP-02)
 *
 * ## What this replaces, and what it deliberately gives up
 *
 * The Mapbox globe drew photographic satellite imagery (`mapbox://styles/mapbox/satellite-v9`) over a
 * raster-DEM terrain source at exaggeration 1.2. Both are token-gated tile services, so both are out by
 * definition — MAP-02's requirement is that the landing view keeps working when there is no token at
 * all. **This is a visible product change to the first screen a paying customer sees: photographic
 * Earth becomes stylised vector Earth.** It is a product decision, not a technical one, and it belongs
 * in front of the owner with a screenshot rather than in a diff.
 *
 * What carries the visual weight instead, all of it for zero bytes:
 *
 * - an ocean gradient whose light centre is offset to the upper-left, which is what makes a circle read
 *   as a ball rather than as a sticker;
 * - a terminator sharing that light direction, so land and sea are lit from the same place;
 * - an inner rim light along the limb;
 * - an atmosphere bloom OUTSIDE the sphere, reproducing the colours of Mapbox's `setFog`
 *   (`rgb(186,210,235)` inner, `rgb(36,92,223)` outer) with two radial gradients.
 *
 * The starfield is NOT drawn here. It stays a CSS background on a sibling element, exactly as the
 * Mapbox globe had it, because the e2e suite permits exactly one `<canvas>` in the tree —
 * `expect(page.locator('canvas')).toBeVisible()` and `.boundingBox()` both throw a strict-mode
 * violation on two matches. That constraint is why a second canvas for stars is not an option.
 *
 * ## Two things measured, so they are not re-litigated
 *
 * **Geodesic subdivision of long coastline segments is not worth doing.** The maximum screen deviation
 * between a projected geodesic and its straight chord is `R·θ²/8`: at the shipped 515 px globe that is
 * 0.003 px at the median segment (0.567°), 0.012 px at p90, and 0.245 px even for a 5° segment. The
 * visible coarseness of 110m data is the polyline's own resolution — Norway's fjords are simply absent —
 * and subdivision cannot add detail that is not in the data. It would multiply the geometry for nothing.
 *
 * **A frame is not close to the budget.** 0.2 ms p50 / 0.3 ms p95 for the whole thing, of which the
 * projection arithmetic is ~4 %; the rest is one fill, one stroke and four gradients. So the Mapbox
 * globe's 30 fps mobile cap is not carried over — it existed because Mapbox was re-rendering a textured
 * 3D scene, not because 1.5°/s needs fewer frames.
 */

import { buildLandPath } from './horizon';
import type { GlobeGeometry, GlobeViewport, ScreenPin } from './projection';
import { projectPins, projectPoint } from './projection';

/** Everything a frame needs. `geometry` is null until the coastline chunk resolves. */
export interface GlobeFrame {
    width: number;
    height: number;
    viewport: GlobeViewport;
    camera: { lon: number; lat: number };
    geometry: GlobeGeometry | null;
    treks: readonly { id: string; lng: number; lat: number }[];
    selectedId: string | null;
    hoverId: string | null;
}

const TWO_PI = Math.PI * 2;

/**
 * Tint the land white near whichever pole is on screen, so the ice caps are not continent-green.
 *
 * Worth the fifteen lines: with a single flat land fill, **Antarctica renders the same green as Africa**,
 * and a green Antarctica reads as broken rather than as stylised — it is the most obviously wrong thing on
 * the whole screen the moment the camera goes south, which drag-to-spin reaches immediately.
 *
 * Deliberately NOT a second dataset. `ne_110m_glaciated_areas` exists and would be more truthful, but it
 * costs ~21.7 kB raw / 8.7 kB gzip on a feature whose entire geometry budget is 36 kB, and at globe scale
 * a latitude-driven tint is indistinguishable from it. This costs nothing: it is a radial gradient centred
 * on the projected pole, clipped to the land path the caller just built, so the Arctic Ocean stays water
 * and only land takes the tint. Greenland picking up a partial cap is correct rather than a side effect.
 *
 * Must be called while the land path is still current and inside the sphere clip.
 */
function drawIceCaps(
    ctx: CanvasRenderingContext2D,
    camera: { lon: number; lat: number },
    cx: number,
    cy: number,
    R: number,
): void {
    ctx.save();
    ctx.clip('nonzero');
    for (const poleLat of [90, -90]) {
        const p = projectPoint(0, poleLat, camera);

        // Only when the pole is genuinely on the near side, and faded by how squarely we see it.
        //
        // Both halves of that are needed, and the first version had neither: it drew whenever the pole was
        // within 0.4 of the horizon, which at the landing camera (lat 15) put the south pole just BEHIND
        // the limb at depth -0.26 and still painted a 0.55 R gradient up from the bottom edge. Orthographic
        // projection compresses latitude towards the limb, so that gradient reached far inland and **turned
        // southern Africa white** in the regenerated desktop baseline. Caught by looking at the PNG, which
        // is the only thing that catches it: CI runs `--ignore-snapshots`.
        if (p.depth <= 0.05) continue;
        const fade = Math.min(1, p.depth / 0.45);

        const px = cx + p.x * R;
        const py = cy - p.y * R;
        // 0.48 R is ~29 degrees of arc, just inside Antarctica's reach from the pole, so the tint stops
        // short of Tierra del Fuego and New Zealand.
        const ice = ctx.createRadialGradient(px, py, 0, px, py, R * 0.48);
        ice.addColorStop(0, `rgba(240,247,253,${(0.92 * fade).toFixed(3)})`);
        ice.addColorStop(0.55, `rgba(226,240,250,${(0.45 * fade).toFixed(3)})`);
        ice.addColorStop(1, 'rgba(226,240,250,0)');
        ctx.fillStyle = ice;
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    }
    ctx.restore();
}

/** Paint one frame. Returns the pins actually drawn, which is what the hit test compares against. */
export function drawGlobe(ctx: CanvasRenderingContext2D, frame: GlobeFrame): ScreenPin[] {
    const { width, height, camera, geometry, treks, selectedId, hoverId } = frame;
    const { cx, cy, radius: R } = frame.viewport;

    ctx.clearRect(0, 0, width, height);

    // ---- atmosphere, outside the sphere. Without it the disc reads flat.
    const halo = ctx.createRadialGradient(cx, cy, R * 0.985, cx, cy, R * 1.11);
    halo.addColorStop(0, 'rgba(186,210,235,0.55)');
    halo.addColorStop(0.35, 'rgba(96,140,220,0.22)');
    halo.addColorStop(1, 'rgba(36,92,223,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.11, 0, TWO_PI);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TWO_PI);
    ctx.clip();

    // ---- ocean, lit from the upper-left.
    const sea = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.42, R * 0.05, cx, cy, R * 1.02);
    sea.addColorStop(0, '#2c5c86');
    sea.addColorStop(0.45, '#183d61');
    sea.addColorStop(0.85, '#0d2340');
    sea.addColorStop(1, '#081a30');
    ctx.fillStyle = sea;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    // ---- land. The horizon clip is in ./horizon.ts; read its header before touching it.
    if (geometry) {
        ctx.beginPath();
        if (buildLandPath(ctx, geometry, cx, cy, R)) {
            // NONZERO so the Caspian hole punches out — see buildLandPath's contract.
            ctx.fillStyle = '#3d5a44';
            ctx.fill('nonzero');
            ctx.strokeStyle = 'rgba(150,190,160,0.55)';
            ctx.lineWidth = 0.7;
            ctx.stroke();
            drawIceCaps(ctx, camera, cx, cy, R);
        }
    }

    // ---- terminator, same light direction as the ocean gradient.
    const term = ctx.createRadialGradient(
        cx - R * 0.3,
        cy - R * 0.35,
        R * 0.15,
        cx + R * 0.25,
        cy + R * 0.3,
        R * 1.35,
    );
    term.addColorStop(0, 'rgba(255,250,235,0.10)');
    term.addColorStop(0.5, 'rgba(0,0,0,0)');
    term.addColorStop(1, 'rgba(0,4,16,0.62)');
    ctx.fillStyle = term;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    // ---- inner rim light along the limb.
    const rim = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R);
    rim.addColorStop(0, 'rgba(140,190,240,0)');
    rim.addColorStop(1, 'rgba(170,205,245,0.45)');
    ctx.fillStyle = rim;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    // ---- journey pins, culled to the near hemisphere by projectPins.
    // Paint order and sizes match the Mapbox globe's marker paint: a 12 px blurred glow under a 6 px
    // white dot at 0.92 alpha with a 1 px stroke, so the landing screen keeps its existing vocabulary.
    const pins = projectPins(treks, camera, frame.viewport);
    for (const pin of pins) {
        const emphasised = pin.id === selectedId || pin.id === hoverId;
        const glowR = emphasised ? 16 : 12;
        const glow = ctx.createRadialGradient(pin.x, pin.y, 0, pin.x, pin.y, glowR);
        glow.addColorStop(0, 'rgba(255,255,255,0.30)');
        glow.addColorStop(0.45, 'rgba(255,255,255,0.16)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(pin.x, pin.y, glowR, 0, TWO_PI);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(pin.x, pin.y, pin.id === selectedId ? 7 : 6, 0, TWO_PI);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    return pins;
}

/**
 * Size a canvas to its container at the device pixel ratio, and scale the context so all drawing is in
 * CSS pixels.
 *
 * Not a parity item — a NEW responsibility. Mapbox owned the backing store, and a 1x canvas on a 3x
 * phone gives visibly jagged coastlines that `mobile.spec.ts`'s 393 px-wide screenshots would show.
 *
 * The ratio is capped at 2.5: fill cost is quadratic in it and there is no detail beyond that point to
 * reveal, since the coastline is 110m vector data rather than imagery.
 *
 * Returns false when nothing changed, so the caller can skip a redraw.
 */
export function resizeCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): boolean {
    const dpr = Math.min(2.5, Math.max(1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext('2d');
    // setTransform rather than scale(): this runs on every resize, and scale() compounds.
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
}
