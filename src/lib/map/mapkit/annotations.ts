/**
 * Camp markers and photo-thumbnail stacks, as custom-DOM MapKit annotations. (MAP-03)
 *
 * ## The good news, measured
 *
 * `mapkit.Annotation(coordinate, factory, options)` puts the factory's element **directly inside**
 * `div.mk-annotation-container` — there is no per-annotation wrapper. Both the element's and the container's
 * computed `transform` are `none`, so `src/index.css`'s `.camp-marker:hover { transform: scale(1.15) }` and
 * the `.photo-thumbnail-marker` hover have nothing to fight. That is *better* than Mapbox, whose
 * `mapboxgl.Marker` wraps the element in an absolutely-positioned, transform-driven container.
 *
 * Consequences worth knowing before editing this file, all from `scripts/mapkit/surface-probe/?probe=m3`:
 *
 * - **`click` listeners on the factory element fire**, and `stopPropagation` works. So the incumbent's DOM
 *   click handling ports unchanged, and MapKit's own `select`/`deselect` events are deliberately NOT used:
 *   `onCampSelect` *toggles* (`src/hooks/useTrekData.ts:171-173`, relied on by
 *   `e2e/utils/test-helpers.ts:180-182`), while `map.selectedAnnotation` is single-select map state that
 *   would desync from that toggle and re-fire on every programmatic change.
 * - **MapKit's annotation PAINT ORDER is not reachable from the app, and a photo stack can therefore cover a
 *   camp marker and intercept its clicks.** Measured in the running app with a fixture photo over the day-3
 *   camp: `elementFromPoint` at the camp's centre returns `.photo-stack-main`, and Playwright reports
 *   "photo-stack-main subtree intercepts pointer events" on a camp marker that is visible and stable.
 *   Three levers were tried and NONE flipped it: `position: relative` plus explicit z-index on both (the
 *   elements compute `position: static`, so `src/index.css`'s `z-index: 20 !important` on `.camp-marker` is
 *   inert HERE); `DisplayPriority.Required` vs `.High`; and moving the camp element to the end of
 *   `.mk-annotation-container`.
 *   **This is a MapKit-only regression, not something both surfaces share.** An earlier version of this
 *   comment said the rule was "inert on Mapbox too, for the same reason", and that was measurably false: on
 *   Mapbox `.camp-marker` computes `position: absolute` with `z-index: 22` and NO wrapper, because mapbox-gl
 *   adopts `options.element` and adds its own `position: absolute` class. Camps genuinely do paint above
 *   photo stacks there. Getting that wrong made a port regression look like a pre-existing product decision,
 *   which is the more expensive mistake of the two. Filed as QUA-49.
 *   Recorded rather than guessed at: reaching into an SDK's internal stacking is how you ship a rule that
 *   does nothing. `e2e/mapkit-journey.spec.ts` discovers an unobscured camp at runtime rather than
 *   pretending the overlap is not there.
 * - **The factory is called LAZILY, on first display.** Never assert on the DOM immediately after
 *   `addAnnotation`; in the probe it happened to be present, which is precisely why nothing here depends on
 *   it. It is also why the highlight/draggable state is written through {@link applyPhotoState}, which
 *   tolerates a missing element.
 * - **`anchorOffset` y is DOWNWARD-NEGATIVE, and the default is bottom-anchored.** See
 *   {@link centringAnchorOffset}.
 */

import type { LngLat } from '../types';
import type { Camp, Photo } from '../../../types/trek';
import type { MapKitNamespace, MKAnnotation, MKMap } from './mapkitTypes';
import { toLatLng } from './coords';
import { assertKnownEvent } from './events';
import type { PhotoGroup } from './geometry';

const CAMP_MARKER_PX = 36;
const PHOTO_MARKER_PX = 32;

/**
 * The `anchorOffset` that centres an element of `size` on its coordinate.
 *
 * MEASURED for a 36 px element — `rect centre − coordinate`, in page pixels:
 *
 *     anchorOffset (0,   0)  →  −18   (the default: the element hangs with its BOTTOM on the coordinate)
 *     anchorOffset (0, +18)  →  −36
 *     anchorOffset (0, −18)  →    0   (centred)
 *
 * So y is downward-negative and the default is pin-like. Getting the sign backwards puts every camp marker a
 * full marker-height off its coordinate — visible on screen, and very easy to mistake for a projection bug,
 * which is why this is a named function with the table attached rather than a `-18` at two call sites.
 */
export function centringAnchorOffset(sizePx: number): DOMPoint {
    return new DOMPoint(0, -sizePx / 2);
}

