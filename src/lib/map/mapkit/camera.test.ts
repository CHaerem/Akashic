/**
 * MAP-05: "the incumbent" below means the Mapbox surface, which MAP-05 DELETED (2707 lines), and any
 * `useMapbox.ts` / `layerConfigs.ts` citation is a historical measurement whose path no longer resolves.
 * Recover it with `git log --diff-filter=D -- src/hooks/mapbox/`. Kept because the measurement is the reason
 * the code is shaped this way; see the fuller note in the module this exercises.
 */
import { describe, it, expect } from 'vitest';
import routeJson from '../../../fixtures/assets/e2e-alpine-loop.route.json';
import waypointsJson from '../../../fixtures/assets/e2e-alpine-loop.waypoints.json';
import type { Camp, Route } from '../../../types/trek';
import {
    projectToPixels, regionForBounds, regionForZoom, spanToZoom, synthesizeZoom, zoomToSpan,
} from './camera';
import {
    boundsOfCoordinates, boundsOfRoute, daySegment, type RouteCoord,
} from './geometry';
import {
    arrivalFramePadding, attributionPadding, dayFramePadding, offRouteZoom, PHOTO_ZOOM,
} from './chrome';
import { APPLE_SATELLITE_BAND, metersPerPixel } from '../imagery';
import type { MapBounds } from '../types';

const COORDINATES = routeJson.coordinates as RouteCoord[];
const ROUTE: Route = { type: 'LineString', coordinates: COORDINATES };
const CAMPS = (waypointsJson as unknown as Camp[]).map((camp, index) => ({
    ...camp,
    // One fixture camp genuinely has no id (it exercises the app's id-less waypoint path). Give it one here
    // so `daySegment` can key on it; the geometry under test does not care what the id is.
    id: camp.id ?? `fixture-camp-${index}`,
})) as Camp[];

const DESKTOP = { width: 1280, height: 720 };
const MOBILE = { width: 390, height: 844 };

// Signed out with the journey panel open — the state a shared link lands on, and the one with the most chrome
// to clear. See chrome.ts for why the desktop clearance is on the LEFT.
const ATTRIBUTION = attributionPadding({ signedOut: true, isMobile: false, panelOpen: true });
const MOBILE_ATTRIBUTION = attributionPadding({ signedOut: true, isMobile: true, panelOpen: true });

/**
 * The width `map.region` describes — the container minus `map.padding`'s horizontal clearance. Every
 * `synthesizeZoom` call must use this, not the container width, or the answer is skewed by the panel band.
 */
const INSET_WIDTH = DESKTOP.width - ATTRIBUTION.left - ATTRIBUTION.right;
const MOBILE_INSET_WIDTH = MOBILE.width - MOBILE_ATTRIBUTION.left - MOBILE_ATTRIBUTION.right;

/**
 * QUA-47: the imagery clamp the hook passes to every camera, at a chosen `devicePixelRatio`.
 *
 * The default is 1 — deliberately, and it is not merely "the simplest default". Playwright runs at dpr 1, so
 * dpr 1 is the configuration `e2e/day-navigation.spec.ts`'s `cameraZoom > 14` is actually calibrated against,
 * and pinning the fixture frames at any other dpr would pin numbers no e2e run can ever see. The retina cases
 * are asserted separately, below.
 */
function imagery(devicePixelRatio = 1) {
    return { ...APPLE_SATELLITE_BAND, devicePixelRatio };
}

function arrivalRegion(container = DESKTOP, attribution = ATTRIBUTION, isMobile = false, dpr = 1) {
    return regionForBounds(boundsOfRoute(COORDINATES)!, {
        container,
        framePadding: arrivalFramePadding({ isMobile }),
        attributionPadding: attribution,
        imagery: imagery(dpr),
    });
}

function dayRegion(dayNumber: number, dpr = 1) {
    const camp = CAMPS.find(c => c.dayNumber === dayNumber)!;
    const segment = daySegment(ROUTE, CAMPS, camp.id)!;
    if (segment.offRoute) {
        return regionForZoom(camp.coordinates, offRouteZoom({ isMobile: false }), {
            container: DESKTOP, attributionPadding: ATTRIBUTION, imagery: imagery(dpr),
        });
    }
    const slice = COORDINATES.slice(segment.startIndex, segment.endIndex + 1);
    return regionForBounds(boundsOfCoordinates(slice)!, {
        container: DESKTOP,
        framePadding: dayFramePadding({ isMobile: false }),
        attributionPadding: ATTRIBUTION,
        imagery: imagery(dpr),
    });
}

