/**
 * Shared E2E helpers.
 *
 * QUA-40 made this file live. It existed before and was imported by NO spec: all four
 * carried their own copy-pasted `waitForMapReady`/`selectFirstTrek`, so the next person to
 * fix a waiting bug would have edited the copy that does not run. The perf helpers that
 * used to live here (`setupPerformanceObserver`, `getLongTasks`, `calculateFps`) served a
 * performance spec deleted seven months ago and are gone with it.
 *
 * Two behaviours here are deliberate reversals of what the specs used to do, and both are
 * the point of the task rather than incidental tidying:
 *
 *  1. MISSING DATA IS A FAILURE, NOT A SKIP. Every data-dependent test used to do
 *     `if (!selected) { test.skip(); return; }`. Under the 401 that meant 8 of
 *     day-navigation's 9 tests and most of app.spec silently SKIPPED, and only
 *     journey-data.spec test 1 went red — the web analogue of the CLAUDE.md trap that a UI
 *     test which cannot find its element PASSES. With a fixture container the data is
 *     guaranteed present, so its absence IS a defect and these helpers throw.
 *
 *  2. THE CAMERA IS WAITED ON PROPERLY. See `waitForCameraSettled`.
 */

import { expect, type Page } from '@playwright/test';

/** Timeout constants - keep tight for fast CI */
export const TIMEOUTS = {
    mapInit: 15000,
    dataLoad: 8000,
    transition: 5000,
    camera: 10000,
    action: 3000,
} as const;

/**
 * The `window.testHelpers` contract, registered by `src/components/MapSurface.tsx:175` under
 * `VITE_E2E_TEST_MODE` — MAP-03 moved it out of `MapboxGlobe.tsx` so one component owns the
 * global whichever vendor draws it. `e2e/` is outside the app tsconfig, so nothing checks this copy
 * against `MapSurface.tsx:89-101`; change both or neither. `getTrekData` returns a FLATTENED projection.
 */
interface TestHelpers {
    selectTrek(id: string): boolean;
    getTreks(): Array<{ id: string; name: string }>;
    getSelectedTrek(): string | null;
    selectDay(dayNumber: number): boolean;
    getCurrentDay(): number | null;
    getCamps(): Array<{ id: string; name: string; dayNumber: number }>;
    getTrekDataKeys(): string[];
    getTrekData(id: string): {
        id: string;
        name: string;
        campCount: number;
        camps: Array<{
            id: string;
            name: string;
            dayNumber: number;
            elevation: number;
            coordinates: [number, number];
        }>;
    } | null;
    isMapReady(): boolean;
    isDataLoaded(): boolean;
    getMapState(): {
        cameraCenter: [number, number] | null;
        cameraZoom: number | null;
        cameraBearing: number | null;
        pendingHighlightCampId: string | null;
        hasPendingAnimations: boolean;
    };
}

declare global {
    interface Window {
        testHelpers?: TestHelpers;
    }
}

export type CampSummary = NonNullable<ReturnType<TestHelpers['getTrekData']>>['camps'][number];

/**
 * Wait for the map to be ready AND the journey data to be loaded.
 *
 * `isDataLoaded()` is `!journeysLoading && treks.length > 0`, so under the old live-CloudKit
 * setup this could time out for an authorisation reason and every caller treated that as
 * "skip". It now hard-fails: with the fixture container there is no legitimate way for the
 * app to come up with zero journeys.
 */
export async function waitForMapReady(page: Page, timeout = TIMEOUTS.mapInit): Promise<void> {
    const startTime = Date.now();
    let pollInterval = 100;

    while (Date.now() - startTime < timeout) {
        const ready = await page
            .evaluate(() => window.testHelpers?.isMapReady() && window.testHelpers?.isDataLoaded())
            .catch(() => false);
        if (ready) return;
        await page.waitForTimeout(pollInterval);
        pollInterval = Math.min(pollInterval * 1.5, 500);
    }

    const diagnosis = await page
        .evaluate(() => ({
            helpers: !!window.testHelpers,
            mapReady: window.testHelpers?.isMapReady() ?? null,
            treks: window.testHelpers?.getTreks()?.map((t) => t.id) ?? null,
            trekDataKeys: window.testHelpers?.getTrekDataKeys() ?? null,
        }))
        .catch(() => null);

    throw new Error(
        `Map/data never became ready within ${timeout} ms. State: ${JSON.stringify(diagnosis)}. ` +
            'In E2E mode the journeys come from src/fixtures — zero treks means the fixture ' +
            'container did not load, not that a backend was unreachable.'
    );
}

/** goto('/') + canvas + data, as every spec needs before it can do anything. */
export async function openApp(page: Page): Promise<void> {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: TIMEOUTS.mapInit });
    await waitForMapReady(page);
}

