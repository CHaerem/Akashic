/**
 * The map contract the showcase speaks — vendor-neutral by construction. (MAP-01)
 *
 * ## Why this file exists
 *
 * ARCH-01 chose Apple MapKit for both surfaces, on the reasoning that the map is ONE architectural
 * choice rather than two: if a different vendor ever fits better, both surfaces should move as a single
 * job. That is only true if the web's map sits behind a boundary narrow enough that the next swap is one
 * adapter. Written after a MapKit port instead of before it, this file would have MapKit's shape baked
 * into it and the swap after that would cost the same as this one.
 *
 * ## Where the boundary is
 *
 * **The swap unit is the component.** `MapSurface` below is what `AkashicApp` renders; today
 * `MapboxGlobe` implements it, tomorrow a MapKit component does, and nothing outside those two files
 * needs to know which. So:
 *
 * - `src/lib/map/` — this contract. No vendor types, ever.
 * - `src/components/MapboxGlobe.tsx` + `src/hooks/mapbox/` — the Mapbox adapter. Vendor types are
 *   expected here and nowhere else.
 * - everything else — neutral.
 *
 * ## What was actually leaking
 *
 * Almost nothing, which is the useful finding. `MapboxGlobeProps` and `UseMapboxReturn` were already
 * written in domain terms — `flyToTrek(trek, camp)`, `updatePhotoMarkers(photos, …)`, `TrekConfig`,
 * `Camp`, `Photo`. The only vendor type crossing the boundary was `mapboxgl.LngLatBoundsLike`, threaded
 * through four files for one purpose: telling the photo list which part of the map is visible.
 *
 * And that type was wider than the truth. The single producer calls `bounds.toArray()`, so the only
 * shape ever sent is the nested tuple below — while the consumer carried a second branch for
 * `LngLatBounds` objects (`getWest()` and friends) that nothing could reach, and the tests already
 * passed plain arrays. Naming the real contract deleted that branch rather than porting it.
 */

/** A longitude/latitude pair, in that order — the order GeoJSON and both vendors use. */
export type LngLat = [number, number];

/**
 * Visible map area as `[[west, south], [east, north]]`.
 *
 * A plain tuple on purpose: it is what Mapbox's `getBounds().toArray()` already produced, it is what the
 * tests already assert with, it survives `JSON.stringify` (which the e2e viewport helpers rely on), and
 * it needs no vendor to construct — so an adapter can build one from any SDK's bounds object without the
 * rest of the app learning that SDK's name.
 *
 * Longitude may be un-normalised across the antimeridian: a viewport straddling ±180° legitimately
 * yields west > east, and `PhotosTab.isWithinBounds` handles that case deliberately. Do not "fix" it by
 * sorting the corners.
 */
export type MapBounds = [LngLat, LngLat];

/** Which view the surface should present. Mirrors the app's own `ViewMode`. */
export type { ViewMode } from '../../types/trek';

/**
 * Everything a map surface must accept. **This is the swap unit** — a new vendor means a new component
 * implementing exactly this, and no other file changes.
 *
 * Deliberately expressed in the showcase's own vocabulary (treks, camps, photos) rather than in map
 * primitives (layers, sources, paint properties). A contract phrased in the second vocabulary is a
 * contract shaped by whichever vendor happened to be first.
 */
export interface MapSurfaceProps {
    selectedTrek: import('../../types/trek').TrekConfig | null;
    selectedCamp: import('../../types/trek').Camp | null;
    onSelectTrek: (trek: import('../../types/trek').TrekConfig) => void;
    view: import('../../types/trek').ViewMode;
    photos?: import('../../types/trek').Photo[];
    onPhotoClick?: (photo: import('../../types/trek').Photo, index: number) => void;
    /** Imperative escape hatches the surface fills in, so the parent can drive it without holding a map. */
    flyToPhotoRef?: React.MutableRefObject<((photo: import('../../types/trek').Photo) => void) | null>;
    recenterRef?: React.MutableRefObject<(() => void) | null>;
    onCampSelect?: (camp: import('../../types/trek').Camp) => void;
    getMediaUrl?: (path: string) => string;
    /** Fires when the visible area changes, so the photo list can scope itself to the map. */
    onViewportChange?: (bounds: MapBounds) => void;
    onViewportVisiblePhotoIdsChange?: (photoIds: string[]) => void;
    editMode?: boolean;
    onPhotoLocationUpdate?: (photoId: string, coordinates: LngLat) => void;
}
