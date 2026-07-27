/**
 * MAP-05: "the incumbent" below means the Mapbox surface, which MAP-05 DELETED (2707 lines), and any
 * `useMapbox.ts` / `layerConfigs.ts` citation is a historical measurement whose path no longer resolves.
 * Recover it with `git log --diff-filter=D -- src/hooks/mapbox/`. Kept because the measurement is the reason
 * the code is shaped this way; see the fuller note in the module this exercises.
 */
import { describe, it, expect } from 'vitest';
import routeJson from '../../../fixtures/assets/e2e-alpine-loop.route.json';
import waypointsJson from '../../../fixtures/assets/e2e-alpine-loop.waypoints.json';
import type { Camp, Photo, Route } from '../../../types/trek';
import {
    OFF_ROUTE_KM, boundsOfCoordinates, boundsOfRoute, daySegment, groupPhotosByLocation, padBounds,
    strokeFractions, visibleInPaddedBox, withinBounds, type RouteCoord,
} from './geometry';

const COORDINATES = routeJson.coordinates as RouteCoord[];
const ROUTE: Route = { type: 'LineString', coordinates: COORDINATES };
const CAMPS = (waypointsJson as unknown as Camp[]).map((camp, index) => ({
    ...camp,
    id: camp.id ?? `fixture-camp-${index}`,
})) as Camp[];

function photo(id: string, lng: number, lat: number, extra: Partial<Photo> = {}): Photo {
    return { id, url: `/${id}.jpg`, coordinates: [lng, lat], ...extra } as Photo;
}

describe('boundsOfRoute (MAP-03)', () => {
    it('covers the fixture route exactly', () => {
        expect(boundsOfRoute(COORDINATES)).toEqual([[8.3, 61.6], [8.54, 61.744]]);
    });

    it('returns null for an empty route rather than NaN bounds', () => {
        expect(boundsOfRoute([])).toBeNull();
    });

    it('includes the LAST point even when sampling skips it', () => {
        // The incumbent samples every ceil(n/100) above 500 points (useMapbox.ts:1130-1148) and then folds in
        // the final point unconditionally. Losing that line is invisible on a dense route and wrong on
        // exactly the routes that matter — a summit finish, a descent to a fjord. 1001 points, and the last
        // one is the extreme.
        const dense: RouteCoord[] = Array.from({ length: 1001 }, (_, i) => [8.3 + i * 1e-5, 61.6 + i * 1e-5, 900]);
        dense[1000] = [9.9, 62.9, 2400];
        const bounds = boundsOfRoute(dense)!;
        expect(bounds[1]).toEqual([9.9, 62.9]);
        // And prove the sampling really would have skipped it: index 1000 is not a multiple of ceil(1001/100).
        expect(1000 % Math.ceil(1001 / 100)).not.toBe(0);
    });

    it('does not sample at all below the 500-point threshold', () => {
        const sparse: RouteCoord[] = [[8.0, 61.0, 0], [8.5, 61.9, 0], [8.2, 61.2, 0]];
        expect(boundsOfRoute(sparse)).toEqual([[8.0, 61.0], [8.5, 61.9]]);
    });
});

describe('boundsOfCoordinates (MAP-03)', () => {
    it('covers every point of a day slice', () => {
        expect(boundsOfCoordinates(COORDINATES.slice(2, 6))).toEqual([[8.34, 61.624], [8.4, 61.66]]);
    });

    it('returns null for an empty slice', () => {
        expect(boundsOfCoordinates([])).toBeNull();
    });
});

