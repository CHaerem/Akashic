/**
 * The imperative engine behind the MapKit journey surface. (MAP-03)
 *
 * Everything vendor-facing and stateful lives here; everything decidable without a browser lives in the pure
 * siblings (`camera.ts`, `geometry.ts`, `chrome.ts`, `coords.ts`) and is unit-tested there. That split is the
 * point: the incumbent's equivalent is 1810 lines with no unit coverage of its geometry at all.
 *
 * ## THE FINDING THAT SHAPES THIS FILE
 *
 * **Nothing interrupts an in-flight MapKit camera animation, and there is no `map.stop()`** — measured, five
 * different ways, and the plan for this task assumed the opposite. Every camera move therefore goes through
 * `./cameraQueue.ts`, which holds the whole measurement, the reasoning and a unit test that proves rapid day
 * switching lands on the LAST day. Read that file before touching anything camera-shaped here.
 *
 * ## What is deliberately not here
 *
 * No terrain, fog, sky, globe projection, auto-rotation or starfield: zero occurrences of `terrain`,
 * `elevation`, `globe` or `orthographic` in the shipped MapKit bundle, ARCH-01 accepted the loss, and MAP-02
 * owns the landing globe separately. No pitch: no tilt exists in MapKit, so `camp.pitch` and
 * `trekConfig.preferredPitch` are dead data (annotated at their declarations in `src/types/trek.ts`). No
 * bearing either — see the note on `isRotationEnabled` below. No POI subsystem, no route-click info, no
 * playback: all three are unreachable in the incumbent as shipped (`src/components/MapKitJourneyMap.tsx`
 * records why for each).
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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Camp, Photo, TrekConfig, TrekData } from '../../../types/trek';
import type { LngLat, MapBounds } from '../types';
import type { MapCameraState } from '../vendorSurface';
import { EMPTY_CAMERA_STATE } from '../vendorSurface';
import { loadMapKit, mapKitToken } from './loader';
import type { MapKitNamespace, MKMap } from './mapkitTypes';
import { assertKnownEvent, EVENTS_USED } from './events';
import { toLngLat } from './coords';
import {
    boundsOfCoordinates, boundsOfRoute, daySegment, groupPhotosByLocation, padBounds,
    strokeFractions, visibleInPaddedBox, withinBounds,
} from './geometry';
import {
    projectToPixels, regionForBounds, regionForZoom, synthesizeZoom,
    type ContainerPx, type Region,
} from './camera';
import {
    arrivalFramePadding, attributionPadding, dayFramePadding, offRouteZoom, PHOTO_ZOOM,
} from './chrome';
import { APPLE_SATELLITE_BAND } from '../imagery';
import { addRouteOverlays, regionOf, removeRouteOverlays, setActiveSegment, type RouteOverlays } from './overlays';
import { CameraQueue } from './cameraQueue';
import {
    removeAllAnnotations, syncCampAnnotations, syncPhotoAnnotations,
    type CampAnnotationEntry, type PhotoAnnotationEntry, type PhotoCallbacks,
} from './annotations';

/**
 * How long to wait for `region-change-end` before assuming the flight is over.
 *
 * The measured flight is ~270 ms; 900 gives three times that. The floor on this number is set by a defect,
 * not by taste — see `./cameraQueue.ts`.
 */
const CAMERA_WATCHDOG_MS = 900;

/** Degrees of slack on the viewport when pre-filtering photos for markers (`useMapbox.ts:1355`). */
const MARKER_PREFILTER_PAD_DEG = 0.05;

/** The 24 px margin on the visible-photo-id projection (`src/components/MapboxGlobe.tsx:229`). */
const VISIBLE_MARGIN_PX = 24;

export interface UseMapKitJourneyOptions {
    containerRef: React.RefObject<HTMLDivElement | null>;
    selectedTrek: TrekConfig | null;
    selectedCamp: Camp | null;
    trekData: TrekData | null;
    photos: Photo[];
    signedIn: boolean;
    editMode: boolean;
    onCampSelect?: (camp: Camp) => void;
    onPhotoClick?: (photo: Photo) => void;
    onPhotoLocationUpdate?: (photoId: string, coordinates: LngLat) => void;
    getMediaUrl?: (path: string) => string;
    onViewportChange?: (bounds: MapBounds) => void;
    onViewportVisiblePhotoIdsChange?: (photoIds: string[]) => void;
}

