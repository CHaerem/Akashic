/**
 * The journey view on Apple MapKit JS. (MAP-03)
 *
 * An implementation of the vendor surface `src/lib/map/types.ts` defines, and — since MAP-05 deleted
 * `MapboxGlobe.tsx` — the ONLY component in `src/` allowed to name a map vendor
 * (`src/lib/map/boundary.test.ts` enforces that, and bans the `mapkit` *global* as well as the import,
 * because MapKit JS arrives from a CDN script tag and no import ban could ever catch it).
 *
 * This file is deliberately thin. Everything imperative is in `src/lib/map/mapkit/useMapKitJourney.ts`, and
 * everything decidable without a browser is in that directory's pure modules, which is where MAP-03's test
 * coverage lives.
 *
 * ## What this surface does NOT do, and why not — so nobody ports it back in
 *
 * A SETTLED RECORD, not a live comparison. This table was written against a shipping Mapbox adapter, to
 * justify each thing the port left behind; MAP-05 has since deleted that adapter, so every `useMapbox.ts`
 * citation below names a file that no longer exists and nothing here is recoverable by reading the other
 * surface. It is kept because the reasons are the reasons — most of these subsystems were dead ON MAPBOX
 * before the port, which is the finding, and the table is the only place it is written down. Recover the
 * cited lines with `git log --diff-filter=D -- src/hooks/mapbox/` if a claim ever needs re-checking.
 *
 * | dropped | reason |
 * |---|---|
 * | Terrain, fog, sky, `projection: 'globe'`, auto-rotation, the CSS starfield | Zero occurrences of `terrain`, `elevation`, `globe` or `orthographic` in the shipped MapKit bundle. ARCH-01 accepted the loss; MAP-02 owns the landing globe separately. The starfield is only visible at globe zoom. |
 * | Pitch (`camp.pitch`, `trekConfig.preferredPitch`, the 45–60° flight pitches) | MapKit has no tilt — confirmed independently of ARCH-01: zero occurrences of `pitch`, `tilt` or `3d` in the 807 KB bundle. Both fields are annotated as dead at their declarations. |
 * | The `line-blur` glow, and `lineGradient` as a substitute for it | `mapkit.Style` is closed at 13 settable keys, none a blur. `lineGradient` is *accepted* and paints nothing while suppressing the stroke — it would ship an invisible route. Replaced by a three-overlay halo and by `strokeStart`/`strokeEnd`; see `src/lib/map/mapkit/overlays.ts`. |
 * | The eleven native circle/cluster/symbol layers and all `PHOTO_*_PAINT` / `CAMP_*_PAINT` | Hidden unconditionally by the very functions that would populate them (`useMapbox.ts:1302-1311`, `:1518-1526`). Dead as shipped. |
 * | Photo cluster expansion on click | Unreachable: those cluster layers are never visible. |
 * | The whole POI subsystem — four layers, the colour/icon match expressions, the ~170-line glass popup, `updatePOIMarkers`, `flyToPOI` | Unreachable along the data path: `src/lib/journeys/transforms.ts:269-287` never assigns trek-level `TrekData.pointsOfInterest`, so `updatePOIMarkers` was always called with `[]`. **STILL WORTH AN EXPLICIT OWNER ANSWER, and MAP-05 has now made it consequential** — per-*camp* `camp.pointsOfInterest` IS populated and renders in `DayDiscoveries`, so the trek-level path is either a deliberate retirement or an unnoticed regression. MAP-05 deleted the only code that read the trek-level field, so it is no longer "dropped from the port" but gone from the product; `TrekData.pointsOfInterest` (`src/types/trek.ts:85`) is now written by the transform and read by nothing, and `getNearbyPOIs`/`getNextPOI` (`src/utils/routeUtils.ts:581-604`) are unambiguously dead. Restoring it is a feature decision, not a revert. |
 * | `RouteClickInfo` and the ~85-line route-click computation | Dead through the boundary: `onRouteClick` is not a member of `MapSurfaceProps`, `AkashicApp` never passes it, and the handler early-returns on the null ref. |
 * | `startPlayback` / `stopPlayback` / `playbackState` | Returned by `useMapbox` and never destructured by anyone. There is no playback in the journey view. |
 * | The glyph-source style reload, mobile `setTerrain(null)` juggling, `touchPitch`, the 1800 ms deferred update, the 2600 ms marker deferral | Workarounds for terrain and pitch costs MapKit does not have. |
 * | `import 'mapbox-gl/dist/mapbox-gl.css'` | MapKit injects its own stylesheet from the CDN. There is nothing to import, which is also why its attribution cannot be moved with CSS. |
 *
 * The three dead subsystems named above are gone for good: MAP-05 deleted `src/hooks/mapbox/` and
 * `MapboxGlobe.tsx` outright (2707 lines), so there is no longer a second adapter carrying them.
 */

