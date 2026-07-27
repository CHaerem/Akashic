/**
 * The lat/lng inversion boundary. (MAP-03)
 *
 * `mapkit.Coordinate` is `(latitude, longitude)`. This repo's `LngLat` is `[lng, lat]` — GeoJSON order,
 * which both Mapbox and the CloudKit records use. Every value crossing into or out of MapKit inverts, in
 * both directions, and **a transposed pair does not throw**: the fixture journeys sit at ~61.6 N, 8.3 E, and
 * `(8.3, 61.6)` read as (lat, lng) is a valid coordinate in the Indian Ocean off Somalia. The map renders,
 * the camera flies, and the route is simply not where the journey is.
 *
 * So the conversion lives here and only here, in two functions, with the tightest unit test in the adapter
 * behind it. Nothing else under `src/lib/map/mapkit/` may read `.latitude` / `.longitude` off a MapKit
 * object or index a `LngLat` tuple for the purpose of building one.
 *
 * These functions deliberately return and accept **plain objects**, never `mapkit.Coordinate` instances, so
 * that this module is importable by vitest with no browser and no `window.mapkit`. The adapter wraps the
 * result in the real vendor type at the call site (see `./overlays.ts`).
 */

import type { LngLat } from '../types';
import type { MKCoordinate } from './mapkitTypes';

/** A MapKit-shaped coordinate without the vendor methods — what the pure layer passes around. */
export interface LatLng {
    latitude: number;
    longitude: number;
}

/** `[lng, lat]` → `{ latitude, longitude }`. The only place the order flips inward. */
export function toLatLng(coordinate: LngLat | readonly [number, number, ...number[]]): LatLng {
    return { latitude: coordinate[1], longitude: coordinate[0] };
}

/** `{ latitude, longitude }` → `[lng, lat]`. The only place the order flips outward. */
export function toLngLat(coordinate: LatLng | MKCoordinate): LngLat {
    return [coordinate.longitude, coordinate.latitude];
}

/*
 * There was a `toLatLngs` batch form here. Deleted by QUA-51: its only caller was its own test.
 * `./overlays.ts` maps a route through `coordinate()` because it needs real `mapkit.Coordinate` instances,
 * not plain objects, so a batch of plain objects has no call site to grow into. The elevation-dropping
 * behaviour it was tested for belongs to `toLatLng` and is still asserted there (`coords.test.ts`).
 */
