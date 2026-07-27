import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MapCameraState } from '../lib/map/vendorSurface';

/**
 * `MapSurface` is the composition point MAP-03 introduced, and it owns two things worth a test:
 * which surface draws the map, and `window.testHelpers`.
 *
 * The second is the reason it exists at all. Two surfaces cannot both register and delete the same global
 * without racing, and the entire Playwright suite drives the app through that global — so a surface that
 * quietly fails to publish it, or publishes a state object of the wrong shape, breaks 18 specs at once with
 * an error that points at the spec rather than at the cause.
 *
 * MAP-05 narrowed the first job from "which of two vendors" to "globe or journey": Mapbox is deleted and
 * `VITE_MAP_VENDOR` with it. Two tests went with them — see `describe` below.
 */

// Both surface components are stubbed: this test is about the switch and the global, not about a map. Each
// stub records the props it got and fills the two hatches, so the wiring is observable.
const mapkitProps: Record<string, unknown>[] = [];
const globeProps: Record<string, unknown>[] = [];

/** `Array.prototype.at` is past this tsconfig's lib target, so index from the end by hand. */
const last = (all: Record<string, unknown>[]) => all[all.length - 1];

vi.mock('./MapKitJourneyMap', () => ({
    MapKitJourneyMap: (props: Record<string, unknown>) => {
        mapkitProps.push(props);
        return <div data-testid="stub-mapkit" />;
    },
}));

// MAP-02's tokenless globe. Stubbed for the same reason as the journey surface: this file tests the switch,
// not the drawing. The globe itself is covered by src/lib/globe/*.test.ts, which is where its arithmetic
// lives precisely so that it can be tested without a canvas.
vi.mock('./AkashicGlobe', () => ({
    AkashicGlobe: (props: Record<string, unknown>) => {
        globeProps.push(props);
        return <div data-testid="stub-akashic-globe" />;
    },
}));

const TREKS = [
    { id: 'e2e-alpine-loop', name: 'Alpine Loop', country: 'Norway', elevation: '2340 m', lat: 61.6, lng: 8.3, preferredBearing: 0, preferredPitch: 0, slug: 'alpine' },
];
const CAMPS = [
    { id: 'c1', name: 'Birch Grove', dayNumber: 1, elevation: 1140, coordinates: [8.34, 61.624] },
    { id: 'c2', name: 'Moraine', dayNumber: 2, elevation: 1420, coordinates: [8.4, 61.66] },
];

vi.mock('../contexts/JourneysContext', () => ({
    useJourneys: () => ({
        treks: TREKS,
        trekDataMap: { 'e2e-alpine-loop': { id: 'e2e-alpine-loop', name: 'Alpine Loop', camps: CAMPS } },
        loading: false,
        error: null,
        refetch: vi.fn(),
    }),
}));

const { MapSurface } = await import('./MapSurface');

function baseProps(overrides: Record<string, unknown> = {}) {
    return {
        selectedTrek: TREKS[0],
        selectedCamp: null,
        onSelectTrek: vi.fn(),
        view: 'trek' as const,
        onCampSelect: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    mapkitProps.length = 0;
    globeProps.length = 0;
    vi.stubEnv('VITE_E2E_TEST_MODE', 'true');
});

afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    delete window.testHelpers;
});

describe('MapSurface surface selection (MAP-03, narrowed by MAP-05)', () => {
    /**
     * The retarget of the two tests MAP-05 deleted — "defaults to Mapbox" and "falls back to Mapbox for an
     * unrecognised vendor". Both asserted the behaviour of a flag that no longer exists, so neither could be
     * salvaged as written; what they were really protecting was "the journey view always renders SOME map
     * surface, never nothing". That survives here, and it is now unconditional.
     */
    it('draws the journey view with MapKit, with no flag able to route it elsewhere', () => {
        const { getByTestId } = render(<MapSurface {...baseProps({ view: 'trek' })} />);
        expect(getByTestId('stub-mapkit')).toBeInTheDocument();
    });

    /**
     * MAP-02 changed this, and it is the assertion that would catch it being changed back.
     *
     * The landing globe used to be Mapbox under every configuration. It is now ours — a 2D canvas over
     * vendored public-domain coastline geometry, with no token and no tile service, so that the first screen
     * survives a vendor outage.
     *
     * MAP-05 deleted `VITE_MAP_VENDOR`, so the values below are junk rather than a flag matrix — and that is
     * exactly why the parameterisation is kept. `.env` and `.env.local` are gitignored, long-lived and
     * copied between worktrees by hand, so a developer's checkout will carry `VITE_MAP_VENDOR=mapbox` for a
     * long time yet. This asserts a stale value cannot reroute either surface.
     */
    it.each(['', 'mapbox', 'mapkit', 'googlemaps'])(
        'draws the GLOBE with our own tokenless surface, ignoring a stale VITE_MAP_VENDOR=%s',
        vendor => {
            vi.stubEnv('VITE_MAP_VENDOR', vendor);
            const { getByTestId, queryByTestId } = render(<MapSurface {...baseProps({ view: 'globe' })} />);
            expect(getByTestId('stub-akashic-globe')).toBeInTheDocument();
            expect(queryByTestId('stub-mapkit')).toBeNull();
        },
    );

    it.each(['', 'mapbox', 'googlemaps'])(
        'draws the JOURNEY view with MapKit, ignoring a stale VITE_MAP_VENDOR=%s',
        vendor => {
            vi.stubEnv('VITE_MAP_VENDOR', vendor);
            const { getByTestId, queryByTestId } = render(<MapSurface {...baseProps({ view: 'trek' })} />);
            expect(getByTestId('stub-mapkit')).toBeInTheDocument();
            expect(queryByTestId('stub-akashic-globe')).toBeNull();
        },
    );

    it('fills the globe surface\'s two vendor-state hatches, so isMapReady and getMapState work', () => {
        // openApp() hard-fails after 15 s if isMapReady() never goes true, and it is the entry point of
        // every spec file — so the globe not receiving onReadyChange would red-line the whole suite.
        render(<MapSurface {...baseProps({ view: 'globe' })} />);
        expect(last(globeProps)).toHaveProperty('onReadyChange');
        expect(last(globeProps)).toHaveProperty('mapStateRef');
    });

    it('threads signedIn down to the MapKit surface, which needs it for Apple\'s attribution lift', () => {
        render(<MapSurface {...baseProps({ signedIn: false })} />);
        expect(last(mapkitProps)).toMatchObject({ signedIn: false });
        expect(last(mapkitProps)).toHaveProperty('mapStateRef');
        expect(last(mapkitProps)).toHaveProperty('onReadyChange');
    });
});

