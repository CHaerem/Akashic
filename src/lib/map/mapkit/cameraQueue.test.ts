import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CameraQueue } from './cameraQueue';

/**
 * The highest-risk logic in the MapKit adapter, tested without a browser.
 *
 * MEASURED: nothing interrupts an in-flight MapKit camera animation and there is no `map.stop()`, so a
 * mid-flight request is silently dropped and rapid day switching would land the camera on a day the user has
 * already left. `CameraQueue` is the mitigation; these are the properties it has to have for
 * `e2e/day-navigation.spec.ts` to pass for the right reason.
 */

function makeQueue(watchdogMs = 900) {
    const issued: Array<[string, boolean]> = [];
    const queue = new CameraQueue<string>({
        issue: (target, animate) => issued.push([target, animate]),
        watchdogMs,
    });
    return { queue, issued };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('CameraQueue (MAP-03)', () => {
    it('issues the first request immediately', () => {
        const { queue, issued } = makeQueue();
        queue.request('A');
        expect(issued).toEqual([['A', true]]);
        expect(queue.pending).toBe(true);
    });

    it('lands on the LAST target when the user switches day mid-flight', () => {
        // This is the whole point. MapKit would have kept flying to A.
        const { queue, issued } = makeQueue();
        queue.request('A');
        queue.request('B');
        expect(issued).toEqual([['A', true]]);   // B is held, not dropped and not raced
        queue.settled();                          // region-change-end for A
        expect(issued).toEqual([['A', true], ['B', true]]);
    });

    it('keeps only the newest of several mid-flight requests', () => {
        // Flying through every intermediate day the user scrolled past would be slower AND wrong.
        const { queue, issued } = makeQueue();
        queue.request('A');
        queue.request('B');
        queue.request('C');
        queue.request('D');
        queue.settled();
        expect(issued).toEqual([['A', true], ['D', true]]);
    });

    it('reports settled only when the camera has genuinely come to rest', () => {
        // The hook uses this to avoid re-emitting the viewport and regrouping markers on the way through to
        // another flight.
        const { queue } = makeQueue();
        queue.request('A');
        queue.request('B');
        expect(queue.settled()).toBe(false);      // drained into B
        expect(queue.settled()).toBe(true);       // B arrived, nothing left
    });

    it('clears the pending flag via the WATCHDOG when no settle signal ever arrives', () => {
        // MEASURED: a no-op animated set fires ZERO region-change-end events. Without this the flag sticks
        // true, hasPendingAnimations never clears, and e2e/utils/test-helpers.ts:325 deadlocks the suite.
        const { queue } = makeQueue(900);
        queue.request('A');
        expect(queue.pending).toBe(true);
        vi.advanceTimersByTime(899);
        expect(queue.pending).toBe(true);
        vi.advanceTimersByTime(2);
        expect(queue.pending).toBe(false);
    });

    it('drains a queued target from the watchdog too, not only from the event', () => {
        // The no-op case can happen for the FIRST move of a pair — e.g. re-selecting the day already framed —
        // and the second must still be reached.
        const { queue, issued } = makeQueue(900);
        queue.request('A');
        queue.request('B');
        vi.advanceTimersByTime(901);
        expect(issued).toEqual([['A', true], ['B', true]]);
        expect(queue.pending).toBe(true);          // B is now in flight
        vi.advanceTimersByTime(901);
        expect(queue.pending).toBe(false);
    });

    it('does not leave a stale watchdog able to clear a LATER flight early', () => {
        // Each issue must re-arm the timer. If the first one's watchdog survived, it would fire mid-way
        // through the second flight and report the camera settled while it was still moving — which would
        // make waitForCameraSettled return at the wrong moment.
        const { queue } = makeQueue(900);
        queue.request('A');
        vi.advanceTimersByTime(500);
        queue.settled();                           // A arrived early
        queue.request('B');
        vi.advanceTimersByTime(500);               // 1000 ms since A's watchdog was armed
        expect(queue.pending).toBe(true);          // B is still in flight
        vi.advanceTimersByTime(500);
        expect(queue.pending).toBe(false);
    });

    it('bypasses the queue for an unanimated framing, and drops what was queued', () => {
        // An unanimated write is "the camera is here now" — usually the first framing of a journey. There is
        // no flight to collide with, and honouring a queued animation afterwards would fly away from it.
        const { queue, issued } = makeQueue();
        queue.request('A');
        queue.request('B');
        queue.request('C', false);
        expect(issued).toEqual([['A', true], ['C', false]]);
        expect(queue.pending).toBe(false);
        expect(queue.settled()).toBe(true);
    });

    it('is inert after dispose, so nothing fires at a destroyed map', () => {
        const { queue, issued } = makeQueue(900);
        queue.request('A');
        queue.request('B');
        queue.dispose();
        vi.advanceTimersByTime(5000);
        expect(issued).toEqual([['A', true]]);
        expect(queue.pending).toBe(false);
    });

    it('tolerates a settle signal when nothing is in flight', () => {
        // region-change-end also fires for user pans and zooms, which the adapter never requested.
        const { queue, issued } = makeQueue();
        expect(queue.settled()).toBe(true);
        expect(issued).toEqual([]);
        expect(queue.pending).toBe(false);
    });
});
