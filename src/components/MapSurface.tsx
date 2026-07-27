/**
 * Picks which vendor draws the map, and owns `window.testHelpers`. (MAP-03)
 *
 * Names **no** map SDK — that is why it is not in `src/lib/map/boundary.test.ts`'s adapter allowlist. It
 * composes vendor components; it does not talk to a vendor.
 *
 * ## How the app chooses between the surfaces
 *
 * **MAP-02 changed this.** The landing globe is now `AkashicGlobe` — ours, drawn in a 2D canvas from
 * vendored public-domain coastline geometry — and it is used for `view === 'globe'` under **both**
 * `VITE_MAP_VENDOR` values. Only the journey view is still vendor-dependent:
 *
 * - **`VITE_MAP_VENDOR` is unset or `mapbox` — the DEFAULT.** `AkashicGlobe` draws the globe; Mapbox draws
 *   the journey view.
 * - **`VITE_MAP_VENDOR=mapkit`.** `AkashicGlobe` draws the globe; MapKit draws the journey view. MapKit JS
 *   has no globe at all — zero occurrences of `globe`, `orthographic`, `pitch` or `tilt` in the shipped
 *   bundle — which is why the landing view was never a candidate for it.
 *
 * The globe is not hidden behind a third flag value, and that is a deliberate call rather than an
 * oversight. A flag the e2e gate never exercises means the screenshots stay Mapbox and the feature ships
 * unverified; and MAP-02's `done_when` ("the landing view IS a rotating sphere using no map service and no
 * token") is not satisfied by a surface nobody sees. It needs no token under either value, and MAP-05
 * deletes Mapbox regardless. **This is a visible product change to the first screen a paying customer
 * sees** — photographic satellite Earth becomes stylised vector Earth — and it is called out in
 * `AkashicGlobe.tsx` and in `src/lib/globe/render.ts` for the owner rather than left to a diff.
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
import { AkashicGlobe } from './AkashicGlobe';
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
    // MAP-02: the landing globe is ours under both vendor values. Only the journey view varies.
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

    // MAP-02: the landing view. Checked before the vendor branch because it is vendor-independent — there
    // is no configuration under which a vendor draws the globe any more.
    if (view === 'globe') {
        return (
            <AkashicGlobe
                {...props}
                onReadyChange={handleReadyChange}
                mapStateRef={mapStateRef}
            />
        );
    }

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
