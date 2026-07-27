/**
 * The vendor-internal extension of `MapSurfaceProps`, and the camera state the e2e suite inspects. (MAP-03)
 *
 * ## Why this is a second interface and not a change to `MapSurfaceProps`
 *
 * `MapSurfaceProps` (`./types.ts`) is the **app-facing** contract: what `AkashicApp` must supply for a map to
 * work. It does not change in MAP-03, and it should not — everything in it is something the showcase means.
 *
 * What MAP-03 needs on top is narrower and is not the app's business: with two vendor surfaces coexisting
 * (Mapbox for the globe, MapKit for the journey view — see `src/components/MapSurface.tsx`), **only one of
 * them may own `window.testHelpers`**. Two components racing to register and delete the same global is a
 * flaky-suite generator. So the eleven-member helper object moves up into the neutral `MapSurface`, and the
 * two members that carry real vendor state come back up through the two hatches below.
 *
 * That is a deliberate widening of MAP-03's stated scope — the task says "the journey view only", but the
 * swap unit is a component that serves BOTH views (`AkashicApp.tsx:248` renders one and passes `view`), so
 * either MAP-03 takes the globe too (replacing a rotating 3D globe with a flat world map on the app's
 * signature first screen) or it introduces a composition point. This is the composition point.
 *
 * The hatches follow the pattern `MapSurfaceProps` already established with `flyToPhotoRef` and `recenterRef`:
 * a ref the surface fills in, so the parent can read vendor state without holding a map.
 */

import type { MutableRefObject } from 'react';
import type { MapSurfaceProps } from './types';

/**
 * What `window.testHelpers.getMapState()` returns.
 *
 * The shape is fixed by two independent hand-written copies that nothing type-checks against each other —
 * the producer at `src/components/MapSurface.tsx` and the consumer at `e2e/utils/test-helpers.ts:40-69`,
 * duplicated because `e2e/` is outside the app tsconfig's `include: ["src"]`. So a silent change here is
 * invisible until a spec throws. Change both or neither.
 */
export interface MapCameraState {
    /**
     * The LIVE camera centre, sampled from the animating map — not the requested target.
     *
     * This is load-bearing. `waitForCameraSettled` (`e2e/utils/test-helpers.ts:303-339`) detects arrival
     * purely by this value holding still for three polls, so a surface that jumped it to the destination
     * immediately would make every camera assertion in `day-navigation.spec.ts` pass vacuously — the exact
     * defect QUA-40 removed. MEASURED for MapKit: `map.center` interpolates
     * (61.600 → 61.700 at 89 ms → 61.820 at 188 ms → 61.900 at 287 ms), so it is safe.
     */
    cameraCenter: [number, number] | null;
    /**
     * A Web-Mercator zoom level, synthesised for MapKit because MapKit has none.
     *
     * `e2e/day-navigation.spec.ts:145` asserts `> 14` as one of two independent signals that the off-route
     * camera branch ran. See `src/lib/map/mapkit/camera.ts` for the derivation and
     * `camera.test.ts` for the calibration that keeps the branches separable.
     */
    cameraZoom: number | null;
    /** Mapbox's `getBearing()`; MapKit's `map.rotation`. Nothing asserts on it, and MAP-03 stays north-up. */
    cameraBearing: number | null;
    /** The camp the surface is currently animating towards, for the stale-selection guard. */
    pendingHighlightCampId: string | null;
    /**
     * True while the surface has an animated camera change in flight.
     *
     * `e2e/utils/test-helpers.ts:325` requires this `false` before it counts a stable poll, so a surface that
     * reports `true` forever DEADLOCKS the suite. For MapKit that is a real hazard rather than a theoretical
     * one: a no-op animated set fires ZERO `region-change-end` events (measured), which is why the flag is
     * cleared by a watchdog as well as by the event. See `useMapKitJourney.ts`.
     */
    hasPendingAnimations: boolean;
}

export const EMPTY_CAMERA_STATE: MapCameraState = {
    cameraCenter: null,
    cameraZoom: null,
    cameraBearing: null,
    pendingHighlightCampId: null,
    hasPendingAnimations: false,
};

/** What a concrete vendor surface accepts. `MapSurface` supplies the extras; `AkashicApp` never sees them. */
export interface VendorSurfaceProps extends MapSurfaceProps {
    /**
     * Whether the visitor is signed in.
     *
     * Needed because Apple's attribution can only be lifted clear of the signed-out showcase's bottom chips
     * with `map.padding`, which is an adapter API call and cannot be expressed as a CSS media query. See
     * `src/lib/map/mapkit/chrome.ts` for the measurement.
     */
    signedIn?: boolean;
    /** Reports the vendor's readiness up to whoever owns `window.testHelpers.isMapReady`. */
    onReadyChange?: (ready: boolean) => void;
    /** Filled in by the surface, the way `flyToPhotoRef` already is. */
    mapStateRef?: MutableRefObject<(() => MapCameraState) | null>;
}
