/**
 * Camera maths for the MapKit journey surface — pure, so the framing is provable without a browser. (MAP-03)
 *
 * ## Why this file exists at all
 *
 * MapKit JS has **no zoom level**. It exposes `region` (a centre plus a degree span), `cameraDistance` and
 * `cameraZoomRange`, and its animated setters take a region. Mapbox's adapter thinks in zoom levels and
 * `fitBounds(bounds, { padding, maxZoom })`. Everything needed to bridge those two vocabularies is here,
 * and it is here rather than in the hook because:
 *
 * 1. **The arrival framing is a hard requirement from the imagery gate**, not a nicety. Apple's mosaic over
 *    the Khumbu carries heavy cloud at ~20 m/px and is at parity or better at ~5 m/px
 *    (`scripts/mapkit/imagery-compare/FINDINGS.md`). A route's own bounds are tighter than the massif's, so
 *    framing from route bounds lands in the good band and a fixed wide zoom does not. A pure function is
 *    the only way to keep that provable.
 * 2. **`getMapState().cameraZoom` is an e2e branch discriminator.** `e2e/day-navigation.spec.ts:145` asserts
 *    `cameraZoom > 14` as one of two independent signals that the off-route `flyTo` branch ran rather than
 *    the segment-fit branch. Synthesised wrongly, that assertion stops distinguishing the branches and goes
 *    quietly vacuous. `camera.test.ts` pins the separation.
 *
 * ## The projection model, and the measurement that validates it
 *
 * Square-pixel Web Mercator, the same projection Mapbox uses, expressed in normalised world units where the
 * whole world is 1×1 (x east, y **south** — the screen's direction, not latitude's).
 *
 * MEASURED (`scripts/mapkit/surface-probe/?probe=camera`): asked for a region of `0.021 × 0.042` in a
 * 618 × 463 px container at 61.6 N; MapKit returned `0.021 × 0.058934`. The model here predicts
 * **0.058947** for that container — 0.02%. So MapKit expands the deficient dimension to the container's
 * aspect ratio with a proper Mercator correction, **preserves the constraining dimension**, and never
 * shrinks either. Which means a region computed to the right aspect ratio comes back unchanged, and
 * `regionForBounds` can be trusted rather than re-read. (Read it back anyway in the hook — cheap, and it
 * catches the day MapKit changes its mind.)
 *
 * ## Two paddings, and why they must not be conflated
 *
 * - **Attribution padding** goes into `map.padding`. Apple paints its logo and Legal link onto a canvas with
 *   no DOM to select, so the 80 px lift that keeps them clear of the showcase's own chips is this property
 *   and nothing else (measured; see `./chrome.ts`). Crucially `map.padding` does **not** move the camera —
 *   it redefines `map.region` as the *inset* rect and pans so the inset rect is centred.
 * - **Frame padding** is the side-panel clearance the incumbent passes to `fitBounds` (desktop `right: 450`
 *   on arrival, `right: 400` on a day). It has no MapKit property; it is arithmetic inside the fit.
 *
 * So a region written here describes the **inset** rect, and the bounds are fitted into a sub-rect of it.
 * Double-counting the two is the easy mistake: it is why this module takes them as separate arguments and
 * why nothing passes the attribution padding to a fit.
 *
 * ## QUA-47: the fit is clamped in METRES PER PIXEL, not in zoom levels
 *
 * `regionForBounds` used to take `maxZoom` / `minZoom`, and both callers passed `maxZoom: 16`. That let a short
 * route be framed at a resolution no imagery supports, and the live site showed a featureless brown smear
 * because of it. Both options are gone, and `regionForZoom` — which took neither, so a fixed zoom went
 * completely unchecked — now takes the clamp too. It is `../imagery.ts`'s measured band, in metres per DEVICE
 * pixel, which is the unit tile coverage is actually indexed by. Read that file's header before changing either
 * number: the reason zoom levels cannot express this is a 3.9x latitude spread with a factor of
 * `devicePixelRatio` on top of it.
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

import type { LngLat, MapBounds } from '../types';
import { clampToImageryBand, type ImageryBand } from '../imagery';

/** Pixel size of the map container. */
export interface ContainerPx {
    width: number;
    height: number;
}

export interface EdgeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/**
 * A camera region in the showcase's own vocabulary — no vendor type, so this module stays testable in node.
 * `./overlays.ts` turns it into a `mapkit.CoordinateRegion` at the point of use.
 */
export interface Region {
    center: LngLat;
    latitudeDelta: number;
    longitudeDelta: number;
}

const TILE_PX = 256;
const DEG = Math.PI / 180;

/** Normalised world x for a longitude: 0 at −180°, 1 at +180°. */
function worldX(lng: number): number {
    return (lng + 180) / 360;
}

