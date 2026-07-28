/**
 * The band of ground resolutions the satellite imagery is actually legible at. (QUA-47)
 *
 * ## The defect this exists to stop
 *
 * MEASURED on the live site 2026-07-27 with a real published journey: opening it flew the camera to a framing
 * where the imagery was a featureless brown smear with the day markers clustered in the middle of it. The
 * cause was that the arrival camera fitted the route's own bounds with no floor on ground resolution — the
 * route spans a few hundred metres, so the fit asked for a resolution no imagery has — clamped only by
 * `DAY_FIT_MAX_ZOOM = 16`, a **zoom level**, which is the wrong unit twice over:
 *
 * 1. A zoom level is not a ground resolution. Zoom 16 is 2.39 m/px at the equator, 1.13 m/px at 61.6 N and
 *    0.62 m/px at 75 N — a 3.9x range over the latitudes this app's journeys sit at. So one number cannot
 *    express "as deep as the imagery goes", and the same clamp is generous in Tanzania and far too deep in
 *    Norway.
 * 2. **The pyramid is indexed by DEVICE pixels, not CSS pixels.** MapKit requests `size=2` (512 px) tiles on a
 *    dpr-2 display, so a CSS-pixel resolution of 1.13 m/px draws imagery at 0.57 m per device pixel and needs
 *    a level one deeper than the same frame on a dpr-1 display. This is why the defect was invisible in
 *    Playwright, which runs at dpr 1, and visible immediately on a Mac or a phone. Every number in this file
 *    is therefore **metres per DEVICE pixel**, and the conversion to a CSS-pixel scale takes `devicePixelRatio`
 *    explicitly rather than reading `window` — the maths stays pure and the tests stay deterministic.
 *
 * ## The measurement
 *
 * MEASURED 2026-07-28, MapKit JS 5.81.65, `mapType: Satellite`, dpr 2, a ladder of six panes over one
 * coordinate each at a fixed metres-per-CSS-pixel, judged after full tile load. (Judging early is its own
 * trap: MapKit paints an empty grey tile grid while loading and it reads exactly like a coverage hole — the
 * 0.3 m/px pane looked like missing imagery for the first several seconds and then resolved. Same warning as
 * `scripts/mapkit/imagery-compare/FINDINGS.md`.)
 *
 * | Location | crisp down to | soft at | featureless at |
 * |---|---|---|---|
 * | Khumbu Icefall (28.010 N, 86.860 E) | **1.20 m/device px** | 0.60 | 0.30 and below |
 * | Jotunheimen (61.636 N, 8.312 E) | 0.60 | 0.30 | 0.15 |
 * | Bergen city centre — control | 0.075 | — | — (still crisp at 0.0375) |
 *
 * The Bergen control is the load-bearing row: MapKit went on requesting deeper tiles (z 19) and rendering
 * genuine new detail all the way down, so **the limit is per-ground coverage and not a cap in MapKit or in the
 * tile service**. Which means a single global floor has to be set by the worst-covered ground the app frames,
 * and that is the Khumbu — the same mosaic FINDINGS.md already flagged as this vendor's weak spot.
 *
 * The ceiling was measured the same way and in the same session, over Everest base camp (28.0026 N, 86.8528 E),
 * the frame FINDINGS.md called out:
 *
 * | resolution | what Apple's mosaic shows |
 * |---|---|
 * | 20 m/device px | heavy cloud over most of the frame |
 * | 10 m/device px | heavy cloud and cloud shadow — this is FINDINGS.md's 19.75 m/CSS px row, reproduced |
 * | **5 m/device px** | **clean.** No cloud; moraine bands, the glacial ponds and the icefall all legible |
 * | 2.5, 1.25 | clean, progressively more serac detail |
 *
 * So the cloud boundary sits between 10 and 5 m/device px, and the ceiling is the coarsest level measured
 * CLEAN rather than a value interpolated into the gap. Note this supersedes reading FINDINGS.md's figures
 * directly: those are metres per CSS pixel and that document does not record the `devicePixelRatio` they were
 * taken at, so the two tables differ by a factor of two that is easy to carry the wrong way.
 *
 * Re-measure by serving a ladder page against a `localhost`-origin MapKit token; the harness in
 * `scripts/mapkit/imagery-compare/` is the nearest thing in the repo to start from, and the tile requests
 * carry the level in the query string (`sat-cdn.apple-mapkit.com/tile?...&z=17&...`), which is a cheap
 * cross-check on what MapKit actually asked for.
 *
 * ## Why the band has two ends
 *
 * The floor stops the smear. The ceiling stops the opposite failure, which `FINDINGS.md` had already found and
 * the table above re-measured: Apple's mosaic over the Khumbu carries heavy cloud and a tile seam at the wide
 * levels, so a camera that *chooses* a resolution must not choose one coarser than the band either, or it
 * opens a journey into cloud.
 *
 * **Both ends are set by the worst-covered ground the app frames, and that is deliberate rather than
 * conservative-by-default.** It does cost something: Kilimanjaro is fine at 9.9 m/device px — FINDINGS.md
 * measured it at parity with Mapbox there, "same glaciers, crater rim, radial gullies" — so the ceiling
 * tightens the mobile off-route camp frame over East Africa from 6.75 to 5 m/px for a reason that is
 * Himalaya-specific. That is the same trade the floor makes in the other direction, and it is the only kind of
 * trade a single global band can make. The alternative is a per-region table, which is a coverage database we
 * would have to keep true; if this ever becomes worth doing, `camera.test.ts`'s "which end binds" test is the
 * inventory of what it would change.
 *
 * **The two ends do not have equal authority, and the asymmetry is not an oversight.** Loosening a frame keeps
 * everything that was inside it inside it, so the floor can always be honoured. Tightening one crops, so the
 * ceiling cannot be honoured by a camera whose job is to contain something: measured on the `e2e-alpine-loop`
 * fixture, a 12.7 x 15.9 km route frames at 36.4 m/px on a 1280 x 720 desktop viewport and 40.8 m/px on a
 * 390 x 844 phone — already past the cloudy band before any clamp is involved, and pulling in to the ceiling
 * would push the route off screen. Even a single DAY of that fixture frames at 10.8 m/px, past the ceiling.
 * Containing the journey wins: cloud is imagery quality, a cropped route is a broken view. So
 * `regionForBounds` takes the floor alone, and `clampToImageryBand` resolves a floor/ceiling conflict in the
 * floor's favour. `camera.test.ts` pins all of those figures — read them there, not here, if they disagree.
 */

