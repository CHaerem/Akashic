import { describe, it, expect, beforeAll } from 'vitest';
import { syncCampAnnotations, syncPhotoAnnotations, type CampAnnotationEntry, type PhotoAnnotationEntry }
    from './annotations';
import type { MapKitNamespace, MKAnnotation, MKCoordinate, MKMap } from './mapkitTypes';
import type { Camp, Photo } from '../../../types/trek';
import type { LngLat } from '../types';
import type { PhotoGroup } from './geometry';

/**
 * What a marker DISPATCHES, which is not the same question as what it looks like. (QUA-51)
 *
 * The defect this file was written for: the camp click handler closed over the `Camp` object the element was
 * created with, while `syncCampAnnotations` dutifully wrote a fresh `entry.camp` on every diff that nothing
 * read. So the write looked like the fix and was not one, and a camp whose data changed — a drag in edit
 * mode, a CloudKit sync landing a corrected coordinate — dispatched the version from map-init.
 *
 * That object is not cosmetic. `useTrekData.ts:171-173` does `setSelectedCamp(camp)` with exactly what it is
 * handed, and `useMapKitJourney`'s off-route branch frames `regionForZoom(selectedCamp.coordinates, …)` —
 * so the camera flies to where the camp used to be, the sidebar shows the old elevation, and nothing throws.
 *
 * MEASURED while writing this: **jsdom has no `DOMPoint`** (`typeof DOMPoint === 'undefined'`, vitest 3 on
 * jsdom 26). `centringAnchorOffset` constructs one, so every annotation built here needs the shim below —
 * which is also why the rest of the adapter's unit tests stop at the pure modules.
 */
class DOMPointShim {
    constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
}

beforeAll(() => {
    if (typeof globalThis.DOMPoint === 'undefined') {
        (globalThis as { DOMPoint?: unknown }).DOMPoint = DOMPointShim;
    }
});

/* ------------------------------------------------------------------ fakes */

/**
 * Page pixels per degree in the fake projection below, in BOTH axes.
 *
 * 0.001° is therefore 10 px, which is the granularity the clearance tests need: `MARKER_CLEARANCE_PX` is 30,
 * so a fixture can sit exactly on a camp, 10 px off it, 25 px off it, or far outside the threshold, all in
 * round numbers.
 */
const FAKE_PX_PER_DEGREE = 10_000;

/**
 * The narrowest MapKit stand-in that lets the diff run: a coordinate, an annotation that keeps its factory
 * element, its listeners and its `anchorOffset`, and a map that records add/remove ORDER and answers
 * `convertCoordinateToPointOnPage`.
 *
 * ## What is modelled, what is measured, and what is invented (QUA-58)
 *
 * This comment used to say "nothing here models MapKit BEHAVIOUR", and that was true until QUA-49 added two
 * behavioural paths — the camp re-add and the page-pixel clearance — whose inputs are exactly the two members
 * this fake did NOT have. Their absence did not fail: `annotations.ts` guarded both reads and degraded to "no
 * camps known", so the fix's code ran in no test at all while the file looked covered. That is the shape
 * `scripts/prove.mjs` exists for, and this fake is the other half of closing it. The guards are gone now — and
 * note what that does and does not buy, because the `as unknown as MKMap` below is a deliberate hole: a member
 * this fake stops modelling is NOT a type error, it is a loud runtime failure here instead of a silent no-op in
 * the product.
 *
 * Three claims are now modelled, and they are not equally solid:
 *
 * - **`annotations` reflects ADD ORDER** — measured against a real map (QUA-49): paint order is add order,
 *   because `.mk-annotation-container` hosts a closed shadow root whose per-slot wrappers are ordered by
 *   insertion. So the tail of `added` is what paints on top, and asserting on that order is asserting on
 *   precedence.
 * - **`addAnnotation` re-attaches the element** — measured for the re-add specifically: after a lift the camp's
 *   element instance survives and a DOM click on it still selects its day, because the factory closes over it.
 *   Without this the fake would drop the element on the remove half and a lifted camp would look unclickable
 *   for a reason MapKit does not have.
 * - **`convertCoordinateToPointOnPage` is INVENTED** — a linear {@link FAKE_PX_PER_DEGREE} projection with y
 *   increasing southward. It is emphatically not MapKit's, which is a Mercator projection off live camera
 *   state where a degree of longitude at 61° N is under half a degree of latitude on screen. Nothing here may
 *   assert a pixel value MapKit would produce; what the tests depend on is only that page distance grows with
 *   coordinate distance in known units, so a fixture can be placed a stated number of pixels from a camp.
 */
