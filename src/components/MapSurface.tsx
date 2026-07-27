/**
 * Picks which vendor draws the map, and owns `window.testHelpers`. (MAP-03)
 *
 * Names **no** map SDK — that is why it is not in `src/lib/map/boundary.test.ts`'s adapter allowlist. It
 * composes vendor components; it does not talk to a vendor.
 *
 * ## How the app chooses between the two surfaces
 *
 * Both coexist, and will until MAP-05 (which depends on MAP-02 and is not done):
 *
 * - **`VITE_MAP_VENDOR` is unset or `mapbox` — the DEFAULT.** Mapbox draws both views, exactly as before this
 *   task. Nothing regresses, and the currently-green Playwright run is untouched by MAP-03.
 * - **`VITE_MAP_VENDOR=mapkit`.** MapKit draws the **journey** view; Mapbox still draws the **globe**. That
 *   split is deliberate and not a half-measure: MapKit JS has no globe at all — zero occurrences of `globe`,
 *   `orthographic`, `pitch` or `tilt` in the shipped bundle — so pointing MAP-03 at `view === 'globe'` would
 *   replace the app's signature rotating 3D globe with a flat satellite world map. MAP-02 owns the landing
 *   globe as its own job.
 *
 * The flag stays defaulted to Mapbox until MapKit has been through the device/beta loop. Flipping it also
 * makes three other things false at once, none of them config: `e2e/fixtures/test.ts`'s pinned external-host
 * list, the five Workbox `api.mapbox.com` runtime-caching rules at `vite.config.js:71-133`, and
 * `public/privacy.html:61` and `:102-106`, which name Mapbox as the map provider and as third-party
 * telemetry. That last one is a user-facing statement about data handling.
 *
 * ## Why `window.testHelpers` moved up here from `MapboxGlobe`
 *
 * Two vendor surfaces cannot both register and delete the same global without racing. Nine of the eleven
 * members are pure React/context reads with no vendor semantics at all and are copied verbatim from
 * `MapboxGlobe.tsx:275-320`; the two that carry real vendor state — `isMapReady` and `getMapState` — arrive
 * through the `onReadyChange` / `mapStateRef` hatches on `VendorSurfaceProps`. So the duplicated,
 * type-checked-against-nothing contract at `e2e/utils/test-helpers.ts:40-69` now has two members of surface
 * area instead of eleven, and `MapboxGlobe.tsx` got smaller rather than forked.
 *
 * The de-facto parts of that contract are preserved deliberately, and each one has a spec depending on it:
 * `selectDay` goes through `onCampSelect`, which **toggles** (`src/hooks/useTrekData.ts:171-173`) and which
 * `goToDay` (`e2e/utils/test-helpers.ts:245-258`) relies on; `getCurrentDay()` reads the last committed
 * render and therefore lags one round trip, which `expectDay` (`:228-235`) polls for; and `isDataLoaded()`
 * going true is a hard requirement of `waitForMapReady` (`:87-114`), which FAILS rather than skips.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapSurfaceProps } from '../lib/map/types';
import type { MapCameraState } from '../lib/map/vendorSurface';
import { EMPTY_CAMERA_STATE } from '../lib/map/vendorSurface';
import { useJourneys } from '../contexts/JourneysContext';
import { MapboxGlobe } from './MapboxGlobe';
import { MapKitJourneyMap } from './MapKitJourneyMap';

/**
 * Read at call time rather than pinned to a module-level const, unlike the version this replaced in
 * `MapboxGlobe.tsx`. Vite still statically substitutes `import.meta.env.*`, so the production bundle is
 * identical and the block still dead-code-eliminates — but `MapSurface.test.tsx` can now actually exercise
 * both branches instead of only whichever one the ambient env happened to give it, which is how the "does not
 * register outside E2E mode" assertion stops passing for the wrong reason.
 */
function isE2ETestMode(): boolean {
    return import.meta.env.VITE_E2E_TEST_MODE === 'true';
}

/** Which vendor to use. Unrecognised values fall back to Mapbox rather than to a blank map. */
function mapVendor(): 'mapbox' | 'mapkit' {
    return import.meta.env.VITE_MAP_VENDOR === 'mapkit' ? 'mapkit' : 'mapbox';
}

/**
 * A flattened projection of `TrekData` for E2E assertions, not `TrekData` itself.
 * Moved from `MapboxGlobe.tsx`; the shape is asserted against by `e2e/utils/test-helpers.ts`.
 */