/**
 * WGS-84 equatorial circumference in metres — the width of the whole Web Mercator world, which is the unit
 * `camera.ts` expresses its scale in (`1` = the entire world across one pixel).
 */
export const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

/** The Mercator projection's own latitude limit. Past it `worldY` is undefined and `cos` heads for zero. */
const MERCATOR_MAX_LAT = 85.051_128_78;

/**
 * A range of ground resolutions, in **metres per device pixel**.
 *
 * Both fields are optional so a caller can state only the end it is entitled to enforce — a containment fit
 * may only ever loosen, so it passes the floor and nothing else. See the header.
 */
export interface ImageryBand {
    /** Finest resolution the imagery resolves. Frame tighter than this and you are magnifying, not zooming. */
    finestMetersPerDevicePixel?: number;
    /** Coarsest resolution worth framing at. Beyond it Apple's wide mosaics start carrying cloud. */
    coarsestMetersPerDevicePixel?: number;
}

/**
 * The measured band for Apple's satellite imagery over the ground this app's journeys cover.
 *
 * `finest` is the Khumbu row of the table in the header — the worst-covered journey region, which is what a
 * single global floor has to be set by. It is deliberately NOT the Jotunheimen or Bergen figure: a floor
 * chosen from good coverage is a floor that does nothing where it is needed.
 *
 * `coarsest` is the coarsest level measured CLEAN over Everest base camp — 5 m/device px, with 10 already
 * carrying heavy cloud. It binds on exactly one camera today, the mobile off-route camp frame at equatorial
 * latitudes; `camera.test.ts`'s "which end binds" test is the inventory, and it is written to go red rather
 * than to drift if someone widens a camera.
 */
