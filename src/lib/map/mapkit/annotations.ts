/**
 * Camp markers and photo-thumbnail stacks, as custom-DOM MapKit annotations. (MAP-03)
 *
 * ## The good news, measured
 *
 * `mapkit.Annotation(coordinate, factory, options)` puts the factory's element inside
 * `div.mk-annotation-container` as a direct LIGHT-DOM child. Both the element's and the container's computed
 * `transform` are `none`, so `src/index.css`'s `.camp-marker:hover { transform: scale(1.15) }` and the
 * `.photo-thumbnail-marker` hover have nothing to fight. That is *better* than Mapbox, whose
 * `mapboxgl.Marker` wraps the element in an absolutely-positioned, transform-driven container.
 *
 * It is NOT, however, the whole tree — see the paint-order section below. `.mk-annotation-container` hosts a
 * **closed shadow root**, our element carries a `slot="mk-slot-…"` attribute, and what actually positions and
 * stacks it is a wrapper inside that shadow tree, which no stylesheet and no `parentElement` walk can reach.
 * An earlier version of this paragraph said "there is no per-annotation wrapper", which was a false negative
 * from `element.shadowRoot` — that returns `null` for a closed root, so the tree looks absent rather than
 * shut.
 *
 * Consequences worth knowing before editing this file, from `scripts/mapkit/surface-probe/?probe=m3` except
 * the paint-order one, which was measured against the running app and the e2e fixture (QUA-49):
 *
 * - **`click` listeners on the factory element fire**, and `stopPropagation` works. So the incumbent's DOM
 *   click handling ports unchanged, and MapKit's own `select`/`deselect` events are deliberately NOT used:
 *   `onCampSelect` *toggles* (`src/hooks/useTrekData.ts:171-173`, relied on by
 *   `e2e/utils/test-helpers.ts:180-182`), while `map.selectedAnnotation` is single-select map state that
 *   would desync from that toggle and re-fire on every programmatic change.
 * - **Annotation PAINT ORDER is ADD ORDER, and it is the only lever that reaches it.** (QUA-49; the three
 *   levers that do not work, and why, are on {@link liftCampsAboveStacks}.) A photo stack added after a camp
 *   paints above it and intercepts its clicks — measured with the fixture photo that sits on the day-3 camp:
 *   `elementFromPoint` at the camp's centre returned `.photo-stack-main`, and Playwright reported
 *   "photo-stack-main subtree intercepts pointer events" on a camp marker that was visible and stable.
 *   Re-adding the camp annotation moves its slot to the end of the shadow tree and the camp becomes topmost.
 *   **It was a MapKit-only regression, not something both surfaces shared.** An earlier comment here said the
 *   CSS rule was "inert on Mapbox too, for the same reason", and that was measurably false: on Mapbox
 *   `.camp-marker` computed `position: absolute` with `z-index: 22` and no shadow tree in the way, because
 *   mapbox-gl adopts `options.element` and adds its own `position: absolute` class. Camps genuinely did paint
 *   above photo stacks there. Getting that wrong made a port regression look like a pre-existing product
 *   decision, which is the more expensive mistake of the two.
 * - **The factory is called LAZILY, on first display.** Never assert on the DOM immediately after
 *   `addAnnotation`; in the probe it happened to be present, which is precisely why nothing here depends on
 *   it. It is also why the highlight/draggable state is written through {@link applyPhotoState}, which
 *   tolerates a missing element.
 * - **`anchorOffset` y is DOWNWARD-NEGATIVE, and the default is bottom-anchored.** See
 *   {@link centringAnchorOffset}.
 *
 * ## MAP-05: "the incumbent" is GONE, and every citation below is history
 *
 * This file was written against a shipping Mapbox surface and refers to it in the present tense as **"the
 * incumbent"**, citing `useMapbox.ts`, `layerConfigs.ts` and `MapboxGlobe.tsx` by line. MAP-05 DELETED all of
 * it (2707 lines). So: read every "the incumbent does X" below as "the Mapbox surface did X, until MAP-05",
 * and expect none of those paths to resolve — `git log --diff-filter=D -- src/hooks/mapbox/` recovers them.
 *
 * The prose is kept rather than rewritten because each citation is the MEASUREMENT that explains why the code
 * here is shaped as it is, and that reason did not stop being true when the file it measured went away. A
 * mechanical tense-scrub across ~36 of these would have risked the measurements to fix a verb, so the term is
 * retired here instead of edited everywhere.
 */