interface TrekDataSummary {
    id: string;
    name: string;
    campCount: number;
    camps: Array<{
        id: string;
        name: string;
        dayNumber: number;
        elevation: number;
        coordinates: [number, number];
    }>;
}

/**
 * The eleven-member contract the whole e2e suite drives the app through.
 *
 * Declared TWICE by design and by accident: here (the producer) and independently by hand at
 * `e2e/utils/test-helpers.ts:40-69` (the consumer), because `e2e/` is outside the app tsconfig's
 * `include: ["src"]` so nothing type-checks the two against each other. **Change both or neither.**
 */
interface TestHelpers {
    selectTrek: (id: string) => boolean;
    getTreks: () => Array<{ id: string; name: string }>;
    getSelectedTrek: () => string | null;
    selectDay: (dayNumber: number) => boolean;
    getCurrentDay: () => number | null;
    getCamps: () => Array<{ id: string; name: string; dayNumber: number }>;
    getTrekDataKeys: () => string[];
    getTrekData: (id: string) => TrekDataSummary | null;
    isMapReady: () => boolean;
    isDataLoaded: () => boolean;
    getMapState: () => MapCameraState;
}

declare global {
    interface Window {
        testHelpers?: TestHelpers;
    }
}

export interface MapSurfaceComponentProps extends MapSurfaceProps {
    /** Threaded down so the MapKit adapter can lift Apple's attribution clear of the signed-out chips. */
    signedIn?: boolean;
}

export function MapSurface(props: MapSurfaceComponentProps) {
    const { selectedTrek, selectedCamp, onSelectTrek, view, onCampSelect, signedIn = false } = props;
    const { treks, trekDataMap, loading: journeysLoading } = useJourneys();

    const [mapReady, setMapReady] = useState(false);
    const mapStateRef = useRef<(() => MapCameraState) | null>(null);

    // A stable identity: the surfaces call this from an effect, and a new function every render would make
    // that effect re-run on every render.
    const handleReadyChange = useCallback((ready: boolean) => setMapReady(ready), []);

    const vendor = mapVendor();
    // MapKit has no globe, so the globe view stays on Mapbox regardless of the flag. See the header.
    const useMapKit = vendor === 'mapkit' && view === 'trek';

    useEffect(() => {
        if (!isE2ETestMode()) return;

        const currentCamps = selectedTrek ? trekDataMap[selectedTrek.id]?.camps || [] : [];

        const testHelpers: TestHelpers = {
            selectTrek: (id: string) => {
                const trek = treks.find(t => t.id === id);
                if (!trek) return false;
                onSelectTrek(trek);
                return true;
            },
            getTreks: () => treks.map(t => ({ id: t.id, name: t.name })),
            getSelectedTrek: () => selectedTrek?.id || null,
            selectDay: (dayNumber: number) => {
                if (!selectedTrek || !onCampSelect) return false;
                const camp = currentCamps.find(c => c.dayNumber === dayNumber);
                if (!camp) return false;
                // Toggles — see the header. `goToDay` depends on it.
                onCampSelect(camp);
                return true;
            },
            getCurrentDay: () => selectedCamp?.dayNumber || null,
            getCamps: () => currentCamps.map(c => ({ id: c.id, name: c.name, dayNumber: c.dayNumber })),
            getTrekDataKeys: () => Object.keys(trekDataMap),
            getTrekData: (id: string) => {
                const data = trekDataMap[id];
                if (!data) return null;
                return {
                    id: data.id,
                    name: data.name,
                    campCount: data.camps?.length || 0,
                    camps: data.camps?.map(c => ({
                        id: c.id,
                        name: c.name,
                        dayNumber: c.dayNumber,
                        elevation: c.elevation,
                        coordinates: c.coordinates,
                    })) || [],
                };
            },
            isMapReady: () => mapReady,
            isDataLoaded: () => !journeysLoading && treks.length > 0,
            getMapState: () => mapStateRef.current?.() ?? EMPTY_CAMERA_STATE,
        };

        window.testHelpers = testHelpers;
        return () => { delete window.testHelpers; };
    }, [mapReady, treks, selectedTrek, selectedCamp, trekDataMap, onSelectTrek, onCampSelect, journeysLoading]);

    if (useMapKit) {
        return (
            <MapKitJourneyMap
                {...props}
                signedIn={signedIn}
                onReadyChange={handleReadyChange}
                mapStateRef={mapStateRef}
            />
        );
    }

    return (
        <MapboxGlobe
            {...props}
            onReadyChange={handleReadyChange}
            mapStateRef={mapStateRef}
        />
    );
}