/** Normalised world y for a latitude — increasing SOUTHWARD, like screen y. */
function worldY(lat: number): number {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    return 0.5 - Math.log(Math.tan(Math.PI / 4 + (clamped * DEG) / 2)) / (2 * Math.PI);
}

function lngForWorldX(x: number): number {
    return x * 360 - 180;
}

function latForWorldY(y: number): number {
    return (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) / DEG;
}

/**
 * Web-Mercator zoom for a longitude span across a given pixel width.
 *
 * **This is what `getMapState().cameraZoom` reports**, and the number `e2e/day-navigation.spec.ts:145`
 * compares against 14. Longitude rather than latitude because longitude is linear in Mercator x, so the
 * answer does not depend on where on the globe the camera is — a latitude-derived zoom would drift with the
 * journey's latitude and quietly move the branch threshold.
 *
 * `widthPx` must be the **inset** width (`container.width − padding.left − padding.right`), and in the
 * ordinary desktop journey view that is NOT the container width: `attributionPadding` returns
 * `left: DESKTOP_PANEL_BAND_PX` (364) whenever a journey is selected, because the sidebar covers the corner
 * Apple paints into (`./chrome.ts` §3). An earlier version of this comment claimed the padding was
 * bottom-only — it is bottom-only only on mobile, and only when no panel is open. Both callers subtract
 * `left + right` (`useMapKitJourney.ts`'s `syncPhotos` and `getCameraState`), and must: `map.region` spans
 * the INSET width, so spreading that span across the full container claims more pixels per degree than exist
 * and **OVERSTATES** the zoom, by exactly `log2(1280 / 916) = 0.483` on desktop.
 *
 * MEASURED on the fixture journey, correct → wrong: the arrival frame goes `10.994 → 11.477`, which both
 * round to 11 and so hides the bug, while the day-1 fit goes `13.331 → 13.814` and crosses a level.
 * `groupPhotosByLocation`'s cell is `0.1 / 2^(zoom − 8)`, so one level too high HALVES the cell and splits
 * stacks that belong together. `camera.test.ts` pins the direction, because prose gets it backwards easily:
 * the note at `useMapKitJourney.ts:293-295` says "understate the zoom and coarsen the photo grid", which is
 * inverted twice over. Not corrected in this commit only because that file was under concurrent edit —
 * QUA-51's report flags it.
 *
 * The `cameraZoom > 14` e2e threshold survives the inset because `regionForZoom` builds the span from the
 * same inset width that {@link synthesizeZoom} divides by, so the pair round-trips exactly.
 */
export function spanToZoom(longitudeDelta: number, widthPx: number): number {
    if (!(longitudeDelta > 0) || !(widthPx > 0)) return Number.NaN;
    return Math.log2((360 * widthPx) / (TILE_PX * longitudeDelta));
}

/** Inverse of {@link spanToZoom}. */
export function zoomToSpan(zoom: number, widthPx: number): number {
    return (360 * widthPx) / (TILE_PX * Math.pow(2, zoom));
}

/** World units per pixel at a zoom level — the scale the fit maths works in. */
function unitsPerPixel(zoom: number): number {
    return 1 / (TILE_PX * Math.pow(2, zoom));
}

/**
 * How a caller states the imagery clamp. `devicePixelRatio` rides along with the band because the band is in
 * metres per DEVICE pixel while everything else in this file is in CSS pixels — see `../imagery.ts`.
 *
 * Passed as one object rather than as two loose options so the two can never be separated: a band applied at
 * the wrong dpr is off by a factor of two or three and produces a frame that looks merely a bit wide.
 */
export interface ImageryClamp extends ImageryBand {
    devicePixelRatio?: number;
}