export const APPLE_SATELLITE_BAND: Required<ImageryBand> = {
    finestMetersPerDevicePixel: 1.2,
    coarsestMetersPerDevicePixel: 5,
};

/**
 * Ground resolution, in metres per pixel, for a Web Mercator scale at a latitude.
 *
 * `worldUnitsPerPixel` is `camera.ts`'s scale: normalised world units (whole world = 1) per pixel. Mercator x
 * is linear in longitude, so a world unit is `EARTH_CIRCUMFERENCE_M` of ground at the equator and
 * `EARTH_CIRCUMFERENCE_M * cos(latitude)` anywhere else — which is precisely why the clamp cannot be
 * expressed as a zoom level.
 */
export function metersPerPixel(worldUnitsPerPixel: number, latitude: number): number {
    const clamped = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, latitude));
    return worldUnitsPerPixel * EARTH_CIRCUMFERENCE_M * Math.cos((clamped * Math.PI) / 180);
}

/** Inverse of {@link metersPerPixel}. */
export function worldUnitsPerPixelFor(metersPerPixelValue: number, latitude: number): number {
    const clamped = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, latitude));
    return metersPerPixelValue / (EARTH_CIRCUMFERENCE_M * Math.cos((clamped * Math.PI) / 180));
}

/**
 * Clamp a Web Mercator scale so the frame's ground resolution lands inside `band`.
 *
 * Returns world units per pixel, the same unit it takes, so it drops into `camera.ts`'s fit arithmetic without
 * a round trip through zoom levels.
 *
 * Three decisions worth knowing about:
 *
 * - **`devicePixelRatio` scales the band, not the scale.** The band is in metres per device pixel and the
 *   scale is in CSS pixels, so a dpr-2 display may only be framed half as tight in CSS terms. Default 1 so
 *   every caller that does not care — every unit test — stays deterministic.
 * - **The floor wins a conflict with the ceiling.** A band with `finest > coarsest` is a misconfiguration, and
 *   of the two ways to resolve it, showing legible imagery is the one that matters; a frame slightly coarser
 *   than someone intended is a cosmetic loss, a magnified smear is the defect this file exists for. Hence the
 *   ceiling is applied first and the floor second.
 * - **A scale of ZERO is legitimate and gets raised to the floor.** It is what a single-point bounds produces
 *   — `Math.max(spanX, Number.MIN_VALUE) / availableWidth` underflows to 0 — and raising it is precisely the
 *   job `maxZoom` used to do. An early `scale <= 0` bail-out was the first version of this function and it
 *   made the point case a no-op while every other test still passed; `camera.test.ts`'s single-point case is
 *   what caught it. Only a NON-FINITE input passes through, because that means the caller already has a
 *   problem and substituting a plausible number would hide it at the one place it is still cheap to see.
 */
export function clampToImageryBand(
    worldUnitsPerPixel: number,
    latitude: number,
    band: ImageryBand,
    devicePixelRatio = 1,
): number {
    if (!Number.isFinite(worldUnitsPerPixel)) return worldUnitsPerPixel;
    if (!Number.isFinite(latitude)) return worldUnitsPerPixel;
    const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;

    let scale = worldUnitsPerPixel;
    const { coarsestMetersPerDevicePixel: coarsest, finestMetersPerDevicePixel: finest } = band;
    if (coarsest !== undefined && coarsest > 0) {
        scale = Math.min(scale, worldUnitsPerPixelFor(coarsest * dpr, latitude));
    }
    if (finest !== undefined && finest > 0) {
        scale = Math.max(scale, worldUnitsPerPixelFor(finest * dpr, latitude));
    }
    return scale;
}