import type { LngLat } from '../types';
import type { Camp, Photo } from '../../../types/trek';
import type { MapKitNamespace, MKAnnotation, MKCoordinate, MKMap } from './mapkitTypes';
import { toLatLng } from './coords';
import { assertKnownEvent } from './events';
import type { PhotoGroup } from './geometry';

const CAMP_MARKER_PX = 36;
const PHOTO_MARKER_PX = 32;

/**
 * Page-pixel clearance kept between a photo stack's centre and the nearest camp marker's centre. (QUA-49)
 *
 * Sized off the two elements' own boxes rather than picked: `.camp-marker` is 36 px and 42 px when selected
 * (half-height 21), `.photo-thumbnail-marker` is 32 px and 40 px when highlighted (half-height 20). Hit
 * testing is against those boxes, so 30 px puts each marker's centre outside the other's box with 9 px to
 * spare in the worst combination — while staying small enough that the pair still reads as one place.
 */
const MARKER_CLEARANCE_PX = 30;

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
 *
 * **x is negative-going too**, measured separately for QUA-49 because the table above says nothing about it:
 * `anchorOffset (+20, −16)` on a 32 px stack moved the marker 20 px **LEFT**. So in both axes
 * `rect centre − coordinate = −anchorOffset − (0, size/2)`, which is what {@link clearedAnchorOffset} inverts.
 */
export function centringAnchorOffset(sizePx: number): DOMPoint {
    return new DOMPoint(0, -sizePx / 2);
}

function annotationOptions(
    mapkit: MapKitNamespace, sizePx: number, data: unknown, priority: number, draggable = false,
    anchorOffset: DOMPoint = centringAnchorOffset(sizePx),
) {
    return {
        size: { width: sizePx, height: sizePx },
        anchorOffset,
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
        // answer to a photo stack covering a camp. See {@link liftCampsAboveStacks}.
        displayPriority: priority,
    };
}

/* ------------------------------------------------- paint order and clearance (QUA-49) */

function isCampAnnotation(annotation: MKAnnotation): boolean {
    const data: unknown = annotation.data;
    return typeof data === 'object' && data !== null && 'campId' in data;
}

/**
 * The camp annotations currently on the map, identified by the `{ campId }` this module puts in `data`.
 *
 * `Array.isArray` rather than a bare read because the unit-test fake in `annotations.test.ts` models only
 * `addAnnotation`/`removeAnnotation`; without the guard every photo test throws on a property the real map
 * always has. Same reason for the `typeof` guard in {@link campMarkerPoints}. Both degrade to "no camps
 * known", which is why the e2e/probe measurement is what proves the real path — see the header.
 */
function campAnnotations(map: MKMap): MKAnnotation[] {
    const all = map.annotations;
    return Array.isArray(all) ? all.filter(isCampAnnotation) : [];
}