describe('MapSurface owns window.testHelpers (MAP-03)', () => {
    it('registers only in E2E test mode', () => {
        vi.stubEnv('VITE_E2E_TEST_MODE', 'false');
        render(<MapSurface {...baseProps()} />);
        expect(window.testHelpers).toBeUndefined();
    });

    it('publishes all eleven members', () => {
        render(<MapSurface {...baseProps()} />);
        // The contract is duplicated by hand at e2e/utils/test-helpers.ts:40-69 and nothing type-checks the
        // two against each other, so assert the surface area explicitly.
        expect(Object.keys(window.testHelpers!).sort()).toEqual([
            'getCamps', 'getCurrentDay', 'getMapState', 'getSelectedTrek', 'getTrekData', 'getTrekDataKeys',
            'getTreks', 'isDataLoaded', 'isMapReady', 'selectDay', 'selectTrek',
        ]);
    });

    it('deletes them on unmount, so a remount cannot leave a stale closure on window', () => {
        const { unmount } = render(<MapSurface {...baseProps()} />);
        expect(window.testHelpers).toBeDefined();
        unmount();
        expect(window.testHelpers).toBeUndefined();
    });

    it('returns the all-nulls camera state when no surface has filled the ref', () => {
        // waitForCameraSettled reads cameraCenter and hasPendingAnimations. If this threw or returned
        // undefined instead, every spec would fail in the helper rather than at the assertion.
        render(<MapSurface {...baseProps()} />);
        const state: MapCameraState = window.testHelpers!.getMapState();
        expect(state).toEqual({
            cameraCenter: null,
            cameraZoom: null,
            cameraBearing: null,
            pendingHighlightCampId: null,
            hasPendingAnimations: false,
        });
    });

    it('reports the camera state the mounted surface publishes', () => {
        const surfaceState: MapCameraState = {
            cameraCenter: [8.3, 61.6],
            cameraZoom: 15,
            cameraBearing: 0,
            pendingHighlightCampId: 'c2',
            hasPendingAnimations: true,
        };
        // baseProps() is view: 'trek', so the mounted surface is MapKit. Before MAP-05 this read
        // `mapboxProps` — the default vendor — and the eight testHelpers tests below silently changed which
        // surface they mount when Mapbox was deleted, which is why this one had to be retargeted by hand.
        render(<MapSurface {...baseProps()} />);
        const ref = last(mapkitProps).mapStateRef as { current: (() => MapCameraState) | null };
        ref.current = () => surfaceState;
        expect(window.testHelpers!.getMapState()).toEqual(surfaceState);
    });

    it('reads readiness from the surface rather than guessing', () => {
        render(<MapSurface {...baseProps()} />);
        expect(window.testHelpers!.isMapReady()).toBe(false);
    });

    it('selectDay goes through onCampSelect, which TOGGLES — goToDay depends on that', () => {
        const onCampSelect = vi.fn();
        render(<MapSurface {...baseProps({ onCampSelect })} />);
        expect(window.testHelpers!.selectDay(2)).toBe(true);
        expect(onCampSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2' }));
        expect(window.testHelpers!.selectDay(99)).toBe(false);
    });

    it('selectTrek reports whether the id existed', () => {
        const onSelectTrek = vi.fn();
        render(<MapSurface {...baseProps({ onSelectTrek })} />);
        expect(window.testHelpers!.selectTrek('e2e-alpine-loop')).toBe(true);
        expect(window.testHelpers!.selectTrek('nope')).toBe(false);
        expect(onSelectTrek).toHaveBeenCalledTimes(1);
    });

    it('flattens trek data the way the specs read it', () => {
        render(<MapSurface {...baseProps()} />);
        expect(window.testHelpers!.getTrekData('e2e-alpine-loop')).toMatchObject({
            id: 'e2e-alpine-loop', campCount: 2,
        });
        expect(window.testHelpers!.getTrekData('nope')).toBeNull();
        expect(window.testHelpers!.getCamps()).toHaveLength(2);
        expect(window.testHelpers!.isDataLoaded()).toBe(true);
    });
});
