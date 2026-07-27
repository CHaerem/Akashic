/**
 * Route, segment and photo-grouping geometry for the MapKit surface — pure. (MAP-03)
 *
 * All of it is behaviour lifted out of `src/hooks/mapbox/useMapbox.ts`, where it is tangled with an
 * imperative map and therefore has **no unit test at all** (`grep -rln groupPhotosByLocation src` finds only
 * that one file). Moving it here is most of MAP-03's new coverage: the day-segment slicing and the on/off
 * route threshold decide which camera branch runs, and `e2e/day-navigation.spec.ts` asserts against both
 * branches, so a silent change here shows up as a confusing Playwright failure rather than a red unit test.
 *
 * Nothing in this file imports MapKit or React.
 */

import type { LngLat, MapBounds } from '../types';
import type { Camp, Photo, Route } from '../../../types/trek';
import { findNearestCoordIndex, getDistanceFromLatLonInKm } from '../../../utils/geography';

/**
 * One route point: `[lng, lat, elevation]`. Spelled out rather than imported because `Route['coordinates']`
 * is mutable and every function here only reads.
 */
export type RouteCoord = [number, number, number];

/** Kilometres from the route beyond which a camp gets a plain centred frame, not a segment fit. */
export const OFF_ROUTE_KM = 10;

/**
 * Bounds of a whole route.
 *
 * The sampling rule is the incumbent's (`useMapbox.ts:1130-1148`) and is kept deliberately, including the
 * part that is easy to lose: above 500 points it samples every `ceil(n / 100)`, **and then unconditionally
 * folds in the last point**. Without that, a route whose final point is its extreme — a summit finish, a
 * descent to a fjord — gets bounds that exclude its own end.
 */
export function boundsOfRoute(coordinates: readonly RouteCoord[]): MapBounds | null {
    if (!coordinates.length) return null;
    const sampleRate = coordinates.length > 500 ? Math.ceil(coordinates.length / 100) : 1;

    let minLng = coordinates[0][0];
    let maxLng = coordinates[0][0];
    let minLat = coordinates[0][1];
    let maxLat = coordinates[0][1];
    const fold = (coordinate: RouteCoord) => {
        if (coordinate[0] < minLng) minLng = coordinate[0];
        if (coordinate[0] > maxLng) maxLng = coordinate[0];
        if (coordinate[1] < minLat) minLat = coordinate[1];
        if (coordinate[1] > maxLat) maxLat = coordinate[1];
    };
    for (let i = 0; i < coordinates.length; i += sampleRate) fold(coordinates[i]);
    fold(coordinates[coordinates.length - 1]);

    return [[minLng, minLat], [maxLng, maxLat]];
}

/** Bounds of an explicit coordinate list — the day-segment case, where every point matters. */
export function boundsOfCoordinates(
    coordinates: readonly RouteCoord[],
): MapBounds | null {
    if (!coordinates.length) return null;
    let minLng = coordinates[0][0];
    let maxLng = coordinates[0][0];
    let minLat = coordinates[0][1];
    let maxLat = coordinates[0][1];
    for (const coordinate of coordinates) {
        if (coordinate[0] < minLng) minLng = coordinate[0];
        if (coordinate[0] > maxLng) maxLng = coordinate[0];
        if (coordinate[1] < minLat) minLat = coordinate[1];
        if (coordinate[1] > maxLat) maxLat = coordinate[1];
    }
    return [[minLng, minLat], [maxLng, maxLat]];
}

export interface DaySegment {
    /** Inclusive index into `route.coordinates`. */
    startIndex: number;
    /** Inclusive index into `route.coordinates`. */
    endIndex: number;
    /** How far the camp sits from its nearest route point, in km. */
    distanceToRouteKm: number;
    /** True when the camp is more than {@link OFF_ROUTE_KM} from the route, or the slice is degenerate. */
    offRoute: boolean;
}

/**
 * The route slice for a selected day: from the previous camp (or the route start on day 1) to this camp.
 *
 * Returns `null` when the camp is not in the list or the route is empty — the caller then hides the
 * highlight, matching `hideActiveSegment` (`useMapbox.ts:890-898`).
 *
 * Note `offRoute` is true both for a genuinely distant camp *and* for a degenerate slice
 * (`endIndex <= startIndex`, which is day 1 with its camp at the route start). The incumbent conflates those
 * two at `useMapbox.ts:1079` — `actualEnd > actualStart && distanceToRoute <= 10` — and so does this, on
 * purpose: both cases want a centred frame rather than a fit over nothing.
 */
export function daySegment(route: Route, camps: readonly Camp[], campId: string): DaySegment | null {
    const coordinates = route?.coordinates;
    if (!coordinates || coordinates.length === 0) return null;

    const campIndex = camps.findIndex(c => c.id === campId);
    if (campIndex === -1) return null;
    const camp = camps[campIndex];

    const startCoord: LngLat = campIndex === 0
        ? [coordinates[0][0], coordinates[0][1]]
        : camps[campIndex - 1].coordinates;

    const startIndex = findNearestCoordIndex(coordinates, startCoord);
    const endIndex = findNearestCoordIndex(coordinates, camp.coordinates);
    const nearest = coordinates[endIndex];
    const distanceToRouteKm = getDistanceFromLatLonInKm(
        camp.coordinates[1], camp.coordinates[0], nearest[1], nearest[0],
    );

    const lo = Math.min(startIndex, endIndex);
    const hi = Math.max(startIndex, endIndex);
    return {
        startIndex: lo,
        endIndex: hi,
        distanceToRouteKm,
        offRoute: hi <= lo || distanceToRouteKm > OFF_ROUTE_KM,
    };
}

