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
 * **The swap unit is the component.** `MapSurface` below is what `AkashicApp` renders, and nothing outside
 * the adapter needs to know what implements it. MAP-05 collapsed the two-vendor arrangement this contract was
 * written for into one, which is the boundary being used rather than the boundary being abandoned:
 *
 * - `src/lib/map/` — this contract. No vendor types, ever.
 * - `src/components/MapKitJourneyMap.tsx` + `src/lib/map/mapkit/` — the MapKit adapter. Vendor types are
 *   expected here and nowhere else.
 * - `src/components/AkashicGlobe.tsx` + `src/lib/globe/` — the landing globe, which implements the same
 *   contract with **no vendor at all** and is held to a stricter standard still (see `./boundary.test.ts`).
 * - everything else — neutral.
 *
 * `src/lib/map/boundary.test.ts` is the mechanical enforcement of that list, and it is worth more than this
 * paragraph: it is what caught the boundary being reached past, and it is what will notice if
 * `mapbox-gl` is ever reinstalled.
 *
 * ## What was actually leaking, back when the vendor was Mapbox
 *
 * Almost nothing, which was the useful finding, and it is the evidence that the swap MAP-03/MAP-05 carried
 * out was as cheap as ARCH-01 predicted. `MapboxGlobeProps` and `UseMapboxReturn` were already written in
 * domain terms — `flyToTrek(trek, camp)`, `updatePhotoMarkers(photos, …)`, `TrekConfig`, `Camp`, `Photo`. The
 * only vendor type crossing the boundary was `mapboxgl.LngLatBoundsLike`, threaded through four files for one
 * purpose: telling the photo list which part of the map is visible.
 *
 * And that type was wider than the truth. Its single producer called `bounds.toArray()`, so the only shape
 * ever sent was the nested tuple below — while the consumer carried a second branch for `LngLatBounds`
 * objects (`getWest()` and friends) that nothing could reach, and the tests already passed plain arrays.
 * Naming the real contract deleted that branch rather than porting it. (Past tense throughout: MAP-05 deleted
 * the Mapbox adapter. The tuple shape it bequeathed is still what every surface produces.)
 */

/** A longitude/latitude pair, in that order — the order GeoJSON and both vendors use. */
export type LngLat = [number, number];

/**
 * Visible map area as `[[west, south], [east, north]]`.
 *
 * A plain tuple on purpose: it was what Mapbox's `getBounds().toArray()` produced, it is what the tests
 * already assert with, it survives `JSON.stringify` (which the e2e viewport helpers rely on), and it needs no
 * vendor to construct — so an adapter can build one from any SDK's bounds object without the rest of the app
 * learning that SDK's name. MAP-03 then built one from MapKit's container corners and MAP-05 deleted the
 * original producer, which is the property being claimed here actually paying out.
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
