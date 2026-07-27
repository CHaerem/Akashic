import { describe, it, expect } from 'vitest';
import routeJson from '../../../fixtures/assets/e2e-alpine-loop.route.json';
import { toLatLng, toLngLat, toLatLngs } from './coords';
import type { RouteCoord } from './geometry';

/**
 * The single highest-value test in the MapKit adapter, for a reason that is worth stating: a transposed
 * lat/lng pair **does not throw**. It renders a map, flies a camera and draws a route — somewhere else.
 * `mapkit.Coordinate` is `(latitude, longitude)`; this repo's `LngLat` is `[lng, lat]`.
 */
describe('coords (MAP-03)', () => {
    it('puts a Jotunheimen fixture coordinate in Norway, not in the Indian Ocean', () => {
        // The fixture journeys sit at ~61.6 N, 8.3 E. Transposed, (8.3 N, 61.6 E) is open water off Somalia:
        // a perfectly valid coordinate, which is exactly why this cannot be caught by a runtime check.
        expect(toLatLng([8.3, 61.6])).toEqual({ latitude: 61.6, longitude: 8.3 });
        expect(toLatLng([8.3, 61.6]).latitude).toBeGreaterThan(60);
        expect(toLatLng([8.3, 61.6]).longitude).toBeLessThan(10);
    });

    it('inverts back to LngLat order', () => {
        expect(toLngLat({ latitude: 61.6, longitude: 8.3 })).toEqual([8.3, 61.6]);
    });

    it('round-trips every point of the real fixture route', () => {
        const coordinates = routeJson.coordinates as RouteCoord[];
        expect(coordinates.length).toBeGreaterThan(1);
        for (const coordinate of coordinates) {
            const [lng, lat] = toLngLat(toLatLng(coordinate));
            expect(lng).toBe(coordinate[0]);
            expect(lat).toBe(coordinate[1]);
        }
    });

    it('drops the elevation third element rather than smuggling it through', () => {
        // Route coordinates are [lng, lat, elevation]. A MapKit coordinate has no elevation, and passing one
        // through as a longitude would be a spectacular failure — assert the shape, not just the values.
        const converted = toLatLngs([[8.3, 61.6, 900]]);
        expect(Object.keys(converted[0]).sort()).toEqual(['latitude', 'longitude']);
        expect(converted[0]).toEqual({ latitude: 61.6, longitude: 8.3 });
    });
});
