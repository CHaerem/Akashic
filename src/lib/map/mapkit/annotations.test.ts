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
 * The narrowest MapKit stand-in that lets the diff run: a coordinate, an annotation that keeps its factory
 * element and its listeners, and a map that records add/remove. Nothing here models MapKit BEHAVIOUR — the
 * measured behaviour lives in `annotations.ts`'s header and was probed against a real map. This only proves
 * what the adapter does with its own registry.
 */
function fakeMapKit(): { mapkit: MapKitNamespace; map: MKMap; added: MKAnnotation[] } {
    const added: MKAnnotation[] = [];

    class FakeCoordinate implements MKCoordinate {
        constructor(public latitude: number, public longitude: number) {}
        copy(): MKCoordinate { return new FakeCoordinate(this.latitude, this.longitude); }
    }

    class FakeAnnotation {
        coordinate: MKCoordinate;
        element: HTMLElement;
        data: unknown;
        draggable: boolean;
        listeners = new Map<string, ((event: unknown) => void)[]>();

        constructor(
            coordinate: MKCoordinate,
            factory: () => HTMLElement,
            options?: { data?: unknown; draggable?: boolean },
        ) {
            this.coordinate = coordinate;
            this.data = options?.data;
            this.draggable = options?.draggable ?? false;
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
        addAnnotation: (annotation: MKAnnotation) => { added.push(annotation); },
        removeAnnotation: (annotation: MKAnnotation) => {
            const index = added.indexOf(annotation);
            if (index >= 0) added.splice(index, 1);
            (annotation as unknown as FakeAnnotation).element.remove();
        },
    } as unknown as MKMap;

    return { mapkit, map, added };
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
