/**
 * Picks which surface draws the map, and owns `window.testHelpers`. (MAP-03, narrowed by MAP-05)
 *
 * Names **no** map SDK — that is why it is not in `src/lib/map/boundary.test.ts`'s adapter allowlist. It
 * composes surface components; it does not talk to a vendor.
 *
 * ## How the app chooses between the surfaces
 *
 * There is no vendor flag any more. MAP-05 deleted Mapbox, and with one journey surface left a
 * `VITE_MAP_VENDOR` with a single legal value would advertise a fallback that does not exist. The choice
 * that remains is by VIEW, not by vendor:
 *
 * - **`view === 'globe'`** — `AkashicGlobe`, ours: a 2D canvas over vendored public-domain coastline
 *   geometry, no token and no tile service, so the first screen survives any vendor lapsing. (MAP-02.)
 * - **anything else** — `MapKitJourneyMap`. MapKit JS has no globe at all (zero occurrences of `globe`,
 *   `orthographic`, `pitch` or `tilt` in the shipped bundle), which is why the landing view was never a
 *   candidate for it and why we draw that one ourselves.
 *
 * **MapKit needs a token and the globe does not**, which is the asymmetry to keep in mind: with
 * `VITE_MAPKIT_TOKEN` unset the landing screen is perfect and the journey view is `MapErrorFallback`
 * (`src/lib/map/mapkit/useMapKitJourney.ts:111`). That is now the only tokenless-degradation path in the
 * web app — MAP-05 removed the surface that used to cover for it.
 *
 * ## Why `window.testHelpers` lives here rather than in a surface component
 *
 * Two surfaces cannot both register and delete the same global without racing, and that is still true of
 * `AkashicGlobe` and `MapKitJourneyMap`. Nine of the eleven members are pure React/context reads with no
 * vendor semantics at all; the two that carry real surface state — `isMapReady` and `getMapState` — arrive
 * through the `onReadyChange` / `mapStateRef` hatches on `VendorSurfaceProps`. So the duplicated,
 * type-checked-against-nothing contract at `e2e/utils/test-helpers.ts:40-69` has two members of surface
 * area instead of eleven.
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
import { MapKitJourneyMap } from './MapKitJourneyMap';

/**
 * Read at call time rather than pinned to a module-level const. Vite still statically substitutes
 * `import.meta.env.*`, so the production bundle is identical and the block still dead-code-eliminates — but
 * `MapSurface.test.tsx` can actually exercise both branches instead of only whichever one the ambient env
 * happened to give it, which is how the "does not register outside E2E mode" assertion stops passing for
 * the wrong reason.
 */
function isE2ETestMode(): boolean {
    return import.meta.env.VITE_E2E_TEST_MODE === 'true';
}

/**
 * A flattened projection of `TrekData` for E2E assertions, not `TrekData` itself.
 * The shape is asserted against by `e2e/utils/test-helpers.ts`.
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

    // MAP-02: the landing view, ours and tokenless. Checked first because it is the one surface that
    // cannot fail on a lapsed credential.
    if (view === 'globe') {
        return (
            <AkashicGlobe
                {...props}
                onReadyChange={handleReadyChange}
                mapStateRef={mapStateRef}
            />
        );
    }

    // Everything else is the journey view. MAP-05: no vendor branch — Mapbox is gone, so this is not a
    // fallback for an unrecognised flag value, it is the only journey surface there is.
    return (
        <MapKitJourneyMap
            {...props}
            signedIn={signedIn}
            onReadyChange={handleReadyChange}
            mapStateRef={mapStateRef}
        />
    );
}