/**
 * Re-add every camp annotation, so the camps land LAST and therefore paint above the photo stacks.
 *
 * ## The mechanism, and the three levers that are not it
 *
 * `.mk-annotation-container` hosts a **closed shadow root** (measured with CDP's `DOM.getDocument({pierce})`;
 * `element.shadowRoot` and `element.assignedSlot` both return `null` for a closed root, which is why an
 * earlier reading of this DOM concluded there was no shadow tree at all). Our element stays a light-DOM child
 * of the container and carries a `slot="mk-slot-…"` attribute; what positions and stacks it is a per-slot
 * wrapper inside the shadow tree. Paint order is the order of those slots, which is the order the annotations
 * were added.
 *
 * That single fact explains all three levers that were tried before and measured useless — each of them acts
 * on the wrong tree:
 *
 * - **`position: relative` + z-index on both elements.** Our element's z-index can only stack it inside its
 *   own shadow wrapper; it cannot cross into a sibling wrapper's box. Measured with the camp at
 *   `z-index: 20` and the stack at `5`, both `position: relative`: the stack still won.
 * - **`DisplayPriority.Required` vs `.High`.** Drives collision culling, not order.
 * - **Moving the camp element to the end of `.mk-annotation-container`.** Reorders the light DOM, which is
 *   not the tree that paints; the slots stay where they were.
 *
 * Remove-then-add is what moves a slot, and it is cheap because it is rare: only a diff that *creates* a
 * photo annotation can put a stack after the camps, so {@link syncPhotoAnnotations} calls this only then.
 * Measured after a lift: the camp's rect is unchanged, it is topmost at its own centre, and a DOM click on it
 * still selects its day — the element instance survives because the factory closes over it.
 *
 * This restores the Mapbox precedence exactly (`.camp-marker` z-index 22 over `.photo-thumbnail-marker` 5),
 * and it is deliberately unconditional: {@link clearedAnchorOffset} is the nicer half of the fix but depends
 * on a live projection and on two CSS sizes staying in step with `MARKER_CLEARANCE_PX`. If it ever computes
 * nothing, the camp — the map's navigation control — is still reachable.
 */
function liftCampsAboveStacks(map: MKMap): void {
    for (const annotation of campAnnotations(map)) {
        map.removeAnnotation(annotation);
        map.addAnnotation(annotation);
    }
}