/**
 * Build the region that puts `bounds` inside the padded sub-rect of the inset viewport.
 *
 * Mirrors the *fit maths* of `map.fitBounds(bounds, { padding, maxZoom })` at
 * `src/hooks/mapbox/useMapbox.ts:1079-1109` and `:1130-1162`: the constraining dimension wins, a clamp bounds
 * the scale, and the centre shifts by half the padding asymmetry. QUA-47 replaced the clamp — it was
 * `maxZoom`, mirroring Mapbox's, and it is now a ground-resolution floor for the reasons below.
 *
 * It does **not** mirror the incumbent's padding VALUES, and that is deliberate rather than an oversight —
 * an earlier version of this comment claimed the opposite, which is why the distinction is spelled out.
 * `useMapbox.ts` pads `right: 450` (arrival) and `right: 400` (day) to clear a side panel that is on the
 * LEFT in this app, so it frames the route *into* the panel; `./chrome.ts` §2 has the measurement, and both
 * `arrivalFramePadding` and `dayFramePadding` are horizontally symmetric instead. `chrome.test.ts`'s "is
 * symmetric on desktop" pins that, and `e2e/mapkit-journey.spec.ts`'s `expectOnRouteCamera` restates the
 * day-navigation assertion that had silently depended on the eastward shift the asymmetry produced.
 *
 * So `offsetXPx` below is zero for all four padding sets this app currently passes. It is still live
 * arithmetic, not dead: every set is vertically asymmetric (mobile arrival `top: 80` over `bottom: 40`,
 * desktop day `bottom: 150` over `top: 120`), so `offsetYPx` always does work, and a future horizontal
 * asymmetry must move the centre rather than silently skew the fit.
 *
 * ## QUA-47: it takes the imagery FLOOR, and deliberately not the ceiling
 *
 * This function's contract is that the bounds end up inside the padded box. Loosening the frame preserves
 * that; tightening it does not. So only `finestMetersPerDevicePixel` is honoured here, and a
 * `coarsestMetersPerDevicePixel` in the band passed to it is ignored on purpose rather than quietly cropping
 * the journey. `../imagery.ts`'s header carries the measurement that makes this a real choice and not a
 * hypothetical one: the `e2e-alpine-loop` fixture's own route needs ~31 m/px to fit a desktop viewport, which
 * is already coarser than the band's ceiling before any clamping happens.
 */
export function regionForBounds(
    bounds: MapBounds,
    options: {
        container: ContainerPx;
        /** Side-panel clearance, in pixels of the inset viewport. */
        framePadding: EdgeInsets;
        /** What went into `map.padding`. The region describes the rect this insets. */
        attributionPadding?: EdgeInsets;
        /**
         * The imagery clamp. Only the floor applies — see above. It also subsumes what `maxZoom` used to do
         * for a degenerate single-point bounds, whose fit scale is ~0: the floor is a lower bound on scale, so
         * a point now frames at the deepest resolution the imagery has rather than at an arbitrary zoom 16.
         */
        imagery?: ImageryClamp;
    },
): Region {
    const attribution = options.attributionPadding ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const insetWidth = Math.max(1, options.container.width - attribution.left - attribution.right);
    const insetHeight = Math.max(1, options.container.height - attribution.top - attribution.bottom);

    const frame = options.framePadding;
    const availableWidth = Math.max(1, insetWidth - frame.left - frame.right);
    const availableHeight = Math.max(1, insetHeight - frame.top - frame.bottom);

    const [[west, south], [east, north]] = bounds;
    const x0 = worldX(west);
    const x1 = worldX(east);
    const yNorth = worldY(north);
    const ySouth = worldY(south);
    const spanX = Math.max(x1 - x0, Number.MIN_VALUE);
    const spanY = Math.max(ySouth - yNorth, Number.MIN_VALUE);

    // Fit: the constraining dimension wins, exactly as fitBounds does.
    let scale = Math.max(spanX / availableWidth, spanY / availableHeight);

    // The imagery floor, at the latitude the frame is centred on — ground resolution depends on it, which is
    // the whole reason this is not a zoom clamp. Taken from the BOUNDS centre rather than from the region
    // centre computed below, because that one moves with `offsetYPx * scale` and would make the clamp
    // circular for a gain of a few metres of latitude on a frame kilometres across.
    if (options.imagery) {
        const centerLat = latForWorldY((yNorth + ySouth) / 2);
        scale = clampToImageryBand(
            scale,
            centerLat,
            { finestMetersPerDevicePixel: options.imagery.finestMetersPerDevicePixel },
            options.imagery.devicePixelRatio,
        );
    }

    // The bounds sit at the centre of the AVAILABLE box; the region describes the INSET box. Offset the
    // region centre by half the padding asymmetry so the two rects line up.
    const offsetXPx = (frame.left - frame.right) / 2;
    const offsetYPx = (frame.top - frame.bottom) / 2;
    const centerX = (x0 + x1) / 2 - offsetXPx * scale;
    const centerY = (yNorth + ySouth) / 2 - offsetYPx * scale;

    return regionAtScale({ x: centerX, y: centerY }, scale, insetWidth, insetHeight);
}

