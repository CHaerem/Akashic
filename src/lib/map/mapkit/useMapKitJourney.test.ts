/**
 * QUA-50 — the regression test for "the map is built once and never on a prop change".
 *
 * ## The defect this exists to prevent the return of
 *
 * In MAP-03, `chromeState` was a `useCallback` with `[signedIn, selectedTrek]` as its dependencies. That made
 * it change identity on every journey selection and every sign-in, which made `syncPhotos` change with it,
 * which re-ran the INIT effect in `./useMapKitJourney.ts` — and that effect's cleanup calls `map.destroy()`.
 * So selecting a journey tore the whole MapKit map down and built a new one. Measured cost: a full teardown
 * plus a satellite-tile reload and a fresh `map-node-ready` wait, 915–1101 ms, every time.
 *
 * **It self-heals, and that is the entire reason no existing assertion catches it.** The rebuilt map re-adds
 * all five route overlays and every marker, `ready` comes back true, the camera re-frames, and both the
 * vitest suite and `e2e/mapkit-journey.spec.ts` stay green. There is no error, no console warning and no
 * missing DOM to assert the absence of. The only observable that distinguishes "kept" from "destroyed and
 * silently rebuilt" is HOW MANY TIMES the constructor ran — so that is what this file counts.
 *
 * MEASURED here, with the unstable dependency put back in `chromeState`: across two journey selections the
 * counts go `{built 1, destroyed 0} → {2, 1} → {3, 2}`, and a bare `signedIn` flip goes `{1, 0} → {2, 1}`.
 * Measured in the same run: at that third step the NEWEST map already carries all five route overlays and its
 * annotations, and `ready` is back to `true` — so every softer assertion available passes while the map has
 * been thrown away twice. That is the evidence for counting rather than checking for damage.
 *
 * ## Two jsdom facts this file is shaped around
 *
 * - **jsdom has no `DOMPoint`** — zero occurrences in `jsdom/lib/jsdom/living/interfaces.js`. The adapter
 *   constructs one for every annotation's `anchorOffset` (`./annotations.ts`), so without the shim below the
 *   camps effect throws and the test fails for a reason that has nothing to do with the defect.
 * - **jsdom reports `clientWidth`/`clientHeight` 0**, and the hook treats a zero-sized container as "not
 *   measurable yet" and skips marker sync and framing entirely. The container therefore has its box faked, so
 *   the test drives the same code path a real viewport does.
 *
 * The fake namespace is deliberately only as wide as what the adapter calls — the same rule
 * `./mapkitTypes.ts` follows, and for the same reason: a wider fake is a list of things we believe rather than
 * things this code does.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { resetMapKitLoaderForTests } from './loader';
import { useMapKitJourney, type UseMapKitJourneyOptions } from './useMapKitJourney';
import type { MapKitNamespace } from './mapkitTypes';
import type { Camp, Photo, TrekConfig, TrekData } from '../../../types/trek';

/* ------------------------------------------------------------------ the fake mapkit namespace */

interface FakeCoordinateLike {
    latitude: number;
    longitude: number;
}

interface FakeRegion {
    center: FakeCoordinateLike;
    span: { latitudeDelta: number; longitudeDelta: number };
}

/** What the tests assert on. `constructions.length` is the whole point of this file. */
interface MapKitProbe {
    constructions: FakeMap[];
    destroys: number;
}

class FakeCoordinate implements FakeCoordinateLike {
    constructor(public latitude: number, public longitude: number) {}
    copy(): FakeCoordinate {
        return new FakeCoordinate(this.latitude, this.longitude);
    }
}

/** Somewhere on the fixture journeys' own latitude, so nothing here is near a coordinate-order coincidence. */
const START = { latitude: 61.6, longitude: 8.3 };

class FakeMap {
    padding = { top: 0, right: 0, bottom: 0, left: 0 };
    center: FakeCoordinateLike = new FakeCoordinate(START.latitude, START.longitude);
    region: FakeRegion = {
        center: new FakeCoordinate(START.latitude, START.longitude),
        span: { latitudeDelta: 0.02, longitudeDelta: 0.02 },
    };
    rotation = 0;
    overlays: unknown[] = [];
    annotations: unknown[] = [];
    destroyed = false;

    private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

    constructor(readonly element: HTMLElement, private readonly probe: MapKitProbe) {
        probe.constructions.push(this);
    }

    addEventListener(name: string, handler: (event: unknown) => void): void {
        const set = this.listeners.get(name) ?? new Set<(event: unknown) => void>();
        set.add(handler);
        this.listeners.set(name, set);
        // The real map dispatches `map-node-ready` 915–1101 ms after construction (measured; see
        // `./events.ts`). Firing it on the next macrotask is the same ordering: asynchronous, and after the
        // effect that subscribed has returned.
        if (name === 'map-node-ready') {
            setTimeout(() => { if (!this.destroyed) handler({}); }, 0);
        }
    }