describe('daySegment (MAP-03)', () => {
    const segmentFor = (dayNumber: number) =>
        daySegment(ROUTE, CAMPS, CAMPS.find(c => c.dayNumber === dayNumber)!.id);

    it('slices day 1 from the route start to its camp', () => {
        // Day 1's camp is at routePointIndex 2, so this is NOT degenerate — the degenerate case is a camp
        // sitting on point 0, tested below.
        expect(segmentFor(1)).toMatchObject({ startIndex: 0, endIndex: 2, offRoute: false });
    });

    it('slices each later day from the previous camp to this one', () => {
        expect(segmentFor(2)).toMatchObject({ startIndex: 2, endIndex: 5, offRoute: false });
        expect(segmentFor(3)).toMatchObject({ startIndex: 5, endIndex: 8, offRoute: false });
        expect(segmentFor(4)).toMatchObject({ startIndex: 8, endIndex: 11, offRoute: false });
    });

    it('flags the fixture off-route camp, and measures how far out it is', () => {
        const segment = segmentFor(5)!;
        expect(segment.offRoute).toBe(true);
        // Day 5 of e2e-alpine-loop is a fjord rest day 12.28 km from the route — the only camp in the fixture
        // that exercises the flyTo branch, which is why e2e/day-navigation.spec.ts uses day 5 for it.
        expect(segment.distanceToRouteKm).toBeGreaterThan(OFF_ROUTE_KM);
        expect(segment.distanceToRouteKm).toBeCloseTo(12.28, 1);
    });

    it('treats a degenerate slice as off-route so the camera centres instead of fitting nothing', () => {
        const camps = [{ ...CAMPS[0], coordinates: COORDINATES[0].slice(0, 2) as [number, number] }] as Camp[];
        const segment = daySegment(ROUTE, camps, camps[0].id)!;
        expect(segment.startIndex).toBe(segment.endIndex);
        expect(segment.offRoute).toBe(true);
        expect(segment.distanceToRouteKm).toBeCloseTo(0, 6);
    });

    it('returns null for an unknown camp or an empty route', () => {
        expect(daySegment(ROUTE, CAMPS, 'no-such-camp')).toBeNull();
        expect(daySegment({ type: 'LineString', coordinates: [] }, CAMPS, CAMPS[0].id)).toBeNull();
    });
});

describe('strokeFractions (MAP-03)', () => {
    it('is monotonic, inside [0,1], and contiguous day to day', () => {
        // Contiguity matters: the four on-route days tile the route, so day N's end must be day N+1's start.
        // If it were not, the cyan highlight would jump or overlap as the user walks through the journey.
        const fractions = [1, 2, 3, 4].map((day) => {
            const segment = daySegment(ROUTE, CAMPS, CAMPS.find(c => c.dayNumber === day)!.id)!;
            return strokeFractions(COORDINATES, segment.startIndex, segment.endIndex)!;
        });
        for (const f of fractions) {
            expect(f.strokeStart).toBeGreaterThanOrEqual(0);
            expect(f.strokeEnd).toBeLessThanOrEqual(1);
            expect(f.strokeEnd).toBeGreaterThan(f.strokeStart);
        }
        for (let i = 1; i < fractions.length; i += 1) {
            expect(fractions[i].strokeStart).toBeCloseTo(fractions[i - 1].strokeEnd, 10);
        }
        expect(fractions[0].strokeStart).toBe(0);
    });

    it('measures ARC LENGTH, not point index', () => {
        // MEASURED: MapKit's strokeStart/strokeEnd are arc-length fractions
        // (scripts/mapkit/surface-probe/?probe=m2). So on a line whose first leg is ten times the second, the
        // midpoint by index is NOT the midpoint by length, and only the length answer is correct.
        const uneven: RouteCoord[] = [[8.2, 61.6, 0], [8.4, 61.6, 0], [8.42, 61.6, 0]];
        const toMiddleVertex = strokeFractions(uneven, 0, 1)!;
        expect(toMiddleVertex.strokeEnd).toBeCloseTo(0.2 / 0.22, 4);   // ~0.909 by length
        expect(toMiddleVertex.strokeEnd).not.toBeCloseTo(0.5, 2);      // 0.5 would be the index answer
    });

    it('returns null for a degenerate or zero-length line, so the highlight hides', () => {
        expect(strokeFractions(COORDINATES, 4, 4)).toBeNull();
        expect(strokeFractions([[8.3, 61.6, 0]], 0, 0)).toBeNull();
        expect(strokeFractions([[8.3, 61.6, 0], [8.3, 61.6, 0]], 0, 1)).toBeNull();
    });

    it('clamps an out-of-range index rather than producing a fraction above 1', () => {
        const fractions = strokeFractions(COORDINATES, -5, 9999)!;
        expect(fractions.strokeStart).toBe(0);
        expect(fractions.strokeEnd).toBe(1);
    });
});