function fakeMapKit(): {
    mapkit: MapKitNamespace; map: MKMap; added: MKAnnotation[]; removed: MKAnnotation[];
} {
    const added: MKAnnotation[] = [];
    const removed: MKAnnotation[] = [];

    class FakeCoordinate implements MKCoordinate {
        constructor(public latitude: number, public longitude: number) {}
        copy(): MKCoordinate { return new FakeCoordinate(this.latitude, this.longitude); }
    }

    class FakeAnnotation {
        coordinate: MKCoordinate;
        element: HTMLElement;
        data: unknown;
        draggable: boolean;
        /** Set from the options at creation and live-mutable afterwards, as measured on the real annotation. */
        anchorOffset?: DOMPoint;
        listeners = new Map<string, ((event: unknown) => void)[]>();

        constructor(
            coordinate: MKCoordinate,
            factory: () => HTMLElement,
            options?: { data?: unknown; draggable?: boolean; anchorOffset?: DOMPoint },
        ) {
            this.coordinate = coordinate;
            this.data = options?.data;
            this.draggable = options?.draggable ?? false;
            this.anchorOffset = options?.anchorOffset;
            // The real factory is called LAZILY on first display (measured; see annotations.ts). Calling it
            // eagerly here is the one place this fake is deliberately more generous than MapKit, so that a
            // test can click the element at all.
            this.element = factory();
            document.body.appendChild(this.element);
        }

        addEventListener(name: string, handler: (event: unknown) => void): void {
            const existing = this.listeners.get(name) ?? [];
            existing.push(handler);
            this.listeners.set(name, existing);
        }

        fire(name: string): void {
            for (const handler of this.listeners.get(name) ?? []) handler({});
        }
    }

    const mapkit = {
        Coordinate: FakeCoordinate,
        Annotation: Object.assign(FakeAnnotation, {
            CollisionMode: { Rectangle: 'Rectangle', Circle: 'Circle', None: 'None' },
            DisplayPriority: { Low: 250, High: 750, Required: 1000 },
        }),
    } as unknown as MapKitNamespace;

    const map = {
        // Live, in add order — `annotations.ts` reads it to find the camps to lift.
        get annotations(): MKAnnotation[] { return added; },
        addAnnotation: (annotation: MKAnnotation) => {
            added.push(annotation);
            // Re-attaching matters on the re-add half of a lift; see the fake's header.
            document.body.appendChild((annotation as unknown as FakeAnnotation).element);
        },
        removeAnnotation: (annotation: MKAnnotation) => {
            const index = added.indexOf(annotation);
            if (index >= 0) added.splice(index, 1);
            removed.push(annotation);
            (annotation as unknown as FakeAnnotation).element.remove();
        },
        convertCoordinateToPointOnPage: (coordinate: MKCoordinate): DOMPoint => new DOMPoint(
            coordinate.longitude * FAKE_PX_PER_DEGREE,
            -coordinate.latitude * FAKE_PX_PER_DEGREE,
        ),
    } as unknown as MKMap;

    return { mapkit, map, added, removed };
}