    removeEventListener(name: string, handler: (event: unknown) => void): void {
        this.listeners.get(name)?.delete(handler);
    }

    setRegionAnimated(region: FakeRegion): void {
        this.region = region;
    }

    addOverlay(overlay: unknown): void {
        this.overlays.push(overlay);
    }

    removeOverlay(overlay: unknown): void {
        const index = this.overlays.indexOf(overlay);
        if (index >= 0) this.overlays.splice(index, 1);
    }

    addAnnotation(annotation: unknown): void {
        this.annotations.push(annotation);
    }

    removeAnnotation(annotation: unknown): void {
        const index = this.annotations.indexOf(annotation);
        if (index >= 0) this.annotations.splice(index, 1);
    }

    /** A linear stand-in for the projection. Only finiteness matters to the hook's viewport emit. */
    convertCoordinateToPointOnPage(coordinate: FakeCoordinateLike): DOMPoint {
        return new DOMPoint(
            (coordinate.longitude - START.longitude) * 10_000,
            (START.latitude - coordinate.latitude) * 10_000,
        );
    }

    convertPointOnPageToCoordinate(point: DOMPoint): FakeCoordinate {
        return new FakeCoordinate(START.latitude - point.y / 10_000, START.longitude + point.x / 10_000);
    }

    destroy(): void {
        this.destroyed = true;
        this.probe.destroys++;
    }
}

/**
 * Put a counting `window.mapkit` in place.
 *
 * `configuration-change` is dispatched once, asynchronously, and only to listeners registered before
 * `init` — the ordering trap `./loader.ts` documents and `./loader.test.ts` asserts on. Reproduced here so
 * this test exercises the real loader rather than a mocked one.
 */
function installFakeMapKit(): MapKitProbe {
    const probe: MapKitProbe = { constructions: [], destroys: 0 };
    const configListeners: Array<(event: { status: string }) => void> = [];
    let initialised = false;

    class NamespaceMap extends FakeMap {
        static MapTypes = { Satellite: 'satellite', Hybrid: 'hybrid', Standard: 'standard', MutedStandard: 'muted' };
        static ColorSchemes = { Dark: 'dark', Light: 'light', Adaptive: 'adaptive' };
        constructor(element: HTMLElement, _options?: unknown) {
            super(element, probe);
        }
    }

    const namespace = {
        version: '5.81.65',
        build: 'test',
        maps: [],
        init: () => {
            initialised = true;
            queueMicrotask(() => configListeners.forEach(h => h({ status: 'Initialized' })));
        },
        addEventListener: (_name: string, handler: (event: { status: string }) => void) => {
            if (!initialised) configListeners.push(handler);
        },
        Map: NamespaceMap,
        Coordinate: FakeCoordinate,
        CoordinateSpan: class {
            constructor(public latitudeDelta: number, public longitudeDelta: number) {}
        },
        CoordinateRegion: class {
            constructor(
                public center: FakeCoordinateLike,
                public span: { latitudeDelta: number; longitudeDelta: number },
            ) {}
        },
        Padding: class {
            top: number; right: number; bottom: number; left: number;
            constructor(options: { top?: number; right?: number; bottom?: number; left?: number }) {
                this.top = options.top ?? 0;
                this.right = options.right ?? 0;
                this.bottom = options.bottom ?? 0;
                this.left = options.left ?? 0;
            }
        },
        Style: class {
            strokeStart = 0;
            strokeEnd = 0;
            constructor(options: Record<string, unknown>) {
                Object.assign(this, options);
            }
        },
        PolylineOverlay: class {
            style: unknown;
            constructor(public points: unknown[], options: { style: unknown }) {
                this.style = options.style;
            }
        },
        Annotation: class {
            static CollisionMode = { Rectangle: 'rect', Circle: 'circle', None: 'none' };
            static DisplayPriority = { Low: 250, High: 750, Required: 1000 };
            draggable = false;
            constructor(
                public coordinate: FakeCoordinateLike,
                public factory: unknown,
                public options?: unknown,
            ) {}
            addEventListener(): void {}
        },
        FeatureVisibility: { Adaptive: 'adaptive', Hidden: 'hidden', Visible: 'visible' },
    };

    window.mapkit = namespace as unknown as MapKitNamespace;
    return probe;
}

/* ------------------------------------------------------------------ fixtures */