describe('groupPhotosByLocation (MAP-03)', () => {
    it('collapses co-located photos into one group and keeps the first as representative', () => {
        const groups = groupPhotosByLocation([
            photo('a', 8.3, 61.6), photo('b', 8.3001, 61.6001), photo('c', 8.3002, 61.6002),
        ], 12);
        expect(groups).toHaveLength(1);
        expect(groups[0].count).toBe(3);
        expect(groups[0].representative.id).toBe('a');
        expect(groups[0].center[0]).toBeCloseTo((8.3 + 8.3001 + 8.3002) / 3, 9);
    });

    it('splits the same photos into more groups as zoom increases', () => {
        // Cell size is 0.1 / 2^(zoom - 8), so a higher zoom means a finer grid. This is the behaviour that
        // makes the stacks break apart as the user zooms in.
        const photos = [photo('a', 8.30, 61.6), photo('b', 8.32, 61.6), photo('c', 8.36, 61.6)];
        expect(groupPhotosByLocation(photos, 8)).toHaveLength(1);
        expect(groupPhotosByLocation(photos, 14).length).toBeGreaterThan(1);
    });

    it('skips photos without a usable coordinate instead of grouping them at 0,0', () => {
        const groups = groupPhotosByLocation([
            photo('good', 8.3, 61.6),
            { id: 'nocoords', url: '/x.jpg' } as Photo,
            { id: 'short', url: '/y.jpg', coordinates: [8.3] as unknown as [number, number] } as Photo,
        ], 12);
        expect(groups).toHaveLength(1);
        expect(groups[0].representative.id).toBe('good');
    });
});

describe('visibleInPaddedBox (MAP-03)', () => {
    const box = { width: 1280, height: 720 };

    it('is inclusive exactly at the margin', () => {
        expect(visibleInPaddedBox({ x: -24, y: -24 }, box, 24)).toBe(true);
        expect(visibleInPaddedBox({ x: 1304, y: 744 }, box, 24)).toBe(true);
        expect(visibleInPaddedBox({ x: -24.01, y: 0 }, box, 24)).toBe(false);
        expect(visibleInPaddedBox({ x: 0, y: 744.01 }, box, 24)).toBe(false);
    });

    it('rejects a non-finite projection rather than reporting it visible', () => {
        // MapKit's convertCoordinateToPointOnPage can hand back a degenerate point before the map has a
        // transform — the same shape as the unguarded getBounds() defect QUA-02 found.
        expect(visibleInPaddedBox({ x: Number.NaN, y: 0 }, box, 24)).toBe(false);
        expect(visibleInPaddedBox({ x: 0, y: Number.POSITIVE_INFINITY }, box, 24)).toBe(false);
    });
});

describe('padBounds / withinBounds (MAP-03)', () => {
    it('grows the box on every side', () => {
        expect(padBounds([[8, 61], [9, 62]], 0.05)).toEqual([[7.95, 60.95], [9.05, 62.05]]);
    });

    it('accepts a point on the boundary', () => {
        expect(withinBounds([8, 61], [[8, 61], [9, 62]])).toBe(true);
        expect(withinBounds([7.99, 61], [[8, 61], [9, 62]])).toBe(false);
    });
});