/** The ground resolution a region is framed at, in metres per CSS pixel — the unit the ladder was measured in. */
function frameMetersPerPixel(region: { center: [number, number]; longitudeDelta: number }, widthPx: number) {
    return metersPerPixel(1 / (256 * Math.pow(2, synthesizeZoom(region, widthPx))), region.center[1]);
}

describe('camera arithmetic (MAP-03)', () => {
    it('spanToZoom and zoomToSpan are exact inverses across the usable range', () => {
        for (let zoom = 1; zoom <= 20; zoom += 0.5) {
            expect(spanToZoom(zoomToSpan(zoom, 1280), 1280)).toBeCloseTo(zoom, 10);
        }
    });

    it('rejects a degenerate span rather than returning Infinity', () => {
        expect(Number.isNaN(spanToZoom(0, 1280))).toBe(true);
        expect(Number.isNaN(spanToZoom(1, 0))).toBe(true);
    });

    it('matches what MapKit actually chose for a measured region', () => {
        // MEASURED 2026-07-27 (scripts/mapkit/surface-probe/?probe=camera): a 618 x 463 px container at
        // 61.6 N, asked for latitudeDelta 0.021, returned longitudeDelta 0.058934. This is the one number
        // that says the projection model here is MapKit's and not merely plausible.
        const container = { width: 618, height: 463 };
        const bounds: MapBounds = [[8.3, 61.6 - 0.0105], [8.3, 61.6 + 0.0105]];
        const region = regionForBounds(bounds, {
            container, framePadding: { top: 0, right: 0, bottom: 0, left: 0 },
        });
        expect(region.latitudeDelta).toBeCloseTo(0.021, 5);
        expect(region.longitudeDelta).toBeCloseTo(0.058934, 3);
    });
});

/**
 * The calibration that keeps `e2e/day-navigation.spec.ts:145`'s `cameraZoom > 14` a real discriminator.
 *
 * MapKit has no zoom level, so `getMapState().cameraZoom` is synthesised. If the arithmetic drifts so that an
 * on-route segment fit also lands above 14, that assertion silently stops distinguishing the two camera
 * branches and the spec passes for the wrong reason — the failure mode QUA-40 was written to remove. This
 * goes red in five seconds instead.
 *
 * Values computed from the real fixture (`src/fixtures/assets/e2e-alpine-loop.*`) at 1280 x 720 with the
 * incumbent's own paddings, and cross-checked against `synthesizeZoom` — they are this code's output, pinned,
 * not an independent derivation. Their JOB is the separation asserted below; the exact figures are here so a
 * change is visible rather than absorbed.
 */
