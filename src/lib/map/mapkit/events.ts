/**
 * A pinned allowlist of MapKit event names, and the assertion that uses it. (MAP-03)
 *
 * ## Why a whole file for this
 *
 * **A misspelled MapKit event name is accepted silently and fires never.** Measured 2026-07-27
 * (`scripts/mapkit/surface-probe/?probe=ready`): `map.addEventListener` was called with `load`, `ready`,
 * `idle`, `render`, `tiles-loaded` and `this-name-is-not-real`. No throw, no console warning, no `error`
 * event — and zero fires for all six.
 *
 * That is exactly the failure shape `CLAUDE.md` records for `XCUIElement.waitForExistence`: a listener that
 * cannot fire is indistinguishable from a feature that is quiet. The camera-settling logic and the readiness
 * gate both hang on these names, and a typo in either would present as "MapKit is slow" — the most expensive
 * kind of bug to chase, because the obvious next move is to raise a timeout.
 *
 * So the adapter subscribes through {@link assertKnownEvent}, which throws on a name that is not in Apple's
 * own set. `events.test.ts` then checks the reverse direction: every name the adapter actually uses is in the
 * list. Between them, a typo fails in 5 s of vitest instead of surviving into Playwright.
 *
 * The list is Apple's complete public event set, read out of the shipped bundle's own event-name constant
 * table (5.81.65, build 26.13-41). Not everything in it is used or even verified to fire — `complete` is in
 * the table and was never observed firing on a map. It is here as the set of names that are *spelled right*,
 * not the set that works.
 */

/**
 * Every event name a MapKit **Map** dispatches, per the shipped bundle's own constant table.
 * Spelled right ≠ guaranteed to fire — see the header, and note `start-up-complete` in particular.
 */
export const MAPKIT_MAP_EVENT_NAMES = [
    'complete',
    'deselect',
    'double-tap',
    'error',
    'long-press',
    'map-node-change',
    'map-node-ready',
    'map-type-change',
    'region-change-end',
    'region-change-start',
    'rotation-change',
    'rotation-end',
    'rotation-start',
    'scroll-end',
    'scroll-start',
    'select',
    'single-tap',
    'start-up-complete',
    'user-location-change',
    'user-location-error',
    'zoom-end',
    'zoom-start',
] as const;

/**
 * Names dispatched by objects that are NOT the map: the `mapkit` namespace and individual annotations.
 *
 * Kept separate because the interesting mistake is using one of these on the wrong object. `drag-start` is a
 * real annotation event and fires never on a map; `configuration-change` is real on the namespace and fires
 * never on a map. Both are the invisible-no-op failure this file exists to prevent, so the guard accepts them
 * as spellings while `MAPKIT_MAP_EVENT_NAMES` stays the answer to "what can a map dispatch".
 */
export const MAPKIT_NON_MAP_EVENT_NAMES = [
    'configuration-change',   // the mapkit namespace, and ONLY if registered before mapkit.init
    'drag-start',             // annotation
    'dragging',               // annotation
    'drag-end',               // annotation
] as const;

export const MAPKIT_EVENT_NAMES = [
    ...MAPKIT_MAP_EVENT_NAMES,
    ...MAPKIT_NON_MAP_EVENT_NAMES,
] as const;

export type MapKitEventName = typeof MAPKIT_EVENT_NAMES[number];

const KNOWN = new Set<string>(MAPKIT_EVENT_NAMES);

/**
 * Throw unless `name` is a real MapKit event name.
 *
 * Deliberately a throw and not a warning. A warning in this position is worse than nothing: the listener
 * still never fires, and the thing it was supposed to drive still silently stops working.
 */
export function assertKnownEvent(name: string): MapKitEventName {
    if (!KNOWN.has(name)) {
        throw new Error(
            `"${name}" is not a MapKit JS event name. MapKit accepts any string and fires never, so this `
            + `would have been an invisible no-op. Known names: ${MAPKIT_EVENT_NAMES.join(', ')}`,
        );
    }
    return name as MapKitEventName;
}

/**
 * The names this adapter subscribes to, and why each one rather than an obvious-looking alternative.
 *
 * Exported so `events.test.ts` can assert the set is a subset of the allowlist, and so that the reasoning
 * below is somewhere a reader will find it before reaching for `start-up-complete`.
 */
export const EVENTS_USED = {
    /**
     * Readiness. NOT `start-up-complete`: measured at 952 ms, 26 264 ms, and once not at all within 9 s —
     * a factor of 27 across three runs on one machine. `map-node-ready` was 915–1101 ms every time.
     * `'loaded' in map` is false and there is no tile event, so this is as close to "ready" as MapKit gets.
     */
    ready: 'map-node-ready',
    /**
     * Camera settled. This is the only interruption mechanism MapKit has: nothing cancels an in-flight
     * animation, so a coalesced camera request is drained from here. See `./useMapKitJourney.ts`.
     */
    cameraSettled: 'region-change-end',
    /** Camera moving — used only to mirror the incumbent's `moveend`-driven photo regrouping cadence. */
    cameraMoving: 'region-change-start',
} as const;
