/**
 * The landing globe: a rotating sphere with a pin per published journey, drawn by us. (MAP-02)
 *
 * ## No vendor, no token, and that is the feature
 *
 * There is no map service here, no tile server, no SDK and no API key. `src/lib/map/boundary.test.ts`
 * asserts mechanically that nothing under `src/lib/globe/` or this file so much as names one, so the
 * promise is checked rather than commented.
 *
 * The reason is not only that MapKit JS has no globe — measured in the shipped binary: zero occurrences
 * of `globe`, `orthographic`, `pitch` or `tilt`, so this screen could not come from Apple's web map at
 * any price. It is that **the landing screen is the wrong place to have a runtime dependency at all.**
 * On the day a MapKit token lapses or a tile host has an outage, a visitor still sees a rotating Earth
 * rather than a void. That is why `MapErrorFallback` and the whole missing-token path that
 * `MapboxGlobe.tsx` needs have no counterpart here: deleting that path IS the task.
 *
 * ## Where the parts live
 *
 * Almost all of the arithmetic is outside this file on purpose — `src/lib/globe/projection.ts`,
 * `horizon.ts`, `camera.ts` — because the unit suite runs in jsdom, where `getContext('2d')` returns
 * null, and this project has been burned repeatedly by code that no tool executes. This component is the
 * thin shell: a canvas, a requestAnimationFrame loop, and the event wiring. The subtle parts are pure
 * functions with tests.
 *
 * ## What it deliberately does not do
 *
 * Zoom, pitch and bearing gestures are dropped (there is no imagery to reward zooming), and with them
 * the ~100 lines of interrupted-flight recovery the Mapbox hook needs — see `camera.ts`. Route lines,
 * camp/photo/POI markers, the POI popup and viewport emission are all trek-view behaviour; the
 * corresponding props are accepted to satisfy `VendorSurfaceProps` and ignored, exactly as the Mapbox
 * globe's own effects already early-returned on `view !== 'trek'`.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { VendorSurfaceProps } from '../lib/map/vendorSurface';
import type { MapCameraState } from '../lib/map/vendorSurface';
import { useJourneys } from '../contexts/JourneysContext';
import {
    GLOBE_HOME,
    clampLatitude,
    hitTestPins,
    prepareGeometry,
    projectGeometry,
    viewportFor,
    wrapLongitude,
    type GlobeGeometry,
    type ScreenPin,
} from '../lib/globe/projection';
import { loadCoastlineRings } from '../lib/globe/coastline';
import { drawGlobe, resizeCanvas } from '../lib/globe/render';
import {
    RETURN_DURATION_MS,
    SELECT_DURATION_MS,
    shortestLonDelta,
    tweenAt,
    type CameraTween,
} from '../lib/globe/camera';
import { SPACE_BACKGROUND, generateStarfield } from '../lib/globe/starfield';

/** Matches the Mapbox globe's `ROTATION_START_DELAY_MS`: the visitor sees the Earth still first. */
const ROTATION_START_DELAY_MS = 3500;
/** Degrees per second, westward. Same rates the Mapbox globe used. */
const ROTATION_DEG_PER_SEC_DESKTOP = 2;
const ROTATION_DEG_PER_SEC_MOBILE = 1.5;
/** Below this pointer travel a press is a click, not a drag. */
const DRAG_SLOP_PX = 4;

const isMobileDevice =
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

/** Generated once at module load, like the incumbent's, so screenshots are stable. */
const starfieldStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: SPACE_BACKGROUND,
    backgroundImage: generateStarfield(isMobileDevice),
    pointerEvents: 'none',
    zIndex: 0,
};