describe('synthesised zoom calibration (MAP-03)', () => {
    it('pins the fixture journey frames', () => {
        expect(synthesizeZoom(arrivalRegion(), INSET_WIDTH)).toBeCloseTo(10.994, 2);
        expect(synthesizeZoom(dayRegion(1), INSET_WIDTH)).toBeCloseTo(13.331, 2);
        expect(synthesizeZoom(dayRegion(2), INSET_WIDTH)).toBeCloseTo(12.745, 2);
        expect(synthesizeZoom(dayRegion(3), INSET_WIDTH)).toBeCloseTo(12.743, 2);
        expect(synthesizeZoom(dayRegion(4), INSET_WIDTH)).toBeCloseTo(12.742, 2);
        expect(synthesizeZoom(dayRegion(5), INSET_WIDTH)).toBeCloseTo(15.000, 3);
    });

    it('OVERSTATES the zoom when handed the container width instead of the inset width (QUA-51)', () => {
        // The DIRECTION, pinned rather than described. `map.region` spans INSET_WIDTH pixels, so spreading
        // that span across the full container counts pixels hidden behind the sidebar, claims more pixels
        // per degree than exist, and reports a camera zoomed further IN than it is. Worth an assertion
        // because prose keeps getting it backwards — `useMapKitJourney.ts:293-295` says "understate the zoom
        // and coarsen the photo grid", and both halves are inverted.
        const skew = Math.log2(DESKTOP.width / INSET_WIDTH);
        expect(skew).toBeCloseTo(0.483, 3);
        for (const region of [arrivalRegion(), dayRegion(1), dayRegion(5)]) {
            const correct = synthesizeZoom(region, INSET_WIDTH);
            expect(synthesizeZoom(region, DESKTOP.width)).toBeCloseTo(correct + skew, 9);
        }
        // Not cosmetic: `syncPhotos` rounds this into a grid level, and the day-1 fit crosses one. A level
        // too high halves `groupPhotosByLocation`'s `0.1 / 2^(zoom − 8)` cell and splits stacks that belong
        // together. The arrival frame does NOT cross (11.0 → 11.5, both round to 11), which is exactly how a
        // mistake like this stays hidden.
        expect(Math.round(synthesizeZoom(dayRegion(1), INSET_WIDTH))).toBe(13);
        expect(Math.round(synthesizeZoom(dayRegion(1), DESKTOP.width))).toBe(14);
        expect(Math.round(synthesizeZoom(arrivalRegion(), DESKTOP.width)))
            .toBe(Math.round(synthesizeZoom(arrivalRegion(), INSET_WIDTH)));
    });

    it('keeps every on-route fit BELOW 14 and the off-route frame ABOVE it', () => {
        // This is the assertion that matters. See e2e/day-navigation.spec.ts:130-147.
        for (const dayNumber of [1, 2, 3, 4]) {
            expect(synthesizeZoom(dayRegion(dayNumber), INSET_WIDTH)).toBeLessThan(14);
        }
        expect(synthesizeZoom(arrivalRegion(), INSET_WIDTH)).toBeLessThan(14);
        expect(synthesizeZoom(dayRegion(5), INSET_WIDTH)).toBeGreaterThan(14);
        // Day 5 is the only off-route camp in the fixture — 12.28 km out. If that stops being true the
        // spec's off-route branch stops being exercised at all, so assert the premise too.
        expect(daySegment(ROUTE, CAMPS, CAMPS.find(c => c.dayNumber === 5)!.id)!.offRoute).toBe(true);
    });

    it('leaves headroom on both sides rather than sitting on the threshold', () => {
        const worstOnRoute = Math.max(...[1, 2, 3, 4].map(d => synthesizeZoom(dayRegion(d), INSET_WIDTH)));
        expect(14 - worstOnRoute).toBeGreaterThan(0.5);
        expect(synthesizeZoom(dayRegion(5), INSET_WIDTH) - 14).toBeGreaterThan(0.5);
    });

    it('still separates the branches on a mobile viewport', () => {
        const camp5 = CAMPS.find(c => c.dayNumber === 5)!;
        const offRoute = regionForZoom(camp5.coordinates, offRouteZoom({ isMobile: true }), {
            container: MOBILE, attributionPadding: MOBILE_ATTRIBUTION, imagery: imagery(),
        });
        expect(synthesizeZoom(offRoute, MOBILE_INSET_WIDTH)).toBeCloseTo(14.5, 3);
        expect(synthesizeZoom(arrivalRegion(MOBILE, MOBILE_ATTRIBUTION, true), MOBILE_INSET_WIDTH))
            .toBeLessThan(14);
    });
});