export interface UseMapKitJourneyReturn {
    ready: boolean;
    error: string | null;
    flyToPhoto: (photo: Photo) => void;
    recenter: () => void;
    getCameraState: () => MapCameraState;
}

function isMobileViewport(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
}

/**
 * The display's device-pixel ratio, for the imagery clamp. (QUA-47)
 *
 * Read here rather than inside `../imagery.ts` for the same reason `isMobileViewport` is: the pure modules stay
 * testable in node, and a `window` read in the middle of the framing maths is a `window` read no unit test can
 * vary. Defaults to 1 when there is no window and when the browser reports something absurd, which is the
 * conservative direction — dpr 1 asks the LEAST of the tile service, so a wrong reading here loosens nothing
 * that was already correct and merely fails to protect a display we could not identify.
 */
function deviceScale(): number {
    if (typeof window === 'undefined') return 1;
    const dpr = window.devicePixelRatio;
    return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

export function useMapKitJourney(options: UseMapKitJourneyOptions): UseMapKitJourneyReturn {
    const {
        containerRef, selectedTrek, selectedCamp, trekData, photos, signedIn, editMode,
        onCampSelect, onPhotoClick, onPhotoLocationUpdate, getMediaUrl,
        onViewportChange, onViewportVisiblePhotoIdsChange,
    } = options;

    const [ready, setReady] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    // A missing token is knowable at render, so it is DERIVED rather than pushed into state from an effect.
    // Not just to satisfy `react-hooks/set-state-in-effect`: state for a value that cannot change gives the
    // component a render where the map is neither loading nor failed, which is the render a test snapshots.
    const token = mapKitToken();
    const error = token
        ? loadError
        : 'No MapKit token configured. Set VITE_MAPKIT_TOKEN — `node scripts/mapkit/devToken.mjs` mints one.';

    const mapkitRef = useRef<MapKitNamespace | null>(null);
    const mapRef = useRef<MKMap | null>(null);
    const overlaysRef = useRef<RouteOverlays | null>(null);
    const overlayTrekIdRef = useRef<string | null>(null);
    /**
     * The journey whose camera has already been framed once.
     *
     * Distinct from `overlayTrekIdRef`, which says "whose overlays are mounted" and is non-null from the
     * first framing onward — so a condition built on it alone is true for EVERY later framing too. That is
     * the defect this ref fixes: `isFirstFraming` used `overlayTrekIdRef.current !== null && !selectedCamp`,
     * which made deselecting a day snap the camera instead of animating back to the whole route, because
     * "no day selected" is exactly the deselect case as well as the arrival case.
     */
    const framedTrekIdRef = useRef<string | null>(null);
    const campsRef = useRef<Map<string, CampAnnotationEntry>>(new Map());
    const photoEntriesRef = useRef<Map<string, PhotoAnnotationEntry>>(new Map());

    // Callbacks and the latest props, read through refs so the map's own long-lived listeners never close
    // over a stale render and never force the map to be rebuilt. Synced in an effect rather than assigned
    // during render — `react-hooks/refs` makes the latter an error, and rightly: a ref written during render
    // is not a value React can reason about. Declared FIRST so it runs before the effects that read it.
    const callbackRef = useRef({
        onCampSelect, onPhotoClick, onPhotoLocationUpdate, getMediaUrl,
        onViewportChange, onViewportVisiblePhotoIdsChange,
    });
    const photosRef = useRef(photos);
    const editModeRef = useRef(editMode);
    const selectedCampIdRef = useRef<string | null>(selectedCamp?.id ?? null);
    // Layout inputs for `chromeState`. Initial values come from useRef's argument, so the init effect's
    // first read is already correct; updates are synced in the effect below and NEVER assigned during
    // render — this file's header says why, and I got it wrong once before fixing it: `react-hooks/refs`
    // makes a render-time ref write an error, and rightly.
    const signedInRef = useRef(signedIn);
    const selectedTrekIdRef = useRef<string | null>(selectedTrek?.id ?? null);

    useEffect(() => {
        callbackRef.current = {
            onCampSelect, onPhotoClick, onPhotoLocationUpdate, getMediaUrl,
            onViewportChange, onViewportVisiblePhotoIdsChange,
        };
        photosRef.current = photos;
        editModeRef.current = editMode;
        selectedCampIdRef.current = selectedCamp?.id ?? null;
        // Layout inputs, read by `chromeState` below. They live here rather than in their own effect so
        // there is exactly one place that answers "which props are read through a ref".
        signedInRef.current = signedIn;
        selectedTrekIdRef.current = selectedTrek?.id ?? null;
    }, [
        onCampSelect, onPhotoClick, onPhotoLocationUpdate, getMediaUrl,
        onViewportChange, onViewportVisiblePhotoIdsChange, photos, editMode, selectedCamp,
        signedIn, selectedTrek,
    ]);

    /* ---------------------------------------------------------- camera queue */

    const queueRef = useRef<CameraQueue<Region> | null>(null);
    /** The camp the camera is heading for. Mirrors `pendingHighlightCampIdRef` (`useMapbox.ts:968-991`). */
    const pendingCampIdRef = useRef<string | null>(null);

    /**
     * Issue a camera change through the coalescing queue.
     *
     * Never call `setRegionAnimated` directly: MapKit drops a mid-flight request and keeps flying to the
     * earlier target, so bypassing the queue reintroduces the stale-day defect. See `./cameraQueue.ts`.
     */
    const requestCamera = useCallback((region: Region, animate = true) => {
        queueRef.current?.request(region, animate);
    }, []);

    /**
     * The layout state the attribution lift and the framing both depend on.
     *
     * `panelOpen` is "a journey is selected", which is the condition `AkashicApp` mounts the desktop sidebar /
     * mobile sheet on (`AkashicApp.tsx:205`). It matters because that panel covers the corner Apple paints
     * into — see `./chrome.ts` for the measurement and for why the incumbent pads the wrong side.
     */
    /**
     * Read through a ref, and the reason is a defect this shape already caused.
     *
     * When `chromeState` depended on `[signedIn, selectedTrek]` it changed identity on every journey
     * selection, which made `syncPhotos` change, which made the INIT EFFECT re-run — and that effect's
     * cleanup calls `map.destroy()`. So selecting a journey tore the whole MapKit map down and rebuilt it:
     * measured, 1 → 2 → 3 constructions with 2 destroys across two selections in jsdom, and in a real browser
     * `.mk-map-view` was removed and re-added with the original node gone. It self-heals — five overlays and
     * the markers come back — which is exactly why no assertion caught it, and why the effect's own comment
     * confidently claimed the map "must be built once and never on a prop change" while the code did the
     * opposite. The cost was a full teardown plus a satellite-tile reload and a fresh `map-node-ready` wait
     * (915–1101 ms, this adapter's own measurement) on every journey switch and every sign-in.
     *
     * Refs make this callback genuinely stable, so `syncPhotos` is stable too and the map is built once. The
     * price is that effects which SHOULD react to a layout change no longer do so via this identity, so they
     * name `signedIn` and `selectedTrek` explicitly. `syncPhotos` deliberately does not: it is called
     * imperatively and reads the current values here.
     */
    const chromeState = useCallback(() => ({
        signedOut: !signedInRef.current,
        isMobile: isMobileViewport(),
        panelOpen: selectedTrekIdRef.current !== null,
    }), []);

    /* ---------------------------------------------------------- viewport reporting */

    const containerPx = useCallback((): ContainerPx | null => {
        const element = containerRef.current;
        if (!element) return null;
        const { clientWidth, clientHeight } = element;
        if (!(clientWidth > 0) || !(clientHeight > 0)) return null;
        return { width: clientWidth, height: clientHeight };
    }, [containerRef]);

    /**
     * Emit the visible area and the visible photo ids.
     *
     * Bounds come from converting the container's four corners, **not** from
     * `map.region.toBoundingRegion()`. With the attribution padding set, `map.region` is the INSET rect —
     * measured, `latitudeDelta` 0.021000 → 0.017371 for an 80 px bottom padding on a 463 px container — so
     * `toBoundingRegion()` reports a viewport shorter than what is painted and photos near the bottom edge
     * would be filtered out of `PhotosTab`. Mapbox's `getBounds()` is the full canvas; this matches it.
     *
     * The `west > east` case across the antimeridian is left un-normalised on purpose: `isWithinBounds`
     * handles it deliberately (`src/lib/map/types.ts:47-50`).
     */
    const emitViewport = useCallback(() => {
        const map = mapRef.current;
        const mapkit = mapkitRef.current;
        const element = containerRef.current;
        const box = containerPx();
        if (!map || !mapkit || !element || !box) return;

        const rect = element.getBoundingClientRect();
        const { onViewportChange: emitBounds, onViewportVisiblePhotoIdsChange: emitIds } = callbackRef.current;

        if (emitBounds) {
            const sw = map.convertPointOnPageToCoordinate(
                new DOMPoint(rect.left + window.scrollX, rect.bottom + window.scrollY));
            const ne = map.convertPointOnPageToCoordinate(
                new DOMPoint(rect.right + window.scrollX, rect.top + window.scrollY));
            // Same null-guard habit as the QUA-02 defect fix: skip the emit rather than emit garbage.
            if (sw && ne && Number.isFinite(sw.latitude) && Number.isFinite(ne.latitude)) {
                emitBounds([toLngLat(sw), toLngLat(ne)]);
            }
        }

        if (emitIds) {
            const visible: string[] = [];
            for (const photo of photosRef.current) {
                if (!photo.coordinates || photo.coordinates.length !== 2) continue;
                const point = map.convertCoordinateToPointOnPage(
                    new mapkit.Coordinate(photo.coordinates[1], photo.coordinates[0]));
                if (!point) continue;
                // convertCoordinateToPointOnPage returns PAGE coordinates; the margin test is
                // container-relative, so subtract the container's own offset.
                const local = {
                    x: point.x - (rect.left + window.scrollX),
                    y: point.y - (rect.top + window.scrollY),
                };
                if (visibleInPaddedBox(local, box, VISIBLE_MARGIN_PX)) visible.push(photo.id);
            }
            emitIds(visible);
        }
    }, [containerPx, containerRef]);

    /* ---------------------------------------------------------- photo markers */

    /**
     * Regroup and re-diff the photo stacks for the current camera.
     *
     * Replaces the incumbent's `zoomend` + `moveend` pair with `region-change-end`, and its 2600 ms creation
     * deferral (`useMapbox.ts:1317`) with nothing at all: that timer existed to stop marker creation fighting
     * a terrain-and-pitch flight, and MapKit has neither. The measured flight is ~270 ms, so there is no
     * window worth deferring into.
     */
    const syncPhotos = useCallback(() => {
        const map = mapRef.current;
        const mapkit = mapkitRef.current;
        const box = containerPx();
        if (!map || !mapkit || !box) return;

        const all = photosRef.current;
        if (all.length === 0) {
            removeAllAnnotations(map, photoEntriesRef.current);
            return;
        }

        const region: Region = {
            center: toLngLat(map.region.center),
            latitudeDelta: map.region.span.latitudeDelta,
            longitudeDelta: map.region.span.longitudeDelta,
        };
        // Inset width, not container width: map.region describes the padded rect, so dividing by the full
        // width would understate the zoom and coarsen the photo grid by a level or more.
        const attribution = attributionPadding(chromeState());
        const zoom = Math.round(
            synthesizeZoom(region, box.width - attribution.left - attribution.right));
        const padded = padBounds(
            [[region.center[0] - region.longitudeDelta / 2, region.center[1] - region.latitudeDelta / 2],
             [region.center[0] + region.longitudeDelta / 2, region.center[1] + region.latitudeDelta / 2]],
            MARKER_PREFILTER_PAD_DEG,
        );
        const nearby = all.filter(p =>
            p.coordinates && p.coordinates.length === 2 && withinBounds(p.coordinates as LngLat, padded));

        const callbacks: PhotoCallbacks = {
            onPhotoClick: (photo) => callbackRef.current.onPhotoClick?.(photo),
            onLocationUpdate: callbackRef.current.onPhotoLocationUpdate,
            getMediaUrl: callbackRef.current.getMediaUrl,
        };
        syncPhotoAnnotations(
            mapkit, map, photoEntriesRef.current,
            groupPhotosByLocation(nearby, zoom),
            selectedCampIdRef.current, editModeRef.current, callbacks,
        );
    }, [containerPx, chromeState]);

    /* ---------------------------------------------------------- init / teardown */

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        if (!token) return;   // reported through the derived `error` above

        let cancelled = false;
        let map: MKMap | null = null;
        let settledHandler: (() => void) | null = null;

        loadMapKit(token).then((mapkit) => {
            if (cancelled) return;
            mapkitRef.current = mapkit;

            map = new mapkit.Map(element, {
                mapType: mapkit.Map.MapTypes.Satellite,
                colorScheme: mapkit.Map.ColorSchemes.Dark,
                showsMapTypeControl: false,
                showsZoomControl: false,
                showsUserLocationControl: false,
                showsCompass: mapkit.FeatureVisibility.Hidden,
                showsScale: mapkit.FeatureVisibility.Hidden,
                showsPointsOfInterest: false,
                // MAP-03 stays north-up. MapKit's rotation sign convention against Mapbox's getBearing() is
                // unmeasured and NOTHING in the suite asserts on bearing, so a wrong sign would ship as a
                // cosmetic bug no gate catches; and a rotated fit is materially harder maths than an
                // axis-aligned one, which is exactly the framing the imagery gate depends on. So
                // `camp.bearing` and `trekConfig.preferredBearing` go unread — a narrowing of the survey's
                // "nice-to-have", to be revisited with a measurement rather than inside this task.
                isRotationEnabled: false,
            });
            mapRef.current = map;

            const built = map;
            queueRef.current = new CameraQueue<Region>({
                issue: (region, animate) => {
                    if (animate) built.setRegionAnimated(regionOf(mapkit, region), true);
                    else built.region = regionOf(mapkit, region);
                },
                watchdogMs: CAMERA_WATCHDOG_MS,
            });

            settledHandler = () => {
                // `settled()` returns false when it drained a queued move, i.e. the camera is off again.
                // Re-emitting the viewport and regrouping markers mid-way to another target is wasted work and
                // reports a frame nobody is looking at.
                if (!queueRef.current?.settled()) return;
                emitViewport();
                syncPhotos();
            };
            map.addEventListener(assertKnownEvent(EVENTS_USED.cameraSettled), settledHandler);
            map.addEventListener(assertKnownEvent(EVENTS_USED.ready), () => {
                if (!cancelled) setReady(true);
            });
        }).catch((cause: Error) => {
            if (!cancelled) setLoadError(cause.message);
        });

        // Captured here rather than read in the cleanup: the registries are stable Map instances for the
        // life of the hook, and reading `.current` inside a cleanup is the pattern React's lint rule warns
        // about because the ref can point somewhere else by then.
        const campRegistry = campsRef.current;
        const photoRegistry = photoEntriesRef.current;

        return () => {
            cancelled = true;
            queueRef.current?.dispose();
            queueRef.current = null;
            if (map) {
                if (settledHandler) {
                    map.removeEventListener(EVENTS_USED.cameraSettled, settledHandler);
                }
                removeAllAnnotations(map, campRegistry, photoRegistry);
                if (overlaysRef.current) removeRouteOverlays(map, overlaysRef.current);
                map.destroy();
            }
            overlaysRef.current = null;
            overlayTrekIdRef.current = null;
            // Reset with the overlays: after a teardown the next framing is genuinely an arrival on a
            // default camera again, so it must be instant rather than a swoop from wherever we were.
            framedTrekIdRef.current = null;
            mapRef.current = null;
            setReady(false);
        };
        // emitViewport / syncPhotos are stable (useCallback with stable deps); the map must be built once and
        // never on a prop change.
    }, [containerRef, token, emitViewport, syncPhotos]);

    /* ---------------------------------------------------------- attribution padding */

    /**
     * Apple's logo and Legal link are painted onto a canvas with no DOM to select, so the only way to keep
     * them clear of the signed-out showcase's bottom chips is `map.padding`. See `./chrome.ts` for the
     * measurement, and note this cannot be a stylesheet rule: `.public-chrome` depends on auth state.
     */
    useEffect(() => {
        const map = mapRef.current;
        const mapkit = mapkitRef.current;
        if (!map || !mapkit || !ready) return;
        map.padding = new mapkit.Padding(attributionPadding(chromeState()));
        // `signedIn` / `selectedTrek` are named explicitly because `chromeState` is now ref-backed and
        // therefore stable — see its comment. Without them this would stop reacting to the panel opening.
    }, [ready, chromeState, signedIn, selectedTrek]);

    /* ---------------------------------------------------------- route overlays */

    useEffect(() => {
        const map = mapRef.current;
        const mapkit = mapkitRef.current;
        if (!map || !mapkit || !ready) return;

        const trekId = selectedTrek?.id ?? null;
        if (overlayTrekIdRef.current === trekId) return;

        if (overlaysRef.current) {
            removeRouteOverlays(map, overlaysRef.current);
            overlaysRef.current = null;
        }
        overlayTrekIdRef.current = trekId;

        const coordinates = trekData?.route?.coordinates;
        if (!trekId || !coordinates?.length) return;
        overlaysRef.current = addRouteOverlays(mapkit, map, coordinates);
    }, [ready, selectedTrek, trekData]);

    /* ---------------------------------------------------------- camps */

    useEffect(() => {
        const map = mapRef.current;
        const mapkit = mapkitRef.current;
        if (!map || !mapkit || !ready) return;
        syncCampAnnotations(
            mapkit, map, campsRef.current, trekData?.camps ?? [], selectedCamp?.id ?? null,
            (camp) => callbackRef.current.onCampSelect?.(camp),
        );
    }, [ready, trekData, selectedCamp]);

    /* ---------------------------------------------------------- photos */

    useEffect(() => {
        if (!ready) return;
        syncPhotos();
    }, [ready, photos, selectedCamp, editMode, syncPhotos]);

    /* ---------------------------------------------------------- camera */

    /**
     * Build the region for the current selection. Pure, given the container size — which is what makes the
     * framing testable in vitest rather than only in a browser.
     *
     * The three cases mirror `flyToTrek` (`useMapbox.ts:952-1170`):
     *   - a journey with no day       → fit the whole route's own bounds
     *   - a day on its route (≤10 km) → fit that day's segment, clamped at zoom 16
     *   - a day off its route         → centre on the camp at zoom 15 (14.5 mobile)
     *
     * The first case is the one the imagery gate makes non-negotiable: frame from ROUTE BOUNDS, never a fixed
     * wide zoom. At ~20 m/px over the Khumbu, Apple's mosaic carries heavy cloud; a trek's route bounds are
     * tighter than its massif and land where Apple is at parity or better.
     *
     * QUA-47: **route bounds alone were not enough**, and the live site proved it — a route spanning a few
     * hundred metres fits to a resolution no imagery has, and the featureless brown smear that produced was
     * the same defect as the cloudy mosaic seen from the other end. Every branch below therefore passes
     * `APPLE_SATELLITE_BAND`; `../imagery.ts` carries the ladder measurement that set its two numbers, and
     * `./camera.ts` explains why the fit gets the floor only.
     */
    const regionForSelection = useCallback((): Region | null => {
        const box = containerPx();
        if (!box || !trekData) return null;
        const layout = chromeState();
        const isMobile = layout.isMobile;
        const attribution = attributionPadding(layout);
        const imagery = { ...APPLE_SATELLITE_BAND, devicePixelRatio: deviceScale() };

        if (!selectedCamp) {
            const bounds = boundsOfRoute(trekData.route?.coordinates ?? []);
            if (!bounds) return null;
            return regionForBounds(bounds, {
                container: box,
                framePadding: arrivalFramePadding({ isMobile }),
                attributionPadding: attribution,
                // Also what stops a single-point route asking for infinite zoom: the floor bounds the scale
                // from below, which is the job `maxZoom: DAY_FIT_MAX_ZOOM` used to do here.
                imagery,
            });
        }

        const segment = daySegment(trekData.route, trekData.camps, selectedCamp.id);
        if (segment && !segment.offRoute) {
            const slice = trekData.route.coordinates.slice(segment.startIndex, segment.endIndex + 1);
            const bounds = boundsOfCoordinates(slice);
            if (bounds) {
                return regionForBounds(bounds, {
                    container: box,
                    framePadding: dayFramePadding({ isMobile }),
                    attributionPadding: attribution,
                    imagery,
                });
            }
        }

        return regionForZoom(selectedCamp.coordinates, offRouteZoom({ isMobile }), {
            container: box,
            attributionPadding: attribution,
            imagery,
        });
    }, [containerPx, chromeState, selectedCamp, trekData]);

    useEffect(() => {
        if (!ready || !mapRef.current) return;

        pendingCampIdRef.current = selectedCamp?.id ?? null;

        const region = regionForSelection();
        if (!region) return;

        // The first framing OF THIS JOURNEY is instant: MapKit starts on its own default camera, and
        // animating from there is a meaningless several-thousand-kilometre swoop. Every later framing
        // animates, including the one that follows deselecting a day.
        //
        // The condition was `overlayTrekIdRef.current !== null && !selectedCamp`, and both halves were
        // wrong for this purpose: `overlayTrekIdRef` is non-null from the first framing onward, and "no
        // day selected" is the DESELECT case as much as the arrival case — so deselecting a day snapped
        // the camera. The `selectedCamp` term is gone entirely: arriving on a deep link with a day already
        // chosen is still an arrival and should still be instant.
        const isFirstFramingOfThisJourney = overlayTrekIdRef.current !== null
            && framedTrekIdRef.current !== overlayTrekIdRef.current
            && queueRef.current?.pending !== true;
        requestCamera(region, !isFirstFramingOfThisJourney);
        if (overlayTrekIdRef.current !== null) framedTrekIdRef.current = overlayTrekIdRef.current;

        // The highlight is applied with the camera request, and re-checked against the pending camp so a
        // superseded day never paints its segment. Same guard as `useMapbox.ts:1105`.
        const overlays = overlaysRef.current;
        if (!overlays) return;
        if (!selectedCamp) {
            setActiveSegment(overlays, null);
            return;
        }
        const segment = trekData ? daySegment(trekData.route, trekData.camps, selectedCamp.id) : null;
        const fractions = segment && trekData
            ? strokeFractions(trekData.route.coordinates, segment.startIndex, segment.endIndex)
            : null;
        if (pendingCampIdRef.current === selectedCamp.id) setActiveSegment(overlays, fractions);
    }, [ready, selectedCamp, selectedTrek, trekData, regionForSelection, requestCamera]);

    /* ---------------------------------------------------------- container resize */

    useEffect(() => {
        const element = containerRef.current;
        if (!element || !ready || typeof ResizeObserver === 'undefined') return;
        // MapKit has no `resize` event, and the incumbent listens for Mapbox's. A ResizeObserver is
        // engine-independent and also catches the side panel opening, which no map event would.
        const observer = new ResizeObserver(() => emitViewport());
        observer.observe(element);
        return () => observer.disconnect();
    }, [containerRef, ready, emitViewport]);

    useEffect(() => {
        if (ready) emitViewport();
    }, [ready, photos, emitViewport]);

    /* ---------------------------------------------------------- imperative API */

    const flyToPhoto = useCallback((photo: Photo) => {
        const box = containerPx();
        if (!box || !photo.coordinates || photo.coordinates.length !== 2) return;
        // Mapbox lands here at pitch 45. MapKit has no tilt, so the flight is flat — see the file header.
        requestCamera(regionForZoom(photo.coordinates as LngLat, PHOTO_ZOOM, {
            container: box,
            attributionPadding: attributionPadding(chromeState()),
            // QUA-47: 16 is the request. A photo taken far north lands wider than 16, because that is where
            // the imagery stops — a sharp pin over a magnified smear is not a better answer than a wider frame.
            imagery: { ...APPLE_SATELLITE_BAND, devicePixelRatio: deviceScale() },
        }));
    }, [containerPx, requestCamera, chromeState]);

    /**
     * The "Recenter map" quick action (`AkashicApp.tsx:231-239`).
     *
     * Only the two journey-view branches of the incumbent's four-way behaviour
     * (`src/components/MapboxGlobe.tsx:344-380`) live here: trek + camp, and trek + no camp. The globe
     * branches belong to whichever surface owns `view === 'globe'`.
     */
    const recenter = useCallback(() => {
        const region = regionForSelection();
        if (region) requestCamera(region);
    }, [regionForSelection, requestCamera]);

    const getCameraState = useCallback((): MapCameraState => {
        const map = mapRef.current;
        const box = containerPx();
        if (!map || !box) return EMPTY_CAMERA_STATE;
        const attribution = attributionPadding(chromeState());
        return {
            // `map.center` tracks the LIVE animating camera — measured; see MapCameraState's own comment.
            cameraCenter: toLngLat(map.center),
            cameraZoom: synthesizeZoom(
                { longitudeDelta: map.region.span.longitudeDelta },
                box.width - attribution.left - attribution.right,
            ),
            cameraBearing: map.rotation,
            pendingHighlightCampId: pendingCampIdRef.current,
            hasPendingAnimations: queueRef.current?.pending === true,
        };
    }, [containerPx, chromeState]);

    return { ready, error, flyToPhoto, recenter, getCameraState };
}

/** Re-exported for the pure fit test, which needs the same projector the hook reasons with. */
export { projectToPixels };
