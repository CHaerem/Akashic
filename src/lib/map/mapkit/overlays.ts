/**
 * The route line and the active-day highlight, as MapKit overlays. (MAP-03)
 *
 * ## Three findings shape everything here
 *
 * 1. **`mapkit.Style` has no blur, glow or shadow.** The settable set is closed at 13 keys; any other key
 *    logs `[MapKit] Style has no property named …` and is dropped. So Mapbox's `line-blur` — 8 px under the
 *    base route and 10 px under the active segment, in the deleted `src/hooks/mapbox/layerConfigs.ts:196-206`
 *    — has no translation, and the substitute is
 *    {@link HALO_LAYERS} — three overlays on the same points at widening width and falling opacity.
 *    MEASURED to read as a genuine soft glow at satellite zoom (`surface-probe/?probe=halo`).
 * 2. **Overlay z-order IS add order.** A 3 px white line added after a 20 px red line on identical points
 *    paints over it. So glow-under-core needs no z-index API — but it does mean {@link addRouteOverlays}
 *    must add in the right sequence, and that a later-added active segment sits above the base route by
 *    construction.
 * 3. **`lineGradient` is accepted and paints NOTHING — and suppresses the stroke.** A polyline carrying both
 *    `strokeColor: '#ff8800'` and a `lineGradient` rendered as absolutely nothing, with `style.lineGradient`
 *    reading back truthy and no throw, warning or `error` event. Anything relying on it ships an invisible
 *    route. It is deliberately absent from `MKStyleOptions` in `./mapkitTypes.ts`. (The brief's premise that
 *    the incumbent uses `lineGradient` was also wrong — there are zero occurrences in `src/`.)
 *
 * ## Why the selected journey's route is added and removed rather than preloaded and toggled
 *
 * The incumbent creates a source and two layers for **every** journey at map init and flips
 * `visibility` (`useMapbox.ts:687-706`, `:1005-1011`). MapKit overlays have no layout property, so
 * "preload and toggle" collapses into add/remove anyway — at which point a 2N-overlay registry buys nothing
 * over adding the one pair that is visible.
 *
 * ## MAP-05: "the incumbent" is GONE, and every citation below is history
 *
 * This file was written against a shipping Mapbox surface and refers to it in the present tense as **"the
 * incumbent"**, citing `useMapbox.ts`, `layerConfigs.ts` and `MapboxGlobe.tsx` by line. MAP-05 DELETED all of
 * it (2707 lines). So: read every "the incumbent does X" below as "the Mapbox surface did X, until MAP-05",
 * and expect none of those paths to resolve — `git log --diff-filter=D -- src/hooks/mapbox/` recovers them.
 *
 * The prose is kept rather than rewritten because each citation is the MEASUREMENT that explains why the code
 * here is shaped as it is, and that reason did not stop being true when the file it measured went away. A
 * mechanical tense-scrub across ~36 of these would have risked the measurements to fix a verb, so the term is
 * retired here instead of edited everywhere.
 */

import type { LngLat } from '../types';
import type { MapKitNamespace, MKMap, MKPolylineOverlay, MKCoordinate } from './mapkitTypes';
import { toLatLng } from './coords';
import type { Region } from './camera';
import type { RouteCoord } from './geometry';

/** Build the vendor coordinate. The one place `mapkit.Coordinate` is constructed for a line. */
function coordinate(mapkit: MapKitNamespace, point: LngLat | RouteCoord): MKCoordinate {
    const { latitude, longitude } = toLatLng(point);
    return new mapkit.Coordinate(latitude, longitude);
}

export function regionOf(mapkit: MapKitNamespace, region: Region) {
    return new mapkit.CoordinateRegion(
        new mapkit.Coordinate(region.center[1], region.center[0]),
        new mapkit.CoordinateSpan(region.latitudeDelta, region.longitudeDelta),
    );
}

/**
 * The base route: a wide translucent white under a narrow solid white.
 *
 * Widths and colour match the incumbent (`useMapbox.ts:687-706`: a 12 px blurred glow plus a 2 px stroke).
 * The glow is a hard-edged stroke here rather than a blurred one — ARCH-01 accepted losing `line-blur`, and
 * faking it with something that looks worse was explicitly ruled out. At 0.3 opacity and 12 px it still
 * separates the route from bright snow, which is what the glow was for.
 */