describe('regionForBounds fit invariant (MAP-03)', () => {
    const framePadding = arrivalFramePadding({ isMobile: false });
    // The box the region actually describes: `map.padding` insets it. Projecting against the full container
    // height would stretch every answer by 12.5% and quietly make the assertions below meaningless.
    const INSET = {
        width: DESKTOP.width - ATTRIBUTION.left - ATTRIBUTION.right,
        height: DESKTOP.height - ATTRIBUTION.top - ATTRIBUTION.bottom,
    };

    it('lands every route corner inside the padded sub-rect', () => {
        const bounds = boundsOfRoute(COORDINATES)!;
        const region = arrivalRegion();
        const [[west, south], [east, north]] = bounds;
        for (const corner of [[west, south], [east, north], [west, north], [east, south]] as [number, number][]) {
            const point = projectToPixels(corner, region, INSET);
            expect(point.x).toBeGreaterThanOrEqual(framePadding.left - 1);
            expect(point.x).toBeLessThanOrEqual(INSET.width - framePadding.right + 1);
            expect(point.y).toBeGreaterThanOrEqual(framePadding.top - 1);
            expect(point.y).toBeLessThanOrEqual(INSET.height - framePadding.bottom + 1);
        }
    });

    it('is TIGHT, not merely containing — one dimension touches its edge', () => {
        // Without this the test would pass for a camera zoomed absurdly far out, which is exactly the
        // "fixed wide zoom" the imagery gate forbids: Apple's mosaic over the Khumbu carries heavy cloud at
        // ~20 m/px and is at parity or better at ~5 m/px (scripts/mapkit/imagery-compare/FINDINGS.md).
        const bounds = boundsOfRoute(COORDINATES)!;
        const region = arrivalRegion();
        const nw = projectToPixels([bounds[0][0], bounds[1][1]], region, INSET);
        const se = projectToPixels([bounds[1][0], bounds[0][1]], region, INSET);
        const usedWidth = se.x - nw.x;
        const usedHeight = se.y - nw.y;
        const availableWidth = INSET.width - framePadding.left - framePadding.right;
        const availableHeight = INSET.height - framePadding.top - framePadding.bottom;
        const slack = Math.min(availableWidth - usedWidth, availableHeight - usedHeight);
        expect(slack).toBeLessThan(2);
        expect(slack).toBeGreaterThan(-2);
    });

    it('does not shift the centre when the frame padding is symmetric', () => {
        // MAP-03's frame padding IS symmetric — the desktop panel clearance moved into map.padding, because
        // that one property both frames the camera and moves Apple's attribution. So the region centre should
        // sit exactly on the bounds centre, and the offset arithmetic must not invent a shift.
        const bounds = boundsOfRoute(COORDINATES)!;
        const boundsCentreLng = (bounds[0][0] + bounds[1][0]) / 2;
        const symmetric = regionForBounds(bounds, {
            container: DESKTOP,
            framePadding: { top: 100, right: 100, bottom: 100, left: 100 },
            attributionPadding: { top: 0, right: 0, bottom: 0, left: 0 },
        });
        expect(symmetric.center[0]).toBeCloseTo(boundsCentreLng, 6);
    });

    it('still shifts the centre when a caller DOES pass asymmetric padding', () => {
        // The offset arithmetic is still load-bearing — mobile leaves more room at the top, and a future
        // layout may need a side. This is the test that would catch it silently doing nothing.
        const bounds = boundsOfRoute(COORDINATES)!;
        const boundsCentreLng = (bounds[0][0] + bounds[1][0]) / 2;
        const rightHeavy = regionForBounds(bounds, {
            container: DESKTOP,
            framePadding: { top: 100, right: 450, bottom: 100, left: 100 },
        });
        expect(rightHeavy.center[0]).toBeGreaterThan(boundsCentreLng);
        const leftHeavy = regionForBounds(bounds, {
            container: DESKTOP,
            framePadding: { top: 100, right: 100, bottom: 100, left: 450 },
        });
        expect(leftHeavy.center[0]).toBeLessThan(boundsCentreLng);
    });

    it('clamps a single-point bounds at the IMAGERY FLOOR instead of asking for infinite zoom', () => {
        // This used to be `maxZoom: DAY_FIT_MAX_ZOOM`, and it was the load-bearing half of QUA-47's defect: a
        // point bounds has a fit scale of ~0, so SOMETHING has to bound it from below, and the something was a
        // zoom level. The floor does the same job in the unit that decides whether there is imagery there.
        const point: MapBounds = [[8.3, 61.6], [8.3, 61.6]];
        const region = regionForBounds(point, {
            container: DESKTOP,
            framePadding: { top: 0, right: 0, bottom: 0, left: 0 },
            imagery: imagery(),
        });
        expect(frameMetersPerPixel(region, 1280))
            .toBeCloseTo(APPLE_SATELLITE_BAND.finestMetersPerDevicePixel, 6);
        expect(region.center[0]).toBeCloseTo(8.3, 6);
        expect(region.center[1]).toBeCloseTo(61.6, 6);
    });

    it('is NOT A CAMERA AT ALL for a point bounds with no clamp — the negative control', () => {
        // Without this the test above proves only that the clamp does something, not that it is needed.
        //
        // And the answer is sharper than "too deep": the fit scale for a point is
        // `Number.MIN_VALUE / availableWidth`, which UNDERFLOWS TO EXACTLY ZERO, so the region has a zero
        // longitude span and `synthesizeZoom` returns NaN. Worth pinning as NaN rather than as a large number,
        // because it is also the reason `clampToImageryBand` must not bail out on `scale <= 0` — that shape of
        // guard leaves this case untouched, which is the bug the first version of this fix shipped with.
        const point: MapBounds = [[8.3, 61.6], [8.3, 61.6]];
        const region = regionForBounds(point, {
            container: DESKTOP,
            framePadding: { top: 0, right: 0, bottom: 0, left: 0 },
        });
        expect(region.longitudeDelta).toBe(0);
        expect(Number.isNaN(synthesizeZoom(region, 1280))).toBe(true);
    });

    it('accounts for the attribution padding rather than ignoring it', () => {
        // The lifted band is 80 px of canvas the camera may not use, so the same bounds must be framed from
        // further out. Asserted on the ZOOM, not on latitudeDelta: when latitude is the constraining
        // dimension, latitudeDelta comes back as exactly the bounds' own latitude span either way, so that
        // comparison would be trivially equal and would look like the padding being ignored.
        const bounds = boundsOfRoute(COORDINATES)!;
        const frame = { top: 0, right: 0, bottom: 0, left: 0 };
        const withBand = regionForBounds(bounds, {
            container: DESKTOP, framePadding: frame, attributionPadding: ATTRIBUTION,
        });
        const withoutBand = regionForBounds(bounds, { container: DESKTOP, framePadding: frame });
        // Compared as degrees-per-pixel, not as a zoom level: the two regions describe different pixel
        // widths, so comparing their zooms directly would be comparing two different scales.
        const withBandPerPx = withBand.longitudeDelta / (DESKTOP.width - ATTRIBUTION.left);
        const withoutBandPerPx = withoutBand.longitudeDelta / DESKTOP.width;
        expect(withBandPerPx).toBeGreaterThan(withoutBandPerPx);
    });
});