function annotationOptions(
    mapkit: MapKitNamespace, sizePx: number, data: unknown, priority: number, draggable = false,
) {
    return {
        size: { width: sizePx, height: sizePx },
        anchorOffset: centringAnchorOffset(sizePx),
        data,
        draggable,
        calloutEnabled: false,
        // The showcase draws its own day and photo cards; MapKit must not hide a marker to avoid a collision
        // it thinks matters, and a camp must always be reachable. Read off the namespace rather than pinned
        // as literals, so a MapKit version that renames a value fails loudly instead of silently declining
        // to apply an unrecognised string.
        collisionMode: mapkit.Annotation.CollisionMode.None,
        // Camps Required, photo stacks High — the right INTENT for collision culling should
        // `collisionMode` ever change. Measured: it does NOT affect paint order, so it is not the
        // answer to a photo stack covering a camp. See the header.
        displayPriority: priority,
    };
}

/* ------------------------------------------------------------------ camps */

/**
 * DOM identical to `useMapbox.ts:1556-1563`, so `src/index.css`'s `.camp-marker` rules apply unchanged.
 *
 * `onClick` is deliberately zero-argument: the element outlives any single version of the camp data, so it
 * must not close over a `Camp` at all. The caller supplies a closure that resolves the current one — see
 * {@link syncCampAnnotations}.
 */
function campElement(camp: Camp, isSelected: boolean, onClick: () => void): HTMLElement {
    const element = document.createElement('div');
    element.className = 'camp-marker' + (isSelected ? ' camp-marker-selected' : '');
    const badge = document.createElement('span');
    badge.className = 'camp-marker-badge';
    badge.textContent = String(camp.dayNumber);
    element.appendChild(badge);
    element.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
    });
    return element;
}

export interface CampAnnotationEntry {
    annotation: MKAnnotation;
    element: HTMLElement;
    /**
     * The latest camp data for this id, refreshed on every diff and **read by the click handler**.
     *
     * Load-bearing, and it was not until QUA-51: the handler used to close over the camp the element was
     * created with, so after a diff that changed a camp's coordinates or day number, clicking it dispatched
     * the stale object. `useTrekData.ts:171-173` puts that object straight into `selectedCamp`, which is what
     * the sidebar renders and what `regionForZoom` frames the off-route branch on — so a stale click moved
     * the camera to where the camp used to be. `annotations.test.ts` covers it.
     */
    camp: Camp;
}

/**
 * Diff camp annotations by camp id: reposition and restyle what exists, create what does not, remove what
 * disappeared. Same shape as `updateCampMarkers` (`useMapbox.ts:1511-1588`), minus the eleven native
 * circle/symbol layers that function hides unconditionally on its way past — those are dead as shipped and
 * are not ported.
 */
export function syncCampAnnotations(
    mapkit: MapKitNamespace,
    map: MKMap,
    existing: Map<string, CampAnnotationEntry>,
    camps: readonly Camp[],
    selectedCampId: string | null,
    onClick: (camp: Camp) => void,
): void {
    const seen = new Set<string>();

    for (const camp of camps) {
        seen.add(camp.id);
        const isSelected = camp.id === selectedCampId;
        const entry = existing.get(camp.id);

        if (entry) {
            const { latitude, longitude } = toLatLng(camp.coordinates);
            entry.annotation.coordinate = new mapkit.Coordinate(latitude, longitude);
            // Refreshes what the click handler will dispatch. See `CampAnnotationEntry.camp`.
            entry.camp = camp;
            entry.element.classList.toggle('camp-marker-selected', isSelected);
            const badge = entry.element.querySelector('.camp-marker-badge');
            if (badge) badge.textContent = String(camp.dayNumber);
            continue;
        }

        // Built eagerly and handed to the factory, rather than built inside it: the factory is called lazily
        // and we need a stable element reference now, to restyle it on the next diff.
        //
        // The handler reads the camp back out of the registry at CLICK time. `camp` here is only the
        // fallback for the impossible case of the entry having been removed while its element is still in
        // the DOM — the id is captured, the object is not.
        const campId = camp.id;
        const element = campElement(camp, isSelected, () => {
            onClick(existing.get(campId)?.camp ?? camp);
        });
        const { latitude, longitude } = toLatLng(camp.coordinates);
        const annotation = new mapkit.Annotation(
            new mapkit.Coordinate(latitude, longitude),
            () => element,
            annotationOptions(mapkit, CAMP_MARKER_PX, { campId: camp.id },
                mapkit.Annotation.DisplayPriority.Required),
        );
        map.addAnnotation(annotation);
        existing.set(camp.id, { annotation, element, camp });
    }

    for (const [id, entry] of existing) {
        if (seen.has(id)) continue;
        map.removeAnnotation(entry.annotation);
        existing.delete(id);
    }
}

/* ------------------------------------------------------------------ photos */

export interface PhotoAnnotationEntry {
    annotation: MKAnnotation;
    element: HTMLElement;
    photos: Photo[];
}

export interface PhotoCallbacks {
    onPhotoClick: (photo: Photo) => void;
    onLocationUpdate?: (photoId: string, coordinates: LngLat) => void;
    getMediaUrl?: (path: string) => string;
}