const ROUTE_LAYERS: { lineWidth: number; strokeOpacity: number }[] = [
    { lineWidth: 12, strokeOpacity: 0.3 },
    { lineWidth: 2, strokeOpacity: 1 },
];

/**
 * The active-day halo — Mapbox's 15 px blurred cyan glow plus 4 px stroke, rebuilt from three hard strokes.
 *
 * Measured to read as a real glow; see the header. Add order is paint order, so widest first.
 */
const HALO_LAYERS: { lineWidth: number; strokeOpacity: number }[] = [
    { lineWidth: 24, strokeOpacity: 0.15 },
    { lineWidth: 14, strokeOpacity: 0.3 },
    { lineWidth: 5, strokeOpacity: 1 },
];

const ROUTE_COLOR = '#ffffff';
/**
 * The active-day cyan, `#00ffff`.
 *
 * Carried over from the Mapbox surface's `ACTIVE_SEGMENT_GLOW_PAINT` / `ACTIVE_SEGMENT_LINE_PAINT`, both of
 * which used this exact value. Those lived in `src/hooks/mapbox/layerConfigs.ts` and MAP-05 deleted them, so
 * this is now the only definition of the colour — it is written out rather than cited for that reason.
 */
const ACTIVE_COLOR = '#00ffff';

export interface RouteOverlays {
    base: MKPolylineOverlay[];
    /**
     * The day highlight. Laid over the FULL route points, not a slice: the visible extent is set with
     * `strokeStart`/`strokeEnd`, which MEASURED are fractions of arc length. So a day change is six property
     * writes and no geometry rebuild, and the highlight cannot drift out of alignment with the base route.
     */
    active: MKPolylineOverlay[];
}

/**
 * Create and add the overlays for one journey's route.
 *
 * The active-day overlays are added **after** the base pair and therefore paint above it, and start hidden
 * (`strokeEnd: 0`) because a journey opens on its overview with no day selected.
 */
export function addRouteOverlays(
    mapkit: MapKitNamespace,
    map: MKMap,
    coordinates: readonly RouteCoord[],
): RouteOverlays {
    const points = coordinates.map(c => coordinate(mapkit, c));

    const base = ROUTE_LAYERS.map(({ lineWidth, strokeOpacity }) => {
        const overlay = new mapkit.PolylineOverlay(points, {
            style: new mapkit.Style({
                strokeColor: ROUTE_COLOR, strokeOpacity, lineWidth, lineCap: 'round', lineJoin: 'round',
            }),
        });
        map.addOverlay(overlay);
        return overlay;
    });

    const active = HALO_LAYERS.map(({ lineWidth, strokeOpacity }) => {
        const overlay = new mapkit.PolylineOverlay(points, {
            style: new mapkit.Style({
                strokeColor: ACTIVE_COLOR, strokeOpacity, lineWidth, lineCap: 'round', lineJoin: 'round',
                strokeStart: 0, strokeEnd: 0,
            }),
        });
        map.addOverlay(overlay);
        return overlay;
    });

    return { base, active };
}

export function removeRouteOverlays(map: MKMap, overlays: RouteOverlays): void {
    for (const overlay of [...overlays.base, ...overlays.active]) map.removeOverlay(overlay);
}

/**
 * Show the day highlight over `[strokeStart, strokeEnd]` of the route, or hide it with `null`.
 *
 * `strokeEnd = 0` is the hidden state rather than removing the overlays: it is one property write, it cannot
 * lose its place in the paint order, and it matches `hideActiveSegment`'s intent (`useMapbox.ts:890-898`)
 * without the visibility property MapKit does not have.
 */
export function setActiveSegment(
    overlays: RouteOverlays,
    fractions: { strokeStart: number; strokeEnd: number } | null,
): void {
    for (const overlay of overlays.active) {
        overlay.style.strokeStart = fractions ? fractions.strokeStart : 0;
        overlay.style.strokeEnd = fractions ? fractions.strokeEnd : 0;
    }
}