describe('regionForZoom (MAP-03)', () => {
    it('centres exactly on the coordinate given', () => {
        const region = regionForZoom([8.14, 61.52], 15, { container: DESKTOP });
        expect(region.center[0]).toBeCloseTo(8.14, 9);
        expect(region.center[1]).toBeCloseTo(61.52, 9);
    });

    it('reproduces the requested zoom through synthesizeZoom', () => {
        for (const zoom of [12, 14.5, 15, 16]) {
            const region = regionForZoom([8.3, 61.6], zoom, { container: DESKTOP });
            expect(synthesizeZoom(region, 1280)).toBeCloseTo(zoom, 9);
        }
    });
});

/**
 * QUA-47 — the arrival camera may not frame past the imagery.
 *
 * MEASURED on the live site 2026-07-27: a real published journey opened onto a featureless brown smear with
 * the day markers clustered in the middle of it. The route spans a few hundred metres, `regionForBounds` fitted
 * it, and `maxZoom: 16` was the only thing in the way — a zoom level, which at 61.6 N is 1.14 m/CSS px and on a
 * retina display 0.57 m/DEVICE px, against a measured Khumbu limit of 1.2 m/device px.
 *
 * `../imagery.test.ts` owns the clamp arithmetic. These tests own what it does to the four cameras this adapter
 * actually requests, and they are ordered by the question they answer, because a clamp like this is easy to
 * over-apply and every way it goes wrong is silent:
 *
 * 1. does the defect reproduce without it, and did the old clamp really not cover it
 * 2. does it bind where it should, at every display density
 * 3. does containment survive it
 * 4. does it leave a real multi-day journey alone
 * 5-6. why the fit gets one end and a chosen resolution gets both
 * 7. which end binds on which camera today — the inventory a future widening has to argue with
 * 8. does the e2e branch discriminator survive
 */