/** DOM identical to `useMapbox.ts:1406-1445`, stack backing cards and all. */
function photoElement(group: PhotoGroup, callbacks: PhotoCallbacks): HTMLElement {
    const element = document.createElement('div');
    element.className = 'photo-thumbnail-marker photo-stack';

    if (group.count >= 3) {
        const back = document.createElement('div');
        back.className = 'photo-stack-bg photo-stack-bg-2';
        element.appendChild(back);
    }
    if (group.count >= 2) {
        const back = document.createElement('div');
        back.className = 'photo-stack-bg photo-stack-bg-1';
        element.appendChild(back);
    }

    const frame = document.createElement('div');
    frame.className = 'photo-stack-main';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = group.representative.caption || 'Photo';
    img.draggable = false;
    img.style.opacity = '0';
    img.style.transition = 'opacity 0.2s ease-out';
    img.onload = () => { img.style.opacity = '1'; };
    img.onerror = () => {
        img.style.display = 'none';
        frame.style.background = 'rgba(255,255,255,0.2)';
    };
    const url = group.representative.thumbnail_url || group.representative.url;
    img.src = callbacks.getMediaUrl ? callbacks.getMediaUrl(url) : url;
    frame.appendChild(img);
    element.appendChild(frame);

    element.addEventListener('click', (event) => {
        event.stopPropagation();
        callbacks.onPhotoClick(group.representative);
    });

    return element;
}

/**
 * The mutable classes on a photo stack: day highlight, edit-mode affordance, location provenance.
 *
 * Split out of creation because it has to run on *every* diff — the incumbent's stale-highlight bug on rapid
 * day switching (`useMapbox.ts:1375-1388`) was exactly this state not being reapplied to existing markers.
 */
function applyPhotoState(
    element: HTMLElement,
    group: PhotoGroup,
    selectedCampId: string | null,
    editMode: boolean,
): void {
    const highlighted = selectedCampId
        ? group.photos.some(p => p.waypoint_id === selectedCampId)
        : false;
    element.classList.toggle('photo-marker-highlighted', highlighted);
    element.classList.toggle('photo-marker-draggable', editMode);
    element.classList.remove('location-exif', 'location-estimated', 'location-manual');
    const source = group.representative.location_source;
    if (source) element.classList.add(`location-${source}`);
}

/**
 * Diff photo-stack annotations, keyed by the representative photo's id — the same stable key the incumbent
 * uses, so a regroup at a new zoom reuses markers whose lead photo did not change.
 *
 * Dragging: `annotation.draggable` plus a `drag-end` listener, and the new coordinate is written to **every**
 * photo in the group, matching `useMapbox.ts:1453-1464`. This is owner-only edit mode, not something a shared
 * link reaches, and the drag event payloads are the one part of this file that is documented rather than
 * measured — the probe confirmed `draggable` is accepted and the listeners attach, but did not synthesise a
 * real pointer drag.
 */
export function syncPhotoAnnotations(
    mapkit: MapKitNamespace,
    map: MKMap,
    existing: Map<string, PhotoAnnotationEntry>,
    groups: readonly PhotoGroup[],
    selectedCampId: string | null,
    editMode: boolean,
    callbacks: PhotoCallbacks,
): void {
    const seen = new Set<string>();

    for (const group of groups) {
        const key = group.representative.id;
        seen.add(key);
        const entry = existing.get(key);

        if (entry) {
            entry.annotation.coordinate = new mapkit.Coordinate(group.center[1], group.center[0]);
            entry.photos = group.photos;
            entry.annotation.draggable = editMode;
            applyPhotoState(entry.element, group, selectedCampId, editMode);
            continue;
        }

        const element = photoElement(group, callbacks);
        applyPhotoState(element, group, selectedCampId, editMode);
        const annotation = new mapkit.Annotation(
            new mapkit.Coordinate(group.center[1], group.center[0]),
            () => element,
            annotationOptions(mapkit, PHOTO_MARKER_PX, { photoId: key },
                mapkit.Annotation.DisplayPriority.High, editMode),
        );
        annotation.addEventListener(assertKnownEvent('drag-end'), () => {
            const current = existing.get(key);
            if (!current || !callbacks.onLocationUpdate) return;
            const moved: LngLat = [annotation.coordinate.longitude, annotation.coordinate.latitude];
            for (const photo of current.photos) callbacks.onLocationUpdate(photo.id, moved);
        });
        map.addAnnotation(annotation);
        existing.set(key, { annotation, element, photos: group.photos });
    }

    for (const [key, entry] of existing) {
        if (seen.has(key)) continue;
        map.removeAnnotation(entry.annotation);
        existing.delete(key);
    }
}

export function removeAllAnnotations(
    map: MKMap,
    ...registries: Map<string, { annotation: MKAnnotation }>[]
): void {
    for (const registry of registries) {
        for (const entry of registry.values()) map.removeAnnotation(entry.annotation);
        registry.clear();
    }
}