function makeTrekConfig(id: string): TrekConfig {
    return {
        id, name: id, country: 'Norway', elevation: '1500 m',
        lat: START.latitude, lng: START.longitude,
        preferredBearing: 0, preferredPitch: 0, slug: id,
    };
}

function makeCamp(id: string, dayNumber: number, coordinates: [number, number]): Camp {
    return {
        id, name: `Camp ${dayNumber}`, dayNumber, elevation: 1200, coordinates,
        elevationGainFromPrevious: 100, elevationLossFromPrevious: 0, dayDistance: 8, notes: '',
    };
}

function makeTrekData(id: string, offset: number): TrekData {
    return {
        id, uuid: `${id}-uuid`, name: id, country: 'Norway', description: '',
        stats: {
            duration: 2, totalDistance: 16, totalElevationGain: 200,
            highestPoint: { name: 'Top', elevation: 1400 },
        },
        camps: [
            makeCamp(`${id}-c1`, 1, [START.longitude + offset, START.latitude]),
            makeCamp(`${id}-c2`, 2, [START.longitude + offset + 0.02, START.latitude + 0.01]),
        ],
        route: {
            type: 'LineString',
            coordinates: [
                [START.longitude + offset, START.latitude, 1000],
                [START.longitude + offset + 0.01, START.latitude + 0.005, 1100],
                [START.longitude + offset + 0.02, START.latitude + 0.01, 1200],
            ],
        },
    };
}

function makePhoto(id: string, coordinates: [number, number]): Photo {
    return { id, journey_id: 'j', url: `https://example.test/${id}.jpg`, coordinates };
}

/**
 * A container with a real box. jsdom gives every element `clientWidth`/`clientHeight` 0, and the hook reads
 * that as "not measurable yet" and skips both marker sync and framing — so without this the test would drive
 * a code path the browser never takes.
 */
function makeContainer(): HTMLDivElement {
    const element = document.createElement('div');
    Object.defineProperty(element, 'clientWidth', { value: 1280 });
    Object.defineProperty(element, 'clientHeight', { value: 720 });
    element.getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720, x: 0, y: 0 }) as DOMRect;
    document.body.appendChild(element);
    return element;
}

/** Let the loader's microtasks, the map construction and the `map-node-ready` macrotask all land. */
async function settle(): Promise<void> {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}

/**
 * The counts after one step, recorded rather than asserted step by step.
 *
 * Asserting inside the loop stops at the first bad step and hides the shape of the failure; asserting the
 * whole timeline at the end prints `1 → 2 → 3` against `1 → 1 → 1`, which names the defect on sight.
 */
function tally(probe: MapKitProbe): { built: number; destroyed: number } {
    return { built: probe.constructions.length, destroyed: probe.destroys };
}

/* ------------------------------------------------------------------ tests */

const originalDOMPoint = (globalThis as { DOMPoint?: unknown }).DOMPoint;

beforeEach(() => {
    resetMapKitLoaderForTests();
    // jsdom implements no DOMPoint; `./annotations.ts` constructs one per annotation. See the header.
    if (originalDOMPoint === undefined) {
        (globalThis as { DOMPoint?: unknown }).DOMPoint = class {
            constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
        };
    }
    vi.stubEnv('VITE_MAPKIT_TOKEN', 'test-token');
});

afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as { mapkit?: unknown }).mapkit;
    document.body.innerHTML = '';
    // Leave the environment as it was found: a shim left on globalThis would make a later test's own
    // "does this environment have DOMPoint" question answer wrongly.
    if (originalDOMPoint === undefined) delete (globalThis as { DOMPoint?: unknown }).DOMPoint;
});