/** The `{ campId }` marker `annotations.ts` puts in a camp annotation's `data`, read back for order tests. */
function isCamp(annotation: MKAnnotation): boolean {
    const data: unknown = annotation.data;
    return typeof data === 'object' && data !== null && 'campId' in data;
}

function camp(overrides: Partial<Camp> = {}): Camp {
    return {
        id: 'camp-1',
        name: 'Gjendebu',
        dayNumber: 1,
        coordinates: [8.3, 61.6],
        elevation: 995,
        ...overrides,
    } as Camp;
}

function photo(overrides: Partial<Photo> = {}): Photo {
    return { id: 'photo-1', url: 'p1.jpg', coordinates: [8.3, 61.6], ...overrides } as Photo;
}

function group(photos: Photo[], center: LngLat): PhotoGroup {
    // `key` is the zoom-derived grid cell and is deliberately NOT the marker key — `syncPhotoAnnotations`
    // diffs on `representative.id`, so a regroup at a new zoom must reuse the marker. Held constant here.
    return { key: 'cell', representative: photos[0], photos, count: photos.length, center };
}

/* ------------------------------------------------------------------ camps */

describe('camp annotations (QUA-51)', () => {
    it('dispatches the camp as it is NOW, not as it was when the element was built', () => {
        const { mapkit, map } = fakeMapKit();
        const registry = new Map<string, CampAnnotationEntry>();
        const clicked: Camp[] = [];
        const onClick = (c: Camp) => { clicked.push(c); };

        syncCampAnnotations(mapkit, map, registry, [camp()], null, onClick);
        const element = registry.get('camp-1')!.element;

        // Same id, moved 300 m east and renumbered — the shape a sync or an edit-mode drag produces.
        const moved = camp({ coordinates: [8.305, 61.6], dayNumber: 2, elevation: 1042 });
        syncCampAnnotations(mapkit, map, registry, [moved], null, onClick);

        // The element is REUSED by the diff, which is the whole reason the stale closure survived so long.
        expect(registry.get('camp-1')!.element).toBe(element);

        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(clicked).toHaveLength(1);
        expect(clicked[0]).toBe(moved);
        expect(clicked[0].coordinates).toEqual([8.305, 61.6]);
        expect(clicked[0].dayNumber).toBe(2);
    });

    it('still dispatches after several diffs, and always the latest', () => {
        const { mapkit, map } = fakeMapKit();
        const registry = new Map<string, CampAnnotationEntry>();
        const clicked: Camp[] = [];
        const onClick = (c: Camp) => { clicked.push(c); };

        syncCampAnnotations(mapkit, map, registry, [camp()], null, onClick);
        const element = registry.get('camp-1')!.element;
        for (const elevation of [1000, 1100, 1200]) {
            syncCampAnnotations(mapkit, map, registry, [camp({ elevation })], null, onClick);
        }

        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(clicked[0].elevation).toBe(1200);
        // One listener, not four: the diff must not re-register on the reused element.
        expect(clicked).toHaveLength(1);
    });

    it('keeps the badge and the selected class in step with the diff', () => {
        const { mapkit, map } = fakeMapKit();
        const registry = new Map<string, CampAnnotationEntry>();
        const onClick = () => {};

        syncCampAnnotations(mapkit, map, registry, [camp()], null, onClick);
        const element = registry.get('camp-1')!.element;
        expect(element.querySelector('.camp-marker-badge')!.textContent).toBe('1');
        expect(element.classList.contains('camp-marker-selected')).toBe(false);

        syncCampAnnotations(mapkit, map, registry, [camp({ dayNumber: 4 })], 'camp-1', onClick);
        expect(element.querySelector('.camp-marker-badge')!.textContent).toBe('4');
        expect(element.classList.contains('camp-marker-selected')).toBe(true);
    });

    it('removes an annotation whose camp disappeared', () => {
        const { mapkit, map, added } = fakeMapKit();
        const registry = new Map<string, CampAnnotationEntry>();
        syncCampAnnotations(mapkit, map, registry, [camp(), camp({ id: 'camp-2' })], null, () => {});
        expect(added).toHaveLength(2);

        syncCampAnnotations(mapkit, map, registry, [camp()], null, () => {});
        expect(added).toHaveLength(1);
        expect([...registry.keys()]).toEqual(['camp-1']);
    });
});