/**
 * The region for a centre and a Mapbox-style zoom level — the off-route day branch
 * (`useMapbox.ts:1112-1125`: `flyTo({ center: camp, zoom: 15 })`) and `flyToPhoto` (zoom 16).
 *
 * ## QUA-47: this one takes BOTH ends of the band
 *
 * Nothing has to stay in frame here — the caller is choosing a resolution outright — so there is no
 * containment argument against the ceiling, and a fixed zoom level is exactly the thing the band exists to
 * correct: zoom 16 is 2.39 m/px at the equator and 0.62 m/px at 75 N, so `PHOTO_ZOOM` means four times the
 * imagery demand in Svalbard that it means in Tanzania. The clamp converts "zoom 16" into "the closest
 * resolution to zoom 16 that the imagery actually has here".
 *
 * One consequence to carry, because it is load-bearing for a test rather than for a user:
 * `e2e/day-navigation.spec.ts` uses `cameraZoom > 14` to prove the off-route branch ran, and clamping
 * `offRouteZoom`'s 15 pulls that number DOWN. It survives everywhere it is asserted — Playwright runs at dpr 1,
 * where the clamp does not bind on the fixture at all — but the margin is not unlimited: at dpr 3 and ~75 N the
 * clamped off-route frame lands below 14 and that assertion would stop discriminating. `camera.test.ts` pins
 * the separation at dpr 1, 2 and 3 on the fixture's own latitude and names the combination that breaks it.
 */
export function regionForZoom(
    center: LngLat,
    zoom: number,
    options: {
        container: ContainerPx;
        attributionPadding?: EdgeInsets;
        /** The imagery clamp, both ends. */
        imagery?: ImageryClamp;
    },
): Region {
    const attribution = options.attributionPadding ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const insetWidth = Math.max(1, options.container.width - attribution.left - attribution.right);
    const insetHeight = Math.max(1, options.container.height - attribution.top - attribution.bottom);
    const scale = options.imagery
        ? clampToImageryBand(
            unitsPerPixel(zoom), center[1], options.imagery, options.imagery.devicePixelRatio,
        )
        : unitsPerPixel(zoom);
    return regionAtScale(
        { x: worldX(center[0]), y: worldY(center[1]) },
        scale,
        insetWidth,
        insetHeight,
    );
}

function regionAtScale(
    center: { x: number; y: number },
    scale: number,
    widthPx: number,
    heightPx: number,
): Region {
    const halfX = (widthPx * scale) / 2;
    const halfY = (heightPx * scale) / 2;
    const north = latForWorldY(center.y - halfY);
    const south = latForWorldY(center.y + halfY);
    return {
        center: [lngForWorldX(center.x), latForWorldY(center.y)],
        latitudeDelta: north - south,
        longitudeDelta: 2 * halfX * 360,
    };
}

/**
 * The zoom a region reports through `getMapState()`.
 *
 * Named separately from `spanToZoom` because this is the *contract* function — the one the e2e threshold is
 * calibrated against — while `spanToZoom` is the arithmetic. Keeping them distinct means the calibration
 * test in `camera.test.ts` names the thing it is protecting.
 */
export function synthesizeZoom(region: { longitudeDelta: number }, insetWidthPx: number): number {
    return spanToZoom(region.longitudeDelta, insetWidthPx);
}

/**
 * Where a coordinate lands, in pixels, for a given region.
 *
 * `insetBox` must be **the box the region describes** — `container.width − padding.left − padding.right` by
 * `container.height − padding.top − padding.bottom` — not the whole container. That is not a detail: with the
 * 80 px attribution band set, `map.region` covers `height − 80` pixels, so projecting against the full height
 * silently stretches everything by 12.5%. Getting this wrong is the same class of mistake as reading
 * `region.toBoundingRegion()` for the viewport (see the header), and it is why the argument is named
 * `insetBox` rather than `container`.
 *
 * Used by `camera.test.ts` to prove the fit is tight. The hook does not use it — a live map has
 * `convertCoordinateToPointOnPage`, which is exact and needs no model.
 */
export function projectToPixels(
    coordinate: LngLat,
    region: Region,
    insetBox: ContainerPx,
): { x: number; y: number } {
    const scaleX = region.longitudeDelta / 360 / insetBox.width;
    const yTop = worldY(region.center[1] + region.latitudeDelta / 2);
    const yBottom = worldY(region.center[1] - region.latitudeDelta / 2);
    const scaleY = (yBottom - yTop) / insetBox.height;
    return {
        x: (worldX(coordinate[0]) - worldX(region.center[0] - region.longitudeDelta / 2)) / scaleX,
        y: (worldY(coordinate[1]) - yTop) / scaleY,
    };
}

/*
 * Deleted by QUA-51: `boundsOfRegion` ("only for tests" — and no test called it) and
 * `regionCenterAsLatLng`, neither referenced anywhere in `src/`, `e2e/` or `scripts/`. The hook derives
 * viewport bounds from the container's real corners (`useMapKitJourney.ts`'s `emitViewport` explains why
 * `region.toBoundingRegion()` is wrong here), and `./overlays.ts` builds vendor coordinates itself — so both
 * were plausible-looking shortcuts to the two mistakes this module's header warns about.
 */