describe('imagery clamp on the framings the app requests (QUA-47)', () => {
    /**
     * A route a few hundred metres across, at the fixture's own latitude — the shape of journey the live site
     * broke on. 300 m square rather than the fixture's 12.7 x 15.9 km, which is the whole reason nobody had
     * seen this: every demo fixture is a multi-day trek, and a long route never reaches the clamp.
     */
    const SHORT_ROUTE_M = 300;
    const shortRoute = (): MapBounds => {
        const dLat = SHORT_ROUTE_M / 111_320;
        const dLng = dLat / Math.cos((61.6 * Math.PI) / 180);
        return [[8.3, 61.6], [8.3 + dLng, 61.6 + dLat]];
    };
    const shortArrival = (dpr?: number) => regionForBounds(shortRoute(), {
        container: DESKTOP,
        framePadding: arrivalFramePadding({ isMobile: false }),
        attributionPadding: ATTRIBUTION,
        imagery: dpr === undefined ? undefined : imagery(dpr),
    });

    it('REPRODUCES the defect with the clamp removed', () => {
        // The negative control, and it goes first on purpose: without it, every assertion below could be
        // passing because a 300 m route happens to frame inside the band anyway.
        const mpp = frameMetersPerPixel(shortArrival(undefined), INSET_WIDTH);
        expect(mpp).toBeCloseTo(0.682, 2);
        expect(mpp).toBeLessThan(APPLE_SATELLITE_BAND.finestMetersPerDevicePixel);
        // And the old clamp did not save it either: `maxZoom: 16` at this latitude is 1.136 m/CSS px, which is
        // inside the band at dpr 1 and past it on every retina display — 0.568 at dpr 2, 0.379 at dpr 3, both
        // measured as soft-to-featureless over the Khumbu. Pinned so the claim in imagery.ts's header is
        // arithmetic rather than assertion.
        const oldClampMpp = metersPerPixel(1 / (256 * Math.pow(2, 16)), 61.6);
        expect(oldClampMpp).toBeCloseTo(1.136, 3);
        expect(oldClampMpp / 2).toBeLessThan(APPLE_SATELLITE_BAND.finestMetersPerDevicePixel);
        expect(oldClampMpp / 3).toBeLessThan(APPLE_SATELLITE_BAND.finestMetersPerDevicePixel);
    });

    it('holds the short-route arrival AT the floor, on every display density', () => {
        // dpr scales the CSS-pixel answer because the tile pyramid is indexed by device pixels. 1.2 / 2.4 / 3.6
        // m/CSS px all mean the same 1.2 m/device px, which is the point.
        for (const dpr of [1, 2, 3]) {
            expect(frameMetersPerPixel(shortArrival(dpr), INSET_WIDTH))
                .toBeCloseTo(APPLE_SATELLITE_BAND.finestMetersPerDevicePixel * dpr, 3);
        }
    });

    it('still CONTAINS the short route after the clamp has loosened the frame', () => {
        // The floor may only loosen, so containment must survive it — but "must" is what the invariant test at
        // the top of this file says about a TIGHT fit, and this frame is deliberately not tight. Asserted with
        // the same projection, because a clamp that moved the centre while widening would put the route
        // off-centre and nothing else here would notice.
        const INSET = {
            width: DESKTOP.width - ATTRIBUTION.left - ATTRIBUTION.right,
            height: DESKTOP.height - ATTRIBUTION.top - ATTRIBUTION.bottom,
        };
        const bounds = shortRoute();
        for (const dpr of [1, 2, 3]) {
            const region = shortArrival(dpr);
            for (const corner of [bounds[0], bounds[1], [bounds[0][0], bounds[1][1]],
                [bounds[1][0], bounds[0][1]]] as [number, number][]) {
                const point = projectToPixels(corner, region, INSET);
                expect(point.x).toBeGreaterThan(0);
                expect(point.x).toBeLessThan(INSET.width);
                expect(point.y).toBeGreaterThan(0);
                expect(point.y).toBeLessThan(INSET.height);
            }
            // Centred, not merely contained.
            const centre = projectToPixels(
                [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2], region, INSET,
            );
            expect(centre.x).toBeCloseTo(INSET.width / 2, 0);
        }
    });

    it('does NOT touch a real multi-day journey at any density', () => {
        // The cost side of the ledger. The `e2e-alpine-loop` fixture is 12.7 x 15.9 km and frames at ~36 m/px,
        // twenty times coarser than the floor, so the clamp is inert on it — which is what makes it safe to
        // apply to every camera rather than only to the one that broke. If this ever goes red the clamp has
        // started changing journeys it has no business changing.
        const baseline = synthesizeZoom(arrivalRegion(), INSET_WIDTH);
        expect(frameMetersPerPixel(arrivalRegion(), INSET_WIDTH)).toBeCloseTo(36.43, 1);
        // The phone frames it wider still, and one DAY of it is already past the ceiling — which is the
        // arithmetic behind `regionForBounds` refusing the ceiling. imagery.ts quotes these three figures.
        expect(frameMetersPerPixel(
            arrivalRegion(MOBILE, MOBILE_ATTRIBUTION, true), MOBILE_INSET_WIDTH,
        )).toBeCloseTo(40.84, 1);
        expect(frameMetersPerPixel(dayRegion(2), INSET_WIDTH))
            .toBeGreaterThan(APPLE_SATELLITE_BAND.coarsestMetersPerDevicePixel);
        for (const dpr of [1, 2, 3]) {
            expect(synthesizeZoom(arrivalRegion(DESKTOP, ATTRIBUTION, false, dpr), INSET_WIDTH))
                .toBeCloseTo(baseline, 9);
            for (const dayNumber of [1, 2, 3, 4]) {
                expect(synthesizeZoom(dayRegion(dayNumber, dpr), INSET_WIDTH))
                    .toBeCloseTo(synthesizeZoom(dayRegion(dayNumber), INSET_WIDTH), 9);
            }
        }
    });

    it('WITHHOLDS the ceiling from a fit, because honouring it would crop the day segment', () => {
        // The measurement that makes `regionForBounds`' one-ended clamp a decision rather than an omission.
        // Day 2's segment frames at 10.83 m/px — already coarser than the 5 m/device px ceiling — so a
        // two-ended clamp on a containment fit would pull the camera in past the segment and cut the day's
        // route in half. Cloud is imagery quality; a cropped route is a broken view.
        const day2 = frameMetersPerPixel(dayRegion(2), INSET_WIDTH);
        expect(day2).toBeCloseTo(10.83, 1);
        expect(day2).toBeGreaterThan(APPLE_SATELLITE_BAND.coarsestMetersPerDevicePixel);
        // And the fit really is tight, so there is no slack to give up: pulling in to the ceiling would move
        // the segment's own corner outside the padded box.
        const frame = dayFramePadding({ isMobile: false });
        const INSET = {
            width: DESKTOP.width - ATTRIBUTION.left - ATTRIBUTION.right,
            height: DESKTOP.height - ATTRIBUTION.top - ATTRIBUTION.bottom,
        };
        const segment = daySegment(ROUTE, CAMPS, CAMPS.find(c => c.dayNumber === 2)!.id)!;
        const bounds = boundsOfCoordinates(
            COORDINATES.slice(segment.startIndex, segment.endIndex + 1),
        )!;
        const region = dayRegion(2);
        const nw = projectToPixels([bounds[0][0], bounds[1][1]], region, INSET);
        const se = projectToPixels([bounds[1][0], bounds[0][1]], region, INSET);
        const slack = Math.min(
            (INSET.width - frame.left - frame.right) - (se.x - nw.x),
            (INSET.height - frame.top - frame.bottom) - (se.y - nw.y),
        );
        expect(slack).toBeLessThan(2);
    });

    it('applies BOTH ends to a chosen resolution, where nothing has to stay in frame', () => {
        // `regionForZoom`'s caller is picking a resolution outright, so the ceiling is free to bind. Asserted
        // on a deliberately absurd request in each direction rather than on `offRouteZoom` or `PHOTO_ZOOM`,
        // neither of which reaches the ceiling — see the next test, which says so out loud.
        const tooDeep = regionForZoom([8.3, 61.6], 20, { container: DESKTOP, imagery: imagery() });
        expect(frameMetersPerPixel(tooDeep, DESKTOP.width))
            .toBeCloseTo(APPLE_SATELLITE_BAND.finestMetersPerDevicePixel, 6);
        const tooWide = regionForZoom([8.3, 61.6], 11, { container: DESKTOP, imagery: imagery() });
        expect(frameMetersPerPixel(tooWide, DESKTOP.width))
            .toBeCloseTo(APPLE_SATELLITE_BAND.coarsestMetersPerDevicePixel, 6);
    });

    it('inventories which end binds on which camera, so a widening cannot drift past it', () => {
        // The ceiling is NOT dead arithmetic: the mobile off-route camp frame at Kilimanjaro's latitude asks
        // for 6.75 m/px, past the 5 m/device px the Khumbu mosaic was measured clean at, and gets pulled in.
        // Every other chosen zoom sits inside the band. This test is the inventory — if someone widens
        // `offRouteZoom` for context, or moves a fixture, it goes red and they read imagery.ts instead of
        // rediscovering the cloud on the live site.
        const floor = APPLE_SATELLITE_BAND.finestMetersPerDevicePixel;
        const ceiling = APPLE_SATELLITE_BAND.coarsestMetersPerDevicePixel;
        const asked = (zoom: number, lat: number) => metersPerPixel(1 / (256 * Math.pow(2, zoom)), lat);

        // KILIMANJARO (-3.07), the app's equatorial journeys: the mobile off-route frame is over the ceiling.
        expect(asked(offRouteZoom({ isMobile: true }), -3.07)).toBeCloseTo(6.747, 2);
        expect(asked(offRouteZoom({ isMobile: true }), -3.07)).toBeGreaterThan(ceiling);
        const clamped = regionForZoom([37.35, -3.07], offRouteZoom({ isMobile: true }), {
            container: MOBILE, attributionPadding: MOBILE_ATTRIBUTION, imagery: imagery(),
        });
        expect(frameMetersPerPixel(clamped, MOBILE_INSET_WIDTH)).toBeCloseTo(ceiling, 6);

        // Everything else this app chooses is inside the band at dpr 1 — desktop off-route and the photo zoom,
        // at the three latitudes the journeys sit at.
        for (const zoom of [offRouteZoom({ isMobile: false }), PHOTO_ZOOM]) {
            for (const lat of [-3.07, 28, 61.6]) {
                expect(asked(zoom, lat)).toBeLessThanOrEqual(ceiling);
            }
        }
        // And the FLOOR binds on the photo zoom north of roughly 55 N, which is most of this owner's own
        // journeys. Not a regression: 16 was always a request, and 1.13 m/px is imagery the Khumbu does not
        // have even at dpr 1.
        expect(asked(PHOTO_ZOOM, 61.6)).toBeLessThan(floor);
        expect(asked(PHOTO_ZOOM, -3.07)).toBeGreaterThan(floor);
    });

    it('keeps the off-route branch above the e2e threshold on every plausible display', () => {
        // `e2e/day-navigation.spec.ts` proves the off-route branch ran with `cameraZoom > 14`, and the clamp
        // pulls that number DOWN — 15.000 at dpr 1, 14.925 at dpr 2, 14.340 at dpr 3 on the fixture's latitude.
        // All three clear 14, and Playwright runs at dpr 1 where the clamp does not bind at all.
        //
        // The margin is NOT unlimited and pretending otherwise is how a discriminator goes vacuous: the
        // off-route frame is a fixed zoom, so its clamped resolution falls with latitude, and at dpr 3 above
        // roughly 70 N it drops under 14. The e2e fixture is at 61.6 N and no journey in the repo is arctic, so
        // this is a documented limit rather than a live bug — re-check it if a fixture ever moves north.
        for (const dpr of [1, 2, 3]) {
            expect(synthesizeZoom(dayRegion(5, dpr), INSET_WIDTH)).toBeGreaterThan(14);
            for (const dayNumber of [1, 2, 3, 4]) {
                expect(synthesizeZoom(dayRegion(dayNumber, dpr), INSET_WIDTH)).toBeLessThan(14);
            }
        }
        expect(synthesizeZoom(dayRegion(5, 1), INSET_WIDTH)).toBeCloseTo(15.000, 3);
        expect(synthesizeZoom(dayRegion(5, 2), INSET_WIDTH)).toBeCloseTo(14.925, 2);
        expect(synthesizeZoom(dayRegion(5, 3), INSET_WIDTH)).toBeCloseTo(14.340, 2);
        // The arctic case, stated as arithmetic so the limit above is checkable rather than believed.
        const arctic = regionForZoom([8.3, 71], offRouteZoom({ isMobile: false }), {
            container: DESKTOP, attributionPadding: ATTRIBUTION, imagery: imagery(3),
        });
        expect(synthesizeZoom(arctic, INSET_WIDTH)).toBeLessThan(14);
    });
});