/**
 * The `strokeStart` / `strokeEnd` pair that highlights `[startIndex, endIndex]` of a polyline.
 *
 * **MEASURED: MapKit's `strokeStart`/`strokeEnd` are fractions of ARC LENGTH, not of point index.** Settled
 * visually on a 3-point line with a 10:1 leg ratio, where the two answers are 180 px apart —
 * `scripts/mapkit/surface-probe/?probe=m2`. So this accumulates real distance rather than dividing indices,
 * which matters here: `src/fixtures/assets/e2e-alpine-loop.route.json` is 13 points and a real GPX route is
 * not evenly spaced.
 *
 * Why this instead of a second sliced overlay: both properties are live-mutable on an overlay already on the
 * map, so switching day is two property writes and no geometry rebuild — strictly cheaper than the
 * incumbent's `source.setData` (`useMapbox.ts:939-948`). And it cannot go out of sync with the base route,
 * because it *is* the base route's own parameterisation.
 */
export function strokeFractions(
    coordinates: readonly RouteCoord[],
    startIndex: number,
    endIndex: number,
): { strokeStart: number; strokeEnd: number } | null {
    if (coordinates.length < 2) return null;
    const lo = Math.max(0, Math.min(startIndex, endIndex));
    const hi = Math.min(coordinates.length - 1, Math.max(startIndex, endIndex));
    if (hi <= lo) return null;

    const cumulative: number[] = [0];
    for (let i = 1; i < coordinates.length; i += 1) {
        const a = coordinates[i - 1];
        const b = coordinates[i];
        cumulative.push(cumulative[i - 1] + getDistanceFromLatLonInKm(a[1], a[0], b[1], b[0]));
    }
    const total = cumulative[cumulative.length - 1];
    if (!(total > 0)) return null;

    return {
        strokeStart: Math.max(0, Math.min(1, cumulative[lo] / total)),
        strokeEnd: Math.max(0, Math.min(1, cumulative[hi] / total)),
    };
}

export interface PhotoGroup {
    /** Grid cell key — stable for a given zoom, but NOT stable across zooms. */
    key: string;
    photos: Photo[];
    /** The photo whose id keys the marker, and whose thumbnail is drawn. */
    representative: Photo;
    count: number;
    /** Centroid of the group, where the marker is anchored. */
    center: LngLat;
}

/**
 * Group photos into a zoom-derived spatial grid, one marker per cell.
 *
 * Moved verbatim in behaviour from `useMapbox.ts:1264-1291`, cell size `0.1 / 2^(zoom − 8)`. Deliberately
 * NOT replaced by MapKit's own clustering (`clusteringIdentifier` + `map.annotationForCluster`): the
 * showcase's stacks carry up to two offset backing cards, MapKit's cluster annotation is not in
 * `map.annotations` so it cannot be diffed by id, and assigning `annotationForCluster` after `addAnnotations`
 * fails *silently* with Apple's default marker rendering instead of the app's — a failure that looks like a
 * styling regression rather than a wiring bug.
 */
export function groupPhotosByLocation(photos: readonly Photo[], zoom: number): PhotoGroup[] {
    const cellSize = 0.1 / Math.pow(2, zoom - 8);
    const cells = new Map<string, Photo[]>();

    for (const photo of photos) {
        if (!photo.coordinates || photo.coordinates.length !== 2) continue;
        const [lng, lat] = photo.coordinates;
        const key = `${Math.floor(lng / cellSize)},${Math.floor(lat / cellSize)}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(photo);
        else cells.set(key, [photo]);
    }

    return Array.from(cells.entries()).map(([key, groupPhotos]) => ({
        key,
        photos: groupPhotos,
        representative: groupPhotos[0],
        count: groupPhotos.length,
        center: [
            groupPhotos.reduce((sum, p) => sum + (p.coordinates as LngLat)[0], 0) / groupPhotos.length,
            groupPhotos.reduce((sum, p) => sum + (p.coordinates as LngLat)[1], 0) / groupPhotos.length,
        ] as LngLat,
    }));
}

/**
 * The 24 px-margin viewport test behind `onViewportVisiblePhotoIdsChange`
 * (`src/components/MapboxGlobe.tsx:240-249`).
 *
 * Screen-space, not bounds-space, and inclusive at the boundary — a photo exactly `marginPx` outside counts
 * as visible, which is what the incumbent's `>=` / `<=` do.
 */
export function visibleInPaddedBox(
    point: { x: number; y: number },
    box: { width: number; height: number },
    marginPx: number,
): boolean {
    return Number.isFinite(point.x)
        && Number.isFinite(point.y)
        && point.x >= -marginPx
        && point.x <= box.width + marginPx
        && point.y >= -marginPx
        && point.y <= box.height + marginPx;
}

/** Pad a viewport for the "which photos might need a marker" pre-filter (`useMapbox.ts:1356-1363`). */
export function padBounds(bounds: MapBounds, degrees: number): MapBounds {
    const [[west, south], [east, north]] = bounds;
    return [[west - degrees, south - degrees], [east + degrees, north + degrees]];
}

/** Is a coordinate inside bounds? Used for the marker pre-filter only. */
export function withinBounds(coordinate: LngLat, bounds: MapBounds): boolean {
    const [[west, south], [east, north]] = bounds;
    return coordinate[0] >= west && coordinate[0] <= east && coordinate[1] >= south && coordinate[1] <= north;
}