function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function AkashicGlobe({
    selectedTrek,
    onSelectTrek,
    view,
    recenterRef,
    onReadyChange,
    mapStateRef,
}: VendorSurfaceProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { treks } = useJourneys();

    // Rotation lives entirely in refs, with NO `isRotating` React state.
    //
    // The incumbent kept it in state so its scheduling effect could notice that a user interaction had
    // stopped the rotation and reschedule. That shape does not survive here: calling the setter from the
    // effect body is a `react-hooks/set-state-in-effect` warning, and the warning cap in this repo is at
    // 25 and full. It is also unnecessary — nothing renders from it. Instead the interaction handler that
    // stops rotation is the thing that reschedules it (see `interrupt`), which is a more direct statement
    // of the rule anyway: the reschedule belongs to the interruption, not to a re-render that observes it.
    const cameraRef = useRef({ ...GLOBE_HOME });
    const geometryRef = useRef<GlobeGeometry | null>(null);
    const pinsRef = useRef<ScreenPin[]>([]);
    const tweenRef = useRef<CameraTween | null>(null);
    const rotatingRef = useRef(false);
    const rotationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hoverRef = useRef<string | null>(null);
    const dirtyRef = useRef(true);
    const lastFrameRef = useRef(0);
    const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: number } | null>(null);

    // `treks` and `selectedTrek` are read inside the animation loop, which must not be re-created every
    // render — a new loop per render would double-draw. Refs carry the live values in instead.
    //
    // Synced in an effect rather than assigned during render: `react-hooks/refs` rejects a ref write in a
    // render body and is right to, because a render that React later throws away would still have
    // mutated it. After commit is the correct moment, and the loop only reads these between frames.
    const treksRef = useRef(treks);
    const selectedIdRef = useRef<string | null>(selectedTrek?.id ?? null);
    useEffect(() => {
        treksRef.current = treks;
        selectedIdRef.current = selectedTrek?.id ?? null;
        dirtyRef.current = true;
    }, [treks, selectedTrek]);

    /** Stop rotating and cancel any pending start. */
    const stopRotation = useCallback(() => {
        rotatingRef.current = false;
        if (rotationTimerRef.current) {
            clearTimeout(rotationTimerRef.current);
            rotationTimerRef.current = null;
        }
    }, []);

    /**
     * Arm the 3.5 s delay before rotation begins, unless it is already armed or already running.
     *
     * The guard is what keeps rule 5 of `src/hooks/useGlobeRotation.test.ts` true — re-running the effect
     * must not schedule a duplicate timer, and must not keep pushing the start further away either, which
     * a clear-and-reset would do on every render.
     */
    const scheduleRotation = useCallback(() => {
        if (rotationTimerRef.current || rotatingRef.current) return;
        rotationTimerRef.current = setTimeout(() => {
            rotationTimerRef.current = null;
            // A full-screen element that moves forever with no way to stop it is an accessibility defect.
            // The incumbent does not honour this; new code should. Not parity — correct.
            if (prefersReducedMotion()) return;
            rotatingRef.current = true;
        }, ROTATION_START_DELAY_MS);
    }, []);

    // ---- the frame loop ---------------------------------------------------------------------------
    const paint = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const cssW = container.clientWidth || 1;
        const cssH = container.clientHeight || 1;
        if (resizeCanvas(canvas, cssW, cssH)) dirtyRef.current = true;

        const camera = cameraRef.current;
        const geometry = geometryRef.current;
        if (geometry) projectGeometry(geometry, camera);

        pinsRef.current = drawGlobe(ctx, {
            width: cssW,
            height: cssH,
            viewport: viewportFor(cssW, cssH),
            camera,
            geometry,
            treks: treksRef.current,
            selectedId: selectedIdRef.current,
            hoverId: hoverRef.current,
        });
    }, []);

    /**
     * First paint, and readiness — done HERE and not from the animation loop.
     *
     * MEASURED, and it caught a real defect: `requestAnimationFrame` does not fire at all while
     * `document.visibilityState === 'hidden'`. The first version of this component painted and reported
     * readiness from inside its rAF loop, and in a hidden tab that gave **zero rAF callbacks and
     * `isMapReady() === false` indefinitely** — verified over 9 seconds with the loop instrumented.
     *
     * That is not a cosmetic problem. `openApp()` in the e2e suite hard-fails after 15 s if readiness
     * never arrives, and it is the entry point of every spec file, so the whole suite would have gone red
     * with an error pointing at the map rather than at the scheduler. A backgrounded or prerendered first
     * load would have done the same thing to a real visitor.
     *
     * So the first frame is painted synchronously on mount and readiness is reported immediately. The rAF
     * loop below is only an animation driver; nothing depends on it having run.
     *
     * Readiness is reported straight through `onReadyChange` rather than via React state: it is a one-way
     * edge, nothing here renders from it, and a `setReady` in an effect body is a
     * `react-hooks/set-state-in-effect` warning this repo has no budget for (the cap is 25 and full).
     *
     * No `false` on unmount, matching `MapKitJourneyMap`: the surface that mounts next reports its own
     * readiness, and flapping the flag during a view swap would only give the suite a window to race.
     */
    useEffect(() => {
        paint();
        onReadyChange?.(true);
    }, [paint, onReadyChange]);

    useEffect(() => {
        let raf = 0;
        const tick = (now: number) => {
            raf = requestAnimationFrame(tick);

            const dt = lastFrameRef.current ? (now - lastFrameRef.current) / 1000 : 0;
            lastFrameRef.current = now;

            const tween = tweenRef.current;
            if (tween) {
                const at = tweenAt(tween, now);
                cameraRef.current.lon = wrapLongitude(at.lon);
                cameraRef.current.lat = at.lat;
                if (at.done) tweenRef.current = null;
                dirtyRef.current = true;
            } else if (rotatingRef.current && dt > 0) {
                // Westward, i.e. longitude decreasing — the direction the incumbent turned. `dt` is capped
                // so that returning to a backgrounded tab does not jump the globe by however many seconds
                // it spent hidden.
                const rate = isMobileDevice ? ROTATION_DEG_PER_SEC_MOBILE : ROTATION_DEG_PER_SEC_DESKTOP;
                cameraRef.current.lon = wrapLongitude(cameraRef.current.lon - rate * Math.min(dt, 0.1));
                dirtyRef.current = true;
            }

            if (!dirtyRef.current) return;
            dirtyRef.current = false;
            paint();
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [paint]);

    // ---- geometry, after first paint --------------------------------------------------------------
    // Deliberately not awaited before reporting ready: the sphere, the atmosphere and the pins are all
    // drawn without it, so a slow connection shows a rotating Earth immediately and the continents fill
    // in. See `coastline.ts` for why the chunk is still precached.
    useEffect(() => {
        let cancelled = false;
        loadCoastlineRings()
            .then(rings => {
                if (cancelled) return;
                geometryRef.current = prepareGeometry(rings);
                dirtyRef.current = true;
            })
            .catch(() => {
                // A missing coastline chunk costs the continents, not the screen. Leaving `geometry`
                // null draws an unmarked ocean sphere with the journey pins still in the right places,
                // which is the whole point of not having a vendor: there is no failure that blanks this.
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // ---- rotation scheduling ---------------------------------------------------------------------
    // The rules are the six already pinned by `src/hooks/useGlobeRotation.test.ts`, kept identical so
    // that the documented behaviour of the landing screen does not quietly change with the renderer:
    // start 3.5 s after entering globe view with nothing selected, stop on selection or view change, do
    // not double-schedule, and reschedule after a user interaction stopped it.
    useEffect(() => {
        if (view === 'globe' && !selectedTrek) scheduleRotation();
        else stopRotation();

        // Unmount and every dependency change cancel the pending start, so a journey selected during the
        // 3.5 s window cannot have the globe start turning underneath it a moment later.
        return stopRotation;
    }, [view, selectedTrek, scheduleRotation, stopRotation]);

    // ---- camera follows the selection ------------------------------------------------------------
    useEffect(() => {
        const from = cameraRef.current;
        const target = selectedTrek
            ? { lon: selectedTrek.lng, lat: clampLatitude(selectedTrek.lat) }
            : GLOBE_HOME;

        // Already framed on the target — which is the case on first mount, where the camera starts at
        // GLOBE_HOME and nothing is selected. Skipping the tween matters for more than tidiness: a no-op
        // tween would report `hasPendingAnimations: true` for its full three seconds and, because the loop
        // gives a tween priority over rotation, would silently push the first turn of the globe out.
        if (
            Math.abs(shortestLonDelta(from.lon, target.lon)) < 0.01 &&
            Math.abs(from.lat - target.lat) < 0.01
        ) {
            return;
        }

        tweenRef.current = {
            fromLon: from.lon,
            fromLat: from.lat,
            toLon: target.lon,
            toLat: target.lat,
            startedAt: performance.now(),
            durationMs: selectedTrek ? SELECT_DURATION_MS : RETURN_DURATION_MS,
        };
    }, [selectedTrek]);

    // ---- the always-visible Recenter button ------------------------------------------------------
    // `QuickActionBar`'s "Recenter map" is visible at the landing view too, so leaving this ref null
    // ships a dead button on the first screen. Same behaviour the Mapbox globe had: stop rotating, then
    // turn to the selected journey, or select the FIRST one if nothing is selected — deliberately
    // "first" and not "nearest", because nearest is meaningless mid-rotation.
    useEffect(() => {
        if (!recenterRef) return;
        recenterRef.current = () => {
            if (treks.length === 0) return;
            stopRotation();     // cancels the pending start too
            if (selectedTrek) {
                tweenRef.current = {
                    fromLon: cameraRef.current.lon,
                    fromLat: cameraRef.current.lat,
                    toLon: selectedTrek.lng,
                    toLat: clampLatitude(selectedTrek.lat),
                    startedAt: performance.now(),
                    durationMs: SELECT_DURATION_MS,
                };
            } else {
                onSelectTrek(treks[0]);
            }
        };
        return () => {
            if (recenterRef) recenterRef.current = null;
        };
    }, [recenterRef, treks, selectedTrek, onSelectTrek, stopRotation]);

    // ---- camera state for the e2e suite ----------------------------------------------------------
    useEffect(() => {
        if (!mapStateRef) return;
        const getState = (): MapCameraState => ({
            cameraCenter: [cameraRef.current.lon, cameraRef.current.lat],
            // No zoom and no bearing exist on this surface, and reporting invented numbers would give a
            // future spec something false to assert on.
            cameraZoom: null,
            cameraBearing: null,
            pendingHighlightCampId: null,
            // ONLY a tween counts. Auto-rotation moves `cameraCenter` every frame, and reporting that as
            // a pending animation would deadlock the first spec that ever calls `waitForCameraSettled`
            // at the landing view — it requires this false AND the centre still for three polls, so the
            // spec would hang for its full 10 s timeout and then blame the camera rather than the
            // rotation. Nothing asserts on camera state at globe view today; this keeps it that way by
            // design rather than by luck.
            hasPendingAnimations: tweenRef.current !== null,
        });
        mapStateRef.current = getState;
        return () => {
            mapStateRef.current = null;
        };
    }, [mapStateRef]);

    // ---- pointer handling ------------------------------------------------------------------------
    /** Container-relative CSS pixels. Never device pixels — see `hitTestPins`. */
    const localPoint = (e: React.PointerEvent | React.MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    /**
     * A user touched the globe: stop moving it for them, and abandon any camera flight in progress.
     *
     * Then re-arm the delay if the landing view is still idle, which is rule 4 of
     * `src/hooks/useGlobeRotation.test.ts` ("rotation restarts after user interaction stops it"). The
     * incumbent achieved this by bouncing through React state so its effect could observe the stop; here
     * the interruption reschedules itself directly, which is both simpler and one fewer render.
     */
    const interrupt = useCallback(() => {
        stopRotation();
        tweenRef.current = null;
        if (view === 'globe' && !selectedTrek) scheduleRotation();
    }, [stopRotation, scheduleRotation, view, selectedTrek]);

    const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        interrupt();
        dragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) {
            // Not dragging: hover feedback only, which needs the same hit test the click needs and is
            // therefore nearly free.
            const p = localPoint(e);
            const hit = hitTestPins(pinsRef.current, p.x, p.y);
            if (hit !== hoverRef.current) {
                hoverRef.current = hit;
                dirtyRef.current = true;
                // Set the cursor imperatively rather than deriving it from a ref in the render body.
                // A ref read during render is both a `react-hooks/refs` error and useless — nothing
                // re-renders when a ref changes, so the cursor would simply never update.
                e.currentTarget.style.cursor = hit ? 'pointer' : 'grab';
            }
            return;
        }

        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        drag.x = e.clientX;
        drag.y = e.clientY;

        // Drag-to-spin. A globe that ignores your finger reads as a broken video, and this is what makes
        // the pins feel reachable. Scaled by the sphere radius so a drag tracks the surface under the
        // pointer rather than moving a fixed number of degrees per pixel at every size.
        const container = containerRef.current;
        if (!container) return;
        const vp = viewportFor(container.clientWidth || 1, container.clientHeight || 1);
        const perPx = 90 / vp.radius;
        cameraRef.current.lon = wrapLongitude(cameraRef.current.lon - dx * perPx);
        cameraRef.current.lat = clampLatitude(cameraRef.current.lat + dy * perPx);
        dirtyRef.current = true;
    };

    const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const drag = dragRef.current;
        dragRef.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        if (!drag || drag.moved > DRAG_SLOP_PX) return;

        const p = localPoint(e);
        const hit = hitTestPins(pinsRef.current, p.x, p.y);
        if (!hit) return;
        const trek = treksRef.current.find(t => t.id === hit);
        if (trek) onSelectTrek(trek);
    };

    return (
        <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
            {/* Static CSS starfield. NOT a second canvas — see src/lib/globe/starfield.ts. */}
            <div style={starfieldStyle} />
            <canvas
                ref={canvasRef}
                data-testid="akashic-globe"
                aria-label="Rotating globe showing published journeys"
                role="img"
                style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 1,
                    touchAction: 'none',
                    // Updated imperatively on hover — see onPointerMove.
                    cursor: 'grab',
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onWheel={interrupt}
            />
        </div>
    );
}