import { useEffect, useRef } from 'react';
import type { VendorSurfaceProps } from '../lib/map/vendorSurface';
import { useMapKitJourney } from '../lib/map/mapkit/useMapKitJourney';
import { useJourneys } from '../contexts/JourneysContext';
import { MapErrorFallback } from './common/ErrorBoundary';
import { colors } from '../styles/liquidGlass';
import type { Photo } from '../types/trek';

export function MapKitJourneyMap({
    selectedTrek, selectedCamp, view, photos = [], onPhotoClick, flyToPhotoRef, recenterRef,
    onCampSelect, getMediaUrl, onViewportChange, onViewportVisiblePhotoIdsChange,
    editMode, onPhotoLocationUpdate, signedIn = false, onReadyChange, mapStateRef,
}: VendorSurfaceProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { trekDataMap } = useJourneys();

    // Route and camp geometry come from context, not from props: `MapSurfaceProps.selectedTrek` carries only
    // lat/lng/bearing/pitch/slug, so the contract alone is not enough to draw a route. The Mapbox adapter
    // reads the same context in the same way (`MapboxGlobe.tsx:175`, `useMapbox.ts:39`).
    const trekData = selectedTrek ? trekDataMap[selectedTrek.id] ?? null : null;

    const { ready, error, retry, flyToPhoto, recenter, getCameraState } = useMapKitJourney({
        containerRef,
        selectedTrek,
        selectedCamp,
        trekData,
        photos,
        signedIn,
        editMode: editMode === true,
        onCampSelect,
        onPhotoClick: (photo: Photo) => {
            if (!onPhotoClick) return;
            const index = photos.findIndex(p => p.id === photo.id);
            onPhotoClick(photo, index >= 0 ? index : 0);
        },
        onPhotoLocationUpdate,
        getMediaUrl,
        onViewportChange,
        onViewportVisiblePhotoIdsChange,
    });

    useEffect(() => {
        onReadyChange?.(ready);
    }, [ready, onReadyChange]);

    useEffect(() => {
        if (!mapStateRef) return;
        mapStateRef.current = getCameraState;
        return () => { mapStateRef.current = null; };
    }, [mapStateRef, getCameraState]);

    useEffect(() => {
        if (!flyToPhotoRef) return;
        flyToPhotoRef.current = flyToPhoto;
        return () => { flyToPhotoRef.current = null; };
    }, [flyToPhotoRef, flyToPhoto]);

    useEffect(() => {
        if (!recenterRef) return;
        recenterRef.current = recenter;
        return () => { recenterRef.current = null; };
    }, [recenterRef, recenter]);

    if (error) {
        // QUA-72: the precise diagnostics (origin claims, exp, the token-minting hint) are for
        // developers — keep them in the console, where they always went. A customer whose network
        // blocks Apple's CDN gets one honest sentence and a Retry that genuinely re-attempts:
        // loader.ts resets its memo on failure precisely so this works, but the button was never
        // wired (`MapErrorFallback` has supported `onRetry` all along).
        console.error('[mapkit] map failed to load:', error);
        return (
            <MapErrorFallback
                error="The map couldn’t load. Check your connection and try again."
                onRetry={retry}
            />
        );
    }


    return (
        <div style={{ position: 'absolute', inset: 0, background: colors.background.base }}>
            {/* `view` is accepted for contract parity and is not read: MapSurface routes the globe view to a
                different surface, so this component only ever renders a journey. Reading it here would make
                the two files disagree about who decides. */}
            <div
                ref={containerRef}
                data-testid={`mapkit-journey-${view}`}
                style={{ position: 'absolute', inset: 0 }}
            />
            {/* QUA-72: map-node-ready is measured at ~0.9–1.1 s plus tile loading — this used to
                be a bare dark box (and on a token failure, 15 silent seconds before the fallback).
                An overlay veil, NOT a separate render branch: the map attaches to the container
                above at init, so the container must never be swapped out mid-load. */}
            {!ready && (
                <div
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                    role="status"
                    aria-live="polite"
                >
                    <span className="animate-pulse text-sm text-white/50">Loading map…</span>
                </div>
            )}
        </div>
    );
}