/* ------------------------------------------------------------------ photos */

describe('photo annotations (QUA-51)', () => {
    /**
     * The photo path already resolved its group from the registry at drag time — this pins that, because it
     * is the pattern the camp handler was fixed to match and a "simplification" back to the captured
     * `group` would be silent.
     */
    it('drag-end writes to the photos the group holds NOW', () => {
        const { mapkit, map, added } = fakeMapKit();
        const registry = new Map<string, PhotoAnnotationEntry>();
        const updates: [string, LngLat][] = [];
        const callbacks = {
            onPhotoClick: () => {},
            onLocationUpdate: (id: string, coordinates: LngLat) => { updates.push([id, coordinates]); },
        };

        const first = photo();
        syncPhotoAnnotations(
            mapkit, map, registry, [group([first], [8.3, 61.6])], null, true, callbacks);

        // A regroup at a new zoom keeps the same representative and picks up a second photo.
        const second = photo({ id: 'photo-2' });
        syncPhotoAnnotations(
            mapkit, map, registry, [group([first, second], [8.31, 61.61])], null, true, callbacks);

        const annotation = added[0] as unknown as { fire: (name: string) => void };
        annotation.fire('drag-end');
        expect(updates.map(([id]) => id)).toEqual(['photo-1', 'photo-2']);
        // The coordinate comes off the annotation, which the diff repositioned.
        expect(updates[0][1]).toEqual([8.31, 61.61]);
    });

    it('drops the drag affordance when edit mode ends', () => {
        const { mapkit, map, added } = fakeMapKit();
        const registry = new Map<string, PhotoAnnotationEntry>();
        const callbacks = { onPhotoClick: () => {} };

        syncPhotoAnnotations(mapkit, map, registry, [group([photo()], [8.3, 61.6])], null, true, callbacks);
        expect(added[0].draggable).toBe(true);
        expect(registry.get('photo-1')!.element.classList.contains('photo-marker-draggable')).toBe(true);

        syncPhotoAnnotations(mapkit, map, registry, [group([photo()], [8.3, 61.6])], null, false, callbacks);
        expect(added[0].draggable).toBe(false);
        expect(registry.get('photo-1')!.element.classList.contains('photo-marker-draggable')).toBe(false);
    });
});

/* -------------------------------------------------- camp precedence (QUA-49, covered by QUA-58) */

/** The camp every test below is placed against: `camp()`'s default coordinate, `[8.3, 61.6]`. */
const CAMP_AT: LngLat = [8.3, 61.6];

/**
 * `{ x, y }` off an `anchorOffset`, with `−0` folded to `0`.
 *
 * Not cosmetic. `clearedAnchorOffset` computes `-unitX * push`, which is `−0` for any purely vertical push —
 * the coincident case, and the common one — and vitest compares numbers with `Object.is`, so `toEqual({ x: 0 })`
 * fails against it with a diff that reads exactly like a real defect. The sign of a zero-length push carries no
 * information, so it is folded here rather than asserted around at four call sites.
 */
function xy(point: DOMPoint | undefined): { x: number; y: number } {
    expect(point, 'the annotation carries no anchorOffset at all').toBeDefined();
    return { x: point!.x === 0 ? 0 : point!.x, y: point!.y === 0 ? 0 : point!.y };
}

/**
 * The `anchorOffset` a stack gets when its group centre is `eastDegrees` east of {@link CAMP_AT}.
 *
 * One camp, one stack, one diff — the whole point is to read the offset as a function of page-pixel
 * separation, which {@link FAKE_PX_PER_DEGREE} makes a round number.
 */
