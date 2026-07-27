/**
 * Camera easing for the landing globe. (MAP-02)
 *
 * Small surface, but `shortestLonDelta` is the kind of thing that is invisible in the common case and
 * glaringly wrong at the antimeridian — a globe spinning 340 degrees the wrong way to reach a point 20
 * degrees away.
 */

import { describe, it, expect } from 'vitest';
import {
    RETURN_DURATION_MS,
    SELECT_DURATION_MS,
    easeOutCubic,
    shortestLonDelta,
    tweenAt,
    type CameraTween,
} from './camera';

describe('easeOutCubic', () => {
    it('starts at 0, ends at 1, and clamps outside the interval', () => {
        expect(easeOutCubic(0)).toBe(0);
        expect(easeOutCubic(1)).toBe(1);
        expect(easeOutCubic(-5)).toBe(0);
        expect(easeOutCubic(5)).toBe(1);
    });

    it('decelerates — more than half the distance is covered in the first half of the time', () => {
        expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
        expect(easeOutCubic(0.25)).toBeGreaterThan(0.25);
    });

    it('is monotonic', () => {
        let prev = -1;
        for (let t = 0; t <= 1.0001; t += 0.05) {
            const v = easeOutCubic(t);
            expect(v).toBeGreaterThanOrEqual(prev);
            prev = v;
        }
    });
});

describe('shortestLonDelta', () => {
    it('goes the short way across the antimeridian', () => {
        expect(shortestLonDelta(170, -170)).toBe(20);
        expect(shortestLonDelta(-170, 170)).toBe(-20);
    });

    it('handles the ordinary case', () => {
        expect(shortestLonDelta(0, 90)).toBe(90);
        expect(shortestLonDelta(90, 0)).toBe(-90);
        expect(shortestLonDelta(30, 30)).toBe(0);
    });

    it('never returns more than half a revolution', () => {
        for (let from = -180; from <= 180; from += 7) {
            for (let to = -180; to <= 180; to += 11) {
                const d = shortestLonDelta(from, to);
                expect(Math.abs(d)).toBeLessThanOrEqual(180);
                // And it must actually land on the target, modulo a full turn.
                expect(((from + d - to) % 360 + 360) % 360).toBeCloseTo(0, 9);
            }
        }
    });
});

describe('tweenAt', () => {
    const tween: CameraTween = {
        fromLon: 30,
        fromLat: 15,
        toLon: 8.42,
        toLat: 61.672,
        startedAt: 1000,
        durationMs: SELECT_DURATION_MS,
    };

    it('is at the start point at t=0 and not done', () => {
        const at = tweenAt(tween, 1000);
        expect(at.lon).toBeCloseTo(30, 9);
        expect(at.lat).toBeCloseTo(15, 9);
        expect(at.done).toBe(false);
    });

    it('lands exactly on the target and reports done', () => {
        const at = tweenAt(tween, 1000 + SELECT_DURATION_MS);
        expect(at.lon).toBeCloseTo(8.42, 9);
        expect(at.lat).toBeCloseTo(61.672, 9);
        expect(at.done).toBe(true);
    });

    it('stays done afterwards rather than overshooting', () => {
        const at = tweenAt(tween, 1000 + SELECT_DURATION_MS * 3);
        expect(at.lon).toBeCloseTo(8.42, 9);
        expect(at.lat).toBeCloseTo(61.672, 9);
        expect(at.done).toBe(true);
    });

    it('moves monotonically towards the target', () => {
        let prev = 15;
        for (let ms = 0; ms <= SELECT_DURATION_MS; ms += 100) {
            const at = tweenAt(tween, 1000 + ms);
            expect(at.lat).toBeGreaterThanOrEqual(prev - 1e-9);
            prev = at.lat;
        }
    });

    it('crosses the antimeridian the short way rather than unwinding', () => {
        const t: CameraTween = {
            fromLon: 175,
            fromLat: 0,
            toLon: -175,
            toLat: 0,
            startedAt: 0,
            durationMs: 1000,
        };
        // Half-way through the EASING is past the midpoint, but it must be heading east past 180 rather
        // than back through 0.
        const at = tweenAt(t, 100);
        expect(at.lon).toBeGreaterThan(175);
    });

    it('returns home more slowly than it leaves, as the incumbent did', () => {
        expect(RETURN_DURATION_MS).toBeGreaterThan(SELECT_DURATION_MS);
    });
});
