import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MapCameraState } from '../lib/map/vendorSurface';

/**
 * `MapSurface` is the composition point MAP-03 introduced, and it owns two things worth a test:
 * which vendor draws the map, and `window.testHelpers`.
 *
 * The second is the reason it exists at all. Two vendor surfaces cannot both register and delete the same
 * global without racing, and the entire Playwright suite drives the app through that global — so a surface
 * that quietly fails to publish it, or publishes a state object of the wrong shape, breaks 18 specs at once
 * with an error that points at the spec rather than at the cause.
 */

// Both vendor components are stubbed: this test is about the switch and the global, not about a map. Each
// stub records the props it got and fills the two hatches, so the wiring is observable.
const mapboxProps: Record<string, unknown>[] = [];
const mapkitProps: Record<string, unknown>[] = [];

/** `Array.prototype.at` is past this tsconfig's lib target, so index from the end by hand. */
const last = (all: Record<string, unknown>[]) => all[all.length - 1];

vi.mock('./MapboxGlobe', () => ({
    MapboxGlobe: (props: Record<string, unknown>) => {
        mapboxProps.push(props);
        return <div data-testid="stub-mapbox" />;
    },
}));

vi.mock('./MapKitJourneyMap', () => ({
    MapKitJourneyMap: (props: Record<string, unknown>) => {
        mapkitProps.push(props);
        return <div data-testid="stub-mapkit" />;
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
    mapboxProps.length = 0;
    mapkitProps.length = 0;
    vi.stubEnv('VITE_E2E_TEST_MODE', 'true');
    vi.stubEnv('VITE_MAP_VENDOR', '');
});

afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    delete window.testHelpers;
});

describe('MapSurface vendor selection (MAP-03)', () => {
    it('defaults to Mapbox, so MAP-03 changes nothing until the flag is set', () => {
        // The default matters more than it looks: flipping it also makes e2e/fixtures/test.ts's pinned host
        // list, vite.config.js's api.mapbox.com Workbox rules and public/privacy.html false at once.
        const { getByTestId } = render(<MapSurface {...baseProps()} />);
        expect(getByTestId('stub-mapbox')).toBeInTheDocument();
    });

    it('uses MapKit for the journey view when VITE_MAP_VENDOR=mapkit', () => {
        vi.stubEnv('VITE_MAP_VENDOR', 'mapkit');
        const { getByTestId } = render(<MapSurface {...baseProps({ view: 'trek' })} />);
        expect(getByTestId('stub-mapkit')).toBeInTheDocument();
    });

    it('keeps the GLOBE on Mapbox even with the flag set, because MapKit has no globe', () => {
        // Zero occurrences of `globe` or `orthographic` in the shipped MapKit bundle. Pointing MAP-03 at the
        // globe would replace the app's signature rotating 3D globe with a flat satellite world map.
        vi.stubEnv('VITE_MAP_VENDOR', 'mapkit');
        const { getByTestId } = render(<MapSurface {...baseProps({ view: 'globe' })} />);
        expect(getByTestId('stub-mapbox')).toBeInTheDocument();
    });

    it('falls back to Mapbox for an unrecognised vendor rather than rendering nothing', () => {
        vi.stubEnv('VITE_MAP_VENDOR', 'googlemaps');
        const { getByTestId } = render(<MapSurface {...baseProps()} />);
        expect(getByTestId('stub-mapbox')).toBeInTheDocument();
    });

    it('threads signedIn down to the MapKit surface, which needs it for Apple\'s attribution lift', () => {
        vi.stubEnv('VITE_MAP_VENDOR', 'mapkit');
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
        render(<MapSurface {...baseProps()} />);
        const ref = last(mapboxProps).mapStateRef as { current: (() => MapCameraState) | null };
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