function offsetEastOfCamp(eastDegrees: number): { x: number; y: number } {
    const { mapkit, map } = fakeMapKit();
    syncCampAnnotations(mapkit, map, new Map<string, CampAnnotationEntry>(), [camp()], null, () => {});

    const registry = new Map<string, PhotoAnnotationEntry>();
    const centre: LngLat = [CAMP_AT[0] + eastDegrees, CAMP_AT[1]];
    syncPhotoAnnotations(
        mapkit, map, registry, [group([photo({ coordinates: centre })], centre)], null, false,
        { onPhotoClick: () => {} });

    return xy(registry.get('photo-1')!.annotation.anchorOffset);
}

/**
 * The two halves of QUA-49, over the two map members this fake did not model until QUA-58.
 *
 * Both were shipped guarded — `Array.isArray(map.annotations)` and
 * `typeof map.convertCoordinateToPointOnPage !== 'function'` — so with the old fake the lift found no camps
 * and the clearance found no projection, and every assertion in this file passed with neither path running.
 * `scripts/prove.mjs` is what says these do not have that shape: run against `87f4127~1`, the pre-fix
 * `annotations.ts`, they fail on the assertions rather than on an import.
 *
 * The numbers below are page pixels in the fake projection, NOT pixels MapKit would produce. A 32 px stack
 * centres at `anchorOffset (0, −16)` and y is downward-negative, so `+30 − 16 = +14` is "30 px above the
 * coordinate" and a negative x is a push EAST. See `centringAnchorOffset` in `annotations.ts` for the
 * measured sign convention that makes that read backwards.
 */