export async function getTreks(page: Page): Promise<Array<{ id: string; name: string }>> {
    return page.evaluate(() => window.testHelpers?.getTreks() ?? []);
}

/** Select `treks[0]` and wait for the selection panel. Throws if there is nothing to select. */
export async function selectFirstTrek(page: Page): Promise<string> {
    const id = await page.evaluate(() => {
        const treks = window.testHelpers?.getTreks() ?? [];
        if (treks.length === 0) return null;
        return window.testHelpers?.selectTrek(treks[0].id) ? treks[0].id : null;
    });
    expect(id, 'no journey could be selected — the fixture journeys are missing').not.toBeNull();
    await page
        .getByText('Explore Journey →')
        .waitFor({ state: 'visible', timeout: TIMEOUTS.transition });
    return id as string;
}

/**
 * Select a journey that actually has days `1..minDays`, discovered at runtime.
 *
 * REPLACES a hardcoded `['kilimanjaro','mount-kenya','inca-trail']` (day-navigation.spec.ts:27).
 * Those were the owner's three real published journeys — pure live-CloudKit knowledge baked
 * into a spec, which is precisely the coupling QUA-40 is about. The fixture is deliberately
 * NOT slugged `kilimanjaro`, so this discovery is load-bearing rather than decorative: if
 * it broke, every day-navigation test would fail immediately instead of quietly skipping.
 */
export async function selectTrekWithDays(page: Page, minDays: number): Promise<string> {
    const id = await page.evaluate((min) => {
        const helpers = window.testHelpers;
        if (!helpers) return null;
        for (const trek of helpers.getTreks()) {
            const data = helpers.getTrekData(trek.id);
            if (!data) continue;
            const days = new Set(data.camps.map((c) => c.dayNumber));
            let complete = true;
            for (let day = 1; day <= min; day++) if (!days.has(day)) complete = false;
            if (complete && helpers.selectTrek(trek.id)) return trek.id;
        }
        return null;
    }, minDays);

    expect(
        id,
        `no journey exposes days 1..${minDays}. Available: ` +
            JSON.stringify(await page.evaluate(() => window.testHelpers?.getTrekDataKeys() ?? []))
    ).not.toBeNull();

    await page
        .getByText('Explore Journey →')
        .waitFor({ state: 'visible', timeout: TIMEOUTS.transition });
    return id as string;
}

/**
 * Enter trek view and begin the journey (Explore -> Start), then wait for camps.
 *
 * NOTE `handleCampSelect` TOGGLES (`useTrekData.ts:171-173`): clicking Start selects day 1,
 * so a following `selectDay(1)` deselects it. Callers must not assume a starting day.
 */
export async function navigateToTrekView(page: Page, minDays = 5): Promise<string> {
    const trekId = await selectTrekWithDays(page, minDays);

    await page.getByText('Explore Journey →').click();
    await page.getByText('Start', { exact: true }).waitFor({ timeout: TIMEOUTS.dataLoad });
    await page.getByText('Start', { exact: true }).click();

    await expect
        .poll(() => page.evaluate(() => window.testHelpers?.getCamps()?.length ?? 0), {
            timeout: TIMEOUTS.dataLoad,
            message: 'trek view rendered but exposed no camps',
        })
        .toBeGreaterThan(0);

    // Clicking Start selects day 1. Wait for that to commit and for the camera to arrive,
    // so every test below starts from the same known position instead of racing the
    // transition it was about to interrupt on purpose.
    await expectDay(page, 1);
    await waitForCameraSettled(page);

    return trekId;
}

export async function selectDay(page: Page, dayNumber: number): Promise<boolean> {
    return page.evaluate((day) => window.testHelpers?.selectDay(day) ?? false, dayNumber);
}

export async function getCurrentDay(page: Page): Promise<number | null> {
    return page.evaluate(() => window.testHelpers?.getCurrentDay() ?? null);
}

/**
 * Assert the app SETTLES on `dayNumber`.
 *
 * MEASURED, and it is why the old specs slept: `getCurrentDay()` reads `selectedCamp`
 * out of the closure captured at the last committed React render, so reading it
 * immediately after a `selectDay` round trip returns the PREVIOUS day — or null, when the
 * previous call was the toggle described on `navigateToTrekView`. Eight tests failed
 * exactly this way before this helper existed.
 *
 * The old specs papered over it with `await page.waitForTimeout(3000)`, which both wastes
 * three seconds and hides the difference between "settled on the right day" and "still
 * mid-transition but the number happens to match". Polling states the intent — after rapid
 * switching the app converges on the final selection — and returns as soon as it is true.
 */
