/**
 * A coalescing queue for camera moves, because MapKit cannot be interrupted. (MAP-03)
 *
 * ## The finding this exists for
 *
 * **Nothing interrupts an in-flight MapKit camera animation, and there is no `map.stop()`.**
 *
 * MEASURED 2026-07-27 (`scripts/mapkit/surface-probe/?probe=interrupt`), five interrupts each issued 120 ms
 * into a ~270 ms flight to target A, with B as the target the user actually wants:
 *
 *     setRegionAnimated(B, true)                        -> A won  (stale)
 *     map.region = B            (unanimated write)      -> A won  (stale)
 *     setRegionAnimated(B, false)                       -> A won  (stale)
 *     map.center = map.center.copy(), then animate to B -> A won  (stale)
 *     self-assign map.region,   then animate to B       -> A won  (stale)
 *     queue B and re-issue it on region-change-end      -> B won  (correct)
 *
 * `typeof map.stop` and `typeof map.cancelAnimation` are both `undefined`. A mid-flight camera request is
 * silently **dropped** — which on rapid day switching leaves the camera on a day the user has already left.
 * That is precisely the defect `e2e/day-navigation.spec.ts` exists to catch, and no unit test of the Mapbox
 * adapter would have predicted it, because Mapbox's `map.stop()` makes the problem not exist.
 *
 * The plan for MAP-03 assumed MapKit's animated setters supersede each other and said to verify it. They do
 * not. This is the deviation.
 *
 * ## Why a class rather than a `useCallback`
 *
 * Two reasons, and the second is the real one:
 *
 * 1. The drain is mutually recursive with the issue — a queued move is issued from the completion of the
 *    previous one, which arms a new watchdog, which may drain again. Expressed as a `useCallback` that calls
 *    itself from inside its own `setTimeout`, React's compiler correctly complains, and the workaround
 *    (a ref holding the function) is worse to read than the thing it hides.
 * 2. **It is testable.** The behaviour above is the highest-risk logic in the adapter and it is entirely
 *    decidable without a browser: given a fake clock and a recording sink, `cameraQueue.test.ts` proves that
 *    rapid switching lands on the LAST target and that the flag always clears. In a hook it would only ever
 *    have been exercised by Playwright.
 */

/** What the queue does to the map. One function, so the tests need no MapKit at all. */
export type CameraSink<T> = (target: T, animate: boolean) => void;

export interface CameraQueueOptions<T> {
    issue: CameraSink<T>;
    /**
     * How long to wait for a settle signal before assuming the move finished.
     *
     * **Load-bearing, not defensive.** MEASURED: a no-op animated set — same centre, same span — fires
     * ZERO `region-change-end` events. Without this timeout the in-flight flag sticks `true`,
     * `getMapState().hasPendingAnimations` never clears, and `e2e/utils/test-helpers.ts:325` — which requires
     * it `false` before counting a stable poll — deadlocks the entire Playwright suite.
     */
    watchdogMs: number;
    setTimeoutFn?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class CameraQueue<T> {
    private readonly issue: CameraSink<T>;
    private readonly watchdogMs: number;
    private readonly setTimeoutFn: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
    private readonly clearTimeoutFn: (handle: ReturnType<typeof setTimeout>) => void;

    private inFlight = false;
    private queued: T | null = null;
    private watchdog: ReturnType<typeof setTimeout> | null = null;

    constructor(options: CameraQueueOptions<T>) {
        this.issue = options.issue;
        this.watchdogMs = options.watchdogMs;
        this.setTimeoutFn = options.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
        this.clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
    }

    /** What `getMapState().hasPendingAnimations` reports. */
    get pending(): boolean {
        return this.inFlight;
    }

    /**
     * Ask for a camera move.
     *
     * `animate: false` is the initial framing of a journey — MapKit starts on its own default camera and
     * animating from there is a meaningless several-thousand-kilometre swoop. It also bypasses the queue,
     * because an unanimated write has no flight to collide with, and it drops anything queued: the caller has
     * just declared where the camera should be, right now.
     */
    request(target: T, animate = true): void {
        if (!animate) {
            this.queued = null;
            this.stopWatchdog();
            this.inFlight = false;
            this.issue(target, false);
            return;
        }

        if (this.inFlight) {
            // Keep ONLY the newest. An intermediate day the user has already scrolled past is not worth
            // flying to, and MapKit would drop the request anyway.
            this.queued = target;
            return;
        }

        this.inFlight = true;
        this.issue(target, true);
        this.stopWatchdog();
        this.watchdog = this.setTimeoutFn(() => {
            this.watchdog = null;
            this.settled();
        }, this.watchdogMs);
    }

    /**
     * Called from `region-change-end`, and by the watchdog when that never arrives.
     *
     * Returns `true` when the queue was empty and the camera has genuinely come to rest — the hook uses that
     * to decide whether it is worth re-emitting the viewport and regrouping photo markers, rather than doing
     * that work on the way through to another flight.
     */
    settled(): boolean {
        this.stopWatchdog();
        this.inFlight = false;
        const next = this.queued;
        this.queued = null;
        if (next === null) return true;
        this.request(next, true);
        return false;
    }

    /** Teardown. Leaves nothing that can fire after the map is destroyed. */
    dispose(): void {
        this.stopWatchdog();
        this.queued = null;
        this.inFlight = false;
    }

    private stopWatchdog(): void {
        if (this.watchdog !== null) {
            this.clearTimeoutFn(this.watchdog);
            this.watchdog = null;
        }
    }
}