describe('camps paint above photo stacks (QUA-49)', () => {
    it('re-adds the camps after a diff that creates a stack, so they land LAST in add order', () => {
        const { mapkit, map, added } = fakeMapKit();
        const camps = new Map<string, CampAnnotationEntry>();
        syncCampAnnotations(mapkit, map, camps, [
            camp(),
            camp({ id: 'camp-2', dayNumber: 2, coordinates: [8.4, 61.66] }),
        ], null, () => {});
        expect(added.map(isCamp)).toEqual([true, true]);

        // Far from both camps, so this asserts the re-add ALONE — no clearance is involved.
        const far: LngLat = [8.9, 62.2];
        syncPhotoAnnotations(
            mapkit, map, new Map<string, PhotoAnnotationEntry>(),
            [group([photo({ coordinates: far })], far)], null, false, { onPhotoClick: () => {} });

        // Add order IS paint order on this surface, so "the camps are the tail" is the precedence assertion.
        expect(added.map(isCamp)).toEqual([false, true, true]);
        expect(added[1]).toBe(camps.get('camp-1')!.annotation);
        expect(added[2]).toBe(camps.get('camp-2')!.annotation);
    });

    it('leaves a lifted camp clickable, still dispatching its own day', () => {
        const { mapkit, map } = fakeMapKit();
        const camps = new Map<string, CampAnnotationEntry>();
        const clicked: Camp[] = [];
        syncCampAnnotations(mapkit, map, camps, [camp()], null, (c) => { clicked.push(c); });
        const element = camps.get('camp-1')!.element;

        const far: LngLat = [8.9, 62.2];
        syncPhotoAnnotations(
            mapkit, map, new Map<string, PhotoAnnotationEntry>(),
            [group([photo({ coordinates: far })], far)], null, false, { onPhotoClick: () => {} });

        // The remove-then-add is a real removal, and the element instance has to survive it — measured on the
        // real surface, where the factory closes over it. A lift that left a detached element would restore
        // the paint order and lose the click, which is the same defect wearing a different hat.
        //
        // MEASURED under `scripts/prove.mjs`: this is the ONE assertion in this block that stays GREEN against
        // `87f4127~1`, because a tree with no lift has nothing to break. It guards the lift's implementation
        // rather than the defect, and the four tests around it are the ones that go red without the fix.
        expect(camps.get('camp-1')!.element).toBe(element);
        expect(element.isConnected).toBe(true);
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(clicked).toHaveLength(1);
        expect(clicked[0].id).toBe('camp-1');
    });

    it('does not churn the camps on a settled diff that creates nothing', () => {
        const { mapkit, map, added, removed } = fakeMapKit();
        syncCampAnnotations(
            mapkit, map, new Map<string, CampAnnotationEntry>(), [camp()], null, () => {});

        const registry = new Map<string, PhotoAnnotationEntry>();
        const far: LngLat = [8.9, 62.2];
        const stack = () => [group([photo({ coordinates: far })], far)];
        syncPhotoAnnotations(mapkit, map, registry, stack(), null, false, { onPhotoClick: () => {} });
        const afterCreate = removed.length;

        // Every `region-change-end` re-diffs the stacks. On a settled map nothing is created, so the lift must
        // not run — a remove/add per camp per camera event is churn the fix does not need, and the `created`
        // gate in `syncPhotoAnnotations` is the only thing preventing it. Order alone cannot catch this: a
        // full unconditional lift ends with the camps in exactly the same places.
        syncPhotoAnnotations(mapkit, map, registry, stack(), null, false, { onPhotoClick: () => {} });
        expect(removed).toHaveLength(afterCreate);
        expect(added.map(isCamp)).toEqual([false, true]);
    });

    it('pushes a stack off a camp it sits on, and fades the push out as they separate', () => {
        // Exactly coincident: no direction to push along, so straight up by the full 30 px clearance. This is
        // the fixture case — all three photos in `src/fixtures/publicShowcase.ts` carry their day camp's
        // coordinate EXACTLY — and the mirror of the lift: reordering alone leaves this stack under an opaque
        // camp marker, invisible and unclickable.
        expect(offsetEastOfCamp(0)).toEqual({ x: 0, y: 14 });

        // 10 px east: pushed 20 px further east (30 − 10), and not vertically at all.
        expect(offsetEastOfCamp(0.001)).toEqual({ x: -20, y: -16 });

        // 25 px east: 5 px left of the threshold, so 5 px of push. Continuous, which is what stops a marker
        // hopping when a zoom crosses the boundary.
        expect(offsetEastOfCamp(0.0025)).toEqual({ x: -5, y: -16 });

        // Well outside the clearance: plain centring, no push.
        expect(offsetEastOfCamp(0.02)).toEqual({ x: 0, y: -16 });
    });

    it('recomputes the clearance for a stack already on the map, because a zoom changes it', () => {
        const { mapkit, map } = fakeMapKit();
        syncCampAnnotations(
            mapkit, map, new Map<string, CampAnnotationEntry>(), [camp()], null, () => {});

        const registry = new Map<string, PhotoAnnotationEntry>();
        const callbacks = { onPhotoClick: () => {} };
        syncPhotoAnnotations(
            mapkit, map, registry, [group([photo()], CAMP_AT)], null, false, callbacks);
        const annotation = registry.get('photo-1')!.annotation;
        expect(xy(annotation.anchorOffset)).toEqual({ x: 0, y: 14 });

        // Same representative id, so the diff REUSES this annotation and has to write the new offset onto it —
        // the live-mutation path, which is a different line from the creation options above and the one that
        // needed a cast until `anchorOffset` reached `MKAnnotation` (QUA-58).
        const moved: LngLat = [CAMP_AT[0] + 0.02, CAMP_AT[1]];
        syncPhotoAnnotations(
            mapkit, map, registry, [group([photo({ coordinates: moved })], moved)], null, false, callbacks);
        expect(registry.get('photo-1')!.annotation).toBe(annotation);
        expect(xy(annotation.anchorOffset)).toEqual({ x: 0, y: -16 });
    });
});