describe('useMapKitJourney — the map is built once (QUA-50)', () => {
    it('has a working DOMPoint and a measurable container, or every test below is vacuous', () => {
        // The fake map and the annotation code both need these. If either is missing the hook bails out
        // early and the construction counts below would be trivially satisfied by doing nothing at all.
        expect(new DOMPoint(1, 2).y).toBe(2);
        expect(makeContainer().clientWidth).toBe(1280);
    });

    it('keeps ONE map across two journey selections, and self-heals so nothing else could tell', async () => {
        const probe = installFakeMapKit();
        const container = makeContainer();
        const containerRef = { current: container };
        const base: UseMapKitJourneyOptions = {
            containerRef, selectedTrek: null, selectedCamp: null, trekData: null,
            photos: [], signedIn: false, editMode: false,
        };

        const { result, rerender, unmount } = renderHook(
            (props: UseMapKitJourneyOptions) => useMapKitJourney(props),
            { initialProps: base },
        );
        await settle();

        const timeline = [tally(probe)];
        const map = probe.constructions[0];
        expect(result.current.ready).toBe(true);

        // Selection 1. With `chromeState` depending on [signedIn, selectedTrek] this is where the second
        // construction appeared.
        rerender({
            ...base,
            selectedTrek: makeTrekConfig('trek-a'),
            trekData: makeTrekData('trek-a', 0),
            photos: [makePhoto('p1', [START.longitude + 0.005, START.latitude + 0.002])],
        });
        await settle();
        timeline.push(tally(probe));

        // Selection 2.
        rerender({
            ...base,
            selectedTrek: makeTrekConfig('trek-b'),
            trekData: makeTrekData('trek-b', 0.5),
            photos: [makePhoto('p2', [START.longitude + 0.505, START.latitude + 0.002])],
        });
        await settle();
        timeline.push(tally(probe));

        // MEASURED with the defect reintroduced: [{1,0}, {2,1}, {3,2}].
        expect(timeline).toEqual([
            { built: 1, destroyed: 0 },
            { built: 1, destroyed: 0 },
            { built: 1, destroyed: 0 },
        ]);

        // Same instance the whole way through, and it is the one carrying the journey's overlays: this is
        // what the destroyed-and-rebuilt case ALSO looks like once it has healed, which is why the counts
        // above are the assertion and this is only corroboration.
        expect(probe.constructions[0]).toBe(map);
        expect(map.destroyed).toBe(false);
        // Two base strokes plus the three-stroke active halo — `./overlays.ts`.
        expect(map.overlays).toHaveLength(5);
        expect(map.annotations.length).toBeGreaterThan(0);
        expect(result.current.ready).toBe(true);

        // Proof the counters are live: only teardown may destroy the map.
        unmount();
        expect(probe.destroys).toBe(1);
        expect(probe.constructions).toHaveLength(1);
    });

    it('keeps ONE map across a bare signedIn flip', async () => {
        const probe = installFakeMapKit();
        const containerRef = { current: makeContainer() };
        const trek = makeTrekConfig('trek-a');
        const trekData = makeTrekData('trek-a', 0);
        const base: UseMapKitJourneyOptions = {
            containerRef, selectedTrek: trek, selectedCamp: null, trekData,
            photos: [makePhoto('p1', [START.longitude + 0.005, START.latitude + 0.002])],
            signedIn: false, editMode: false,
        };

        const { rerender, unmount } = renderHook(
            (props: UseMapKitJourneyOptions) => useMapKitJourney(props),
            { initialProps: base },
        );
        await settle();
        const timeline = [tally(probe)];

        // Nothing else changes: signing in must not cost a map.
        rerender({ ...base, signedIn: true });
        await settle();
        timeline.push(tally(probe));

        // MEASURED with the defect reintroduced: [{1,0}, {2,1}].
        expect(timeline).toEqual([{ built: 1, destroyed: 0 }, { built: 1, destroyed: 0 }]);

        // But the attribution lift MUST still react to it — that effect names `signedIn` explicitly precisely
        // because `chromeState` is now stable, and dropping the dep is the plausible wrong fix for this test.
        // Signed in, no mobile viewport: the 80 px showcase chip band is gone and only the desktop panel
        // band remains on the left. See `./chrome.ts`.
        expect(probe.constructions[0].padding.bottom).toBe(0);
        expect(probe.constructions[0].padding.left).toBeGreaterThan(0);

        unmount();
        expect(probe.destroys).toBe(1);
    });

    /**
     * Honest about what this one is: it does NOT go red on the original defect, because `selectedCamp` was
     * never one of the unstable dependencies. It guards the neighbouring path — the highest-frequency
     * interaction in the app, and the one where the next accidental dependency would hurt most — and it is
     * here so the invariant is stated for it rather than inferred.
     */
    it('keeps ONE map when only the selected day changes', async () => {
        const probe = installFakeMapKit();
        const containerRef = { current: makeContainer() };
        const trekData = makeTrekData('trek-a', 0);
        const base: UseMapKitJourneyOptions = {
            containerRef, selectedTrek: makeTrekConfig('trek-a'), selectedCamp: null, trekData,
            photos: [makePhoto('p1', [START.longitude + 0.005, START.latitude + 0.002])],
            signedIn: true, editMode: false,
        };

        const { rerender, unmount } = renderHook(
            (props: UseMapKitJourneyOptions) => useMapKitJourney(props),
            { initialProps: base },
        );
        await settle();
        expect(probe.constructions).toHaveLength(1);

        for (const camp of trekData.camps) {
            rerender({ ...base, selectedCamp: camp });
            await settle();
        }

        expect(probe.constructions).toHaveLength(1);
        expect(probe.destroys).toBe(0);

        unmount();
        expect(probe.destroys).toBe(1);
    });
});