export async function expectDay(page: Page, dayNumber: number): Promise<void> {
    await expect
        .poll(() => getCurrentDay(page), {
            timeout: TIMEOUTS.transition,
            message: `app never settled on day ${dayNumber}`,
        })
        .toBe(dayNumber);
}

/**
 * Establish the app on `dayNumber` deterministically, then wait for the camera.
 *
 * `handleCampSelect` TOGGLES (`useTrekData.ts:171-173`), so a plain `selectDay(n)` when
 * day n is already selected DESELECTS it. Tests that need a known starting position
 * (rather than a rapid-switch sequence) go through here, which re-issues the selection
 * until the app reports the day it asked for.
 */
export async function goToDay(page: Page, dayNumber: number): Promise<void> {
    await expect
        .poll(
            async () => {
                const current = await getCurrentDay(page);
                if (current === dayNumber) return current;
                await selectDay(page, dayNumber);
                return getCurrentDay(page);
            },
            { timeout: TIMEOUTS.transition, message: `could not establish day ${dayNumber}` }
        )
        .toBe(dayNumber);
    await waitForCameraSettled(page);
}

export async function getCamps(
    page: Page
): Promise<Array<{ id: string; name: string; dayNumber: number }>> {
    return page.evaluate(() => window.testHelpers?.getCamps() ?? []);
}

/** Full camp projection (with coordinates) for the CURRENTLY selected trek. */
export async function getSelectedTrekCamps(page: Page): Promise<CampSummary[]> {
    return page.evaluate(() => {
        const selected = window.testHelpers?.getSelectedTrek();
        if (!selected) return [];
        return window.testHelpers?.getTrekData(selected)?.camps ?? [];
    });
}

export async function campForDay(page: Page, dayNumber: number): Promise<CampSummary> {
    const camps = await getSelectedTrekCamps(page);
    const camp = camps.find((c) => c.dayNumber === dayNumber);
    expect(
        camp,
        `selected journey has no day ${dayNumber} (days: ${camps.map((c) => c.dayNumber).join(',')})`
    ).toBeDefined();
    expect(camp?.coordinates, `day ${dayNumber} camp has no coordinates`).toBeDefined();
    return camp as CampSummary;
}

/**
 * Wait until the camera has actually STOPPED, not until the app stops intending to move it.
 *
 * MEASURED: `getMapState().hasPendingAnimations` is
 * `cameraAnimationFrameRef.current !== null || styleLoadTimeoutRef.current !== null`, and
 * `cameraAnimationFrameRef.current` is cleared on the FIRST LINE of the rAF callback
 * (`useMapbox.ts:1031-1032`) — before `fitBounds`/`flyTo` is even issued. So the old
 * `waitForMapAnimations` returned roughly 0 ms into a 2200 ms flight, and every camera
 * assertion read a mid-flight centre, usually still the previous day's. Those assertions
 * passed only because the tolerance (50 km) was wider than the whole Kilimanjaro massif —
 * they were not position checks at all.
 *
 * This polls the centre and requires it to hold still, so the assertions that follow are
 * about where the camera ENDED UP. Fixing it in the spec rather than in `useMapbox` keeps
 * the change to test code; waiting on Mapbox's own `idle`/`moveend` would be better still
 * and needs a new test helper in the app.
 */
export async function waitForCameraSettled(
    page: Page,
    timeout = TIMEOUTS.camera
): Promise<[number, number]> {
    const EPSILON_DEG = 1e-6; // ~0.1 m — below any real easing step
    const STABLE_POLLS = 3;
    const INTERVAL_MS = 120;

    const start = Date.now();
    let previous: [number, number] | null = null;
    let stable = 0;

    while (Date.now() - start < timeout) {
        const state = await page.evaluate(() => window.testHelpers?.getMapState() ?? null);
        const centre = state?.cameraCenter ?? null;

        const held =
            centre != null &&
            previous != null &&
            Math.abs(centre[0] - previous[0]) < EPSILON_DEG &&
            Math.abs(centre[1] - previous[1]) < EPSILON_DEG;

        if (held && state?.hasPendingAnimations === false) {
            stable += 1;
            if (stable >= STABLE_POLLS) return centre as [number, number];
        } else {
            stable = 0;
        }

        previous = centre;
        await page.waitForTimeout(INTERVAL_MS);
    }

    throw new Error(
        `Camera never settled within ${timeout} ms (last centre ${JSON.stringify(previous)}).`
    );
}

/** Great-circle distance in km. */
export function distanceKm(a: [number, number], b: [number, number]): number {
    const R = 6371;
    const dLat = ((b[1] - a[1]) * Math.PI) / 180;
    const dLng = ((b[0] - a[0]) * Math.PI) / 180;
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