function pagePoint(map: MKMap, coordinate: MKCoordinate): DOMPoint | null {
    if (typeof map.convertCoordinateToPointOnPage !== 'function') return null;
    const point = map.convertCoordinateToPointOnPage(coordinate);
    // A degenerate point before the map has a transform is a documented hazard on this surface
    // (`geometry.test.ts:187`), and it would otherwise push every stack as if it sat on a camp.
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

function campMarkerPoints(map: MKMap): DOMPoint[] {
    const points: DOMPoint[] = [];
    for (const annotation of campAnnotations(map)) {
        const point = pagePoint(map, annotation.coordinate);
        if (point) points.push(point);
    }
    return points;
}

/**
 * A photo stack's `anchorOffset`: centred on its coordinate, unless that would put it on top of a camp
 * marker, in which case it is pushed along the camp→stack direction until the two centres are
 * {@link MARKER_CLEARANCE_PX} apart.
 *
 * Why this exists at all. {@link liftCampsAboveStacks} alone makes the camp reachable and leaves the mirror
 * defect: a stack whose centre is *inside* a camp marker is then covered by it, unclickable, and — since
 * `.camp-marker` is opaque glass with a `backdrop-filter` — invisible. That is not a corner case. All three
 * photos in `src/fixtures/publicShowcase.ts` carry their day camp's coordinate EXACTLY, so in the e2e fixture
 * every stack is perfectly coincident with a camp at every zoom; a photo taken at camp does the same thing in
 * a real journey. Measured on the fixture: reorder alone → camp centre hits `.camp-marker` and the stack
 * centre hits `.camp-marker` too. Both levers → each of the four on-screen camps and both stacks own their
 * own centre.
 *
 * The push is continuous — magnitude `MARKER_CLEARANCE_PX − distance`, so it fades to zero exactly as the two
 * separate — which is what keeps a stack from hopping when a zoom crosses the threshold. It is recomputed on
 * every photo diff, including for annotations already on the map, because the distance is a *page-pixel*
 * distance and therefore changes with zoom.
 *
 * A group's `center` is already a grid-cell centroid rather than any photo's exact position
 * (`geometry.ts:groupPhotosByLocation`), so nudging the marker off it claims less than the same nudge on a
 * camp would — which is why the stack moves here and the camp never does.
 */
function clearedAnchorOffset(
    map: MKMap, coordinate: MKCoordinate, campPoints: readonly DOMPoint[],
): DOMPoint {
    const centred = centringAnchorOffset(PHOTO_MARKER_PX);
    if (campPoints.length === 0) return centred;
    const own = pagePoint(map, coordinate);
    if (!own) return centred;

    let nearest: DOMPoint | null = null;
    let distance = Infinity;
    for (const point of campPoints) {
        const candidate = Math.hypot(point.x - own.x, point.y - own.y);
        if (candidate < distance) { distance = candidate; nearest = point; }
    }
    if (!nearest || distance >= MARKER_CLEARANCE_PX) return centred;

    // Straight up when the two coincide exactly — no direction to push along, and it is the common case.
    const unitX = distance === 0 ? 0 : (own.x - nearest.x) / distance;
    const unitY = distance === 0 ? -1 : (own.y - nearest.y) / distance;
    const push = MARKER_CLEARANCE_PX - distance;
    // Inverting `rect centre − coordinate = −anchorOffset − (0, size/2)`. See centringAnchorOffset.
    return new DOMPoint(-unitX * push, -(PHOTO_MARKER_PX / 2) - unitY * push);
}

/**
 * `anchorOffset` is live-mutable on an annotation already on the map — measured: writing it moved the marker
 * and its hit region, with no re-add.
 *
 * The cast is here because `MKAnnotation` (`./mapkitTypes.ts`) declares `anchorOffset` on the *options* only.
 * Adding it to the annotation interface is the clean fix and is deliberately NOT done in this commit: QUA-49
 * owns this file and `src/index.css`, and a type shared by the whole adapter is not mine to move.
 */
function setAnchorOffset(annotation: MKAnnotation, offset: DOMPoint): void {
    (annotation as MKAnnotation & { anchorOffset?: DOMPoint }).anchorOffset = offset;
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
    // Once per diff, not per group: the projection is the same for all of them, and QUA-49's clearance is
    // measured against every camp on the map rather than against the selected day's.
    const campPoints = campMarkerPoints(map);
    let created = 0;

    for (const group of groups) {
        const key = group.representative.id;
        seen.add(key);
        const coordinate = new mapkit.Coordinate(group.center[1], group.center[0]);
        const anchorOffset = clearedAnchorOffset(map, coordinate, campPoints);
        const entry = existing.get(key);

        if (entry) {
            entry.annotation.coordinate = coordinate;
            // Reapplied on every diff, like the classes below and for the same reason: the clearance is a
            // page-pixel distance, so a zoom changes it without changing anything about the group.
            setAnchorOffset(entry.annotation, anchorOffset);
            entry.photos = group.photos;
            entry.annotation.draggable = editMode;
            applyPhotoState(entry.element, group, selectedCampId, editMode);
            continue;
        }

        const element = photoElement(group, callbacks);
        applyPhotoState(element, group, selectedCampId, editMode);
        const annotation = new mapkit.Annotation(
            coordinate,
            () => element,
            annotationOptions(mapkit, PHOTO_MARKER_PX, { photoId: key },
                mapkit.Annotation.DisplayPriority.High, editMode, anchorOffset),
        );
        annotation.addEventListener(assertKnownEvent('drag-end'), () => {
            const current = existing.get(key);
            if (!current || !callbacks.onLocationUpdate) return;
            const moved: LngLat = [annotation.coordinate.longitude, annotation.coordinate.latitude];
            for (const photo of current.photos) callbacks.onLocationUpdate(photo.id, moved);
        });
        map.addAnnotation(annotation);
        created++;
        existing.set(key, { annotation, element, photos: group.photos });
    }

    for (const [key, entry] of existing) {
        if (seen.has(key)) continue;
        map.removeAnnotation(entry.annotation);
        existing.delete(key);
    }

    // Only a NEW photo annotation can have landed after the camps, so this is the one place the lift is
    // needed — and on a settled map, where every group already has its marker, it does not run at all.
    if (created > 0) liftCampsAboveStacks(map);
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
