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
    arrivalFramePadding, attributionPadding, DAY_FIT_MAX_ZOOM, dayFramePadding, offRouteZoom,
} from './chrome';
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

function arrivalRegion(container = DESKTOP, attribution = ATTRIBUTION, isMobile = false) {
    return regionForBounds(boundsOfRoute(COORDINATES)!, {
        container,
        framePadding: arrivalFramePadding({ isMobile }),
        attributionPadding: attribution,
        maxZoom: DAY_FIT_MAX_ZOOM,
    });
}

function dayRegion(dayNumber: number) {
    const camp = CAMPS.find(c => c.dayNumber === dayNumber)!;
    const segment = daySegment(ROUTE, CAMPS, camp.id)!;
    if (segment.offRoute) {
        return regionForZoom(camp.coordinates, offRouteZoom({ isMobile: false }), {
            container: DESKTOP, attributionPadding: ATTRIBUTION,
        });
    }
    const slice = COORDINATES.slice(segment.startIndex, segment.endIndex + 1);
    return regionForBounds(boundsOfCoordinates(slice)!, {
        container: DESKTOP,
        framePadding: dayFramePadding({ isMobile: false }),
        attributionPadding: ATTRIBUTION,
        maxZoom: DAY_FIT_MAX_ZOOM,
    });
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
            container: MOBILE, attributionPadding: MOBILE_ATTRIBUTION,
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

    it('clamps a single-point bounds at maxZoom instead of asking for infinite zoom', () => {
        const point: MapBounds = [[8.3, 61.6], [8.3, 61.6]];
        const region = regionForBounds(point, {
            container: DESKTOP,
            framePadding: { top: 0, right: 0, bottom: 0, left: 0 },
            maxZoom: DAY_FIT_MAX_ZOOM,
        });
        expect(synthesizeZoom(region, 1280)).toBeCloseTo(DAY_FIT_MAX_ZOOM, 6);
        expect(region.center[0]).toBeCloseTo(8.3, 6);
        expect(region.center[1]).toBeCloseTo(61.6, 6);
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
