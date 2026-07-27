/**
 * Day navigation, including rapid switching — the class of bug where the camera ends up on
 * a day the user is no longer looking at.
 *
 * THREE THINGS IN THIS FILE CHANGED MEANING WITH QUA-40, and none of them is cosmetic.
 *
 * 1. THE JOURNEY IS DISCOVERED, NOT NAMED. `selectTrekWithCamps` used to try exactly
 *    `['kilimanjaro','mount-kenya','inca-trail']`, and one assertion hardcoded
 *    `getTrekData('kilimanjaro')`. Those are the owner's real published slugs — live-CloudKit
 *    knowledge baked into a spec. `selectTrekWithDays(page, 5)` now finds a journey that
 *    actually exposes days 1..5, and the fixture is deliberately NOT slugged `kilimanjaro`
 *    so the discovery cannot rot into decoration.
 *
 * 2. NO TEST SKIPS ANY MORE. Every test opened with `if (!navigated) { test.skip(); return; }`.
 *    Under the CI 401 that meant eight of these nine tests SKIPPED silently and only
 *    journey-data.spec went red — the web analogue of the CLAUDE.md trap that a UI test
 *    which cannot find its element PASSES. Data is now guaranteed, so its absence throws.
 *
 * 3. THE CAMERA ASSERTIONS ARE POSITION CHECKS NOW; THEY WERE NOT BEFORE.
 *    `waitForMapAnimations` returned as soon as `hasPendingAnimations` went false, and
 *    `cameraAnimationFrameRef.current` was cleared on the FIRST LINE of the rAF callback
 *    (`useMapbox.ts:1031-1032`, in the Mapbox surface MAP-05 deleted) — before
 *    `fitBounds`/`flyTo` was issued. So
 *    `verifyCameraPosition` read `map.getCenter()` roughly 0 ms into a 2200 ms flight,
 *    i.e. usually the PREVIOUS day's centre, and `expect(success).toBe(true)` passed only
 *    because the 50 km tolerance was wider than the whole Kilimanjaro massif. Tests written
 *    to catch "camera stuck on the previous day" could not have caught it.
 *    Now: `waitForCameraSettled` waits for the centre to hold still, and the assertion is
 *    relative — the settled camera must be strictly CLOSER to the target day's camp than to
 *    the camp it came from. That is the actual defect, stated as an assertion, and it does
 *    not depend on the fixture's scale or on any surface's padding maths — which is why it
 *    survived the vendor swap unchanged and still holds on MapKit.
 *
 * 4. THE OFF-ROUTE BRANCH IS FINALLY EXERCISED. Four tests were named for Mount Kenya's
 *    "Safari day" and asserted only `getCurrentDay() === 5`. `selectTrekWithCamps` picked
 *    Kilimanjaro first, whose day 5 is ON route, so the `distanceToRoute <= 10` gate never fell
 *    through in this suite. (That gate was `useMapbox.ts:1079`; MAP-05 deleted it and the MapKit
 *    equivalent is `src/lib/map/mapkit/geometry.ts:91`, deliberately the same 10 km threshold.) The fixture puts day 5
 *    MEASURED 12.28 km from the nearest route point, and the tests below assert the flyTo
 *    signature that branch produces (centre exactly on the camp; a fixed zoom) rather than
 *    the fitBounds signature (centre between two camps; a zoom derived from the segment).
 */

import { test, expect } from './fixtures/test';
import {
    openApp,
    navigateToTrekView,
    selectDay,
    expectDay,
    goToDay,
    getCamps,
    getSelectedTrekCamps,
    campForDay,
    waitForCameraSettled,
    distanceKm,
} from './utils/test-helpers';
import type { Page } from '@playwright/test';

/** The fixture journey exposes days 1..5; day 5 is the off-route one. */
const OFF_ROUTE_DAY = 5;

/**
 * Absolute bound for an ON-ROUTE day, and every number in it is measured rather than chosen.
 *
 * The camera uses `fitBounds` over the route segment between the previous camp and this one,
 * with asymmetric desktop padding (`right: 400`), so the settled centre legitimately sits
 * between the two camps and shifted east — it is NOT expected to land on the camp.
 *
 * MEASURED on this fixture (route span 20.41 km, day segments ~5.1 km), settled distances:
 *   day 1 -> 1.70 km   day 3 -> 2.55 km   day 4 -> 2.55 km
 * and distance to the day the camera came FROM, in the same runs: 7.65, 7.65, 7.66, 11.91,
 * 12.76, 13.98 km. So 5 km sits roughly 2x above the worst target distance and 1.5x below
 * the best origin distance — a real bound with real margin, where the 50 km it replaces was
 * wider than the whole Kilimanjaro massif and could not fail.
 *
 * Re-measured on `mobile-chrome`, whose padding differs (`bottom: 300`, symmetric left/right):
 * identical figures, 1.70 and 2.55 km. I had expected the different padding to shift the
 * centre by roughly another kilometre and it does not — the settled centre is dominated by
 * the segment geometry, not the padding.
 */
const ON_ROUTE_TOLERANCE_KM = 5;

/**
 * Bound for the OFF-ROUTE day. That branch calls `flyTo({ center: camp.coordinates })`, so
 * the settled centre IS the camp. MEASURED: 0.000 km, on every one of the three tests that
 * check it. The bound is 0.5 km because the nearest an on-route day ever settles to its own
 * camp is 1.70 km (above) — so this threshold cannot be satisfied by the fitBounds branch,
 * which is exactly what makes it a branch assertion rather than a position tolerance.
 */
const OFF_ROUTE_TOLERANCE_KM = 0.5;

/**
 * Assert the camera settled on `targetDay` AND actually travelled there from `fromDay`.
 *
 * The relative half is the point. "Camera stuck at Day 2" and "stuck at Safari" are what
 * these tests were written for, and an absolute tolerance cannot express it — `fitBounds`
 * centres between two camps, so the target camp and the previous camp are both a few km
 * away. Requiring the settled centre to be strictly nearer the target than the origin does
 * express it, at any fixture scale.
 */
async function expectCameraMovedTo(page: Page, targetDay: number, fromDay: number) {
    const centre = await waitForCameraSettled(page);
    const camps = await getSelectedTrekCamps(page);
    const target = camps.find((c) => c.dayNumber === targetDay);
    const origin = camps.find((c) => c.dayNumber === fromDay);
    expect(target?.coordinates).toBeDefined();
    expect(origin?.coordinates).toBeDefined();

    const toTarget = distanceKm(centre, target!.coordinates);
    const toOrigin = distanceKm(centre, origin!.coordinates);
    console.log(
        `[camera] settled ${JSON.stringify(centre)} — ${toTarget.toFixed(2)} km from day ` +
            `${targetDay}, ${toOrigin.toFixed(2)} km from day ${fromDay}`
    );

    expect(
        toTarget,
        `camera settled ${toTarget.toFixed(2)} km from day ${targetDay}`
    ).toBeLessThanOrEqual(ON_ROUTE_TOLERANCE_KM);
    expect(
        toTarget,
        `camera is nearer day ${fromDay} than day ${targetDay} — it did not move`
    ).toBeLessThan(toOrigin);
}

/**
 * Assert the OFF-ROUTE camera branch ran: `flyTo` centred on the camp, at its own fixed
 * zoom rather than a zoom derived from a route segment.
 */
async function expectOffRouteFlyTo(page: Page) {
    const centre = await waitForCameraSettled(page);
    const camp = await campForDay(page, OFF_ROUTE_DAY);
    const zoom = await page.evaluate(() => window.testHelpers?.getMapState().cameraZoom ?? null);
    const offset = distanceKm(centre, camp.coordinates);
    console.log(
        `[camera] off-route day settled ${offset.toFixed(3)} km from its camp, zoom ${zoom}`
    );

    expect(
        offset,
        'off-route day did not use flyTo centred on the camp — it took the on-route ' +
            'fitBounds branch, so src/lib/map/mapkit/geometry.ts:91 (distanceToRoute <= 10) is ' +
            'not being exercised'
    ).toBeLessThanOrEqual(OFF_ROUTE_TOLERANCE_KM);
    // Second, independent signal for the same branch: the flyTo path hardcodes zoom 15 on
    // desktop and 14.5 on mobile, while fitBounds derives a zoom from the segment. MEASURED
    // here: 15.000, 15.010, 15.010 on the off-route day. So a floor of 14 separates the two
    // branches on either viewport without pinning the exact easing end-state.
    expect(zoom).not.toBeNull();
    expect(zoom!).toBeGreaterThan(14);
}

/**
 * Every test below enters through `navigateToTrekView`, which leaves the app settled on day
 * 1 with the camera arrived — a known starting position, so a "rapid switch" test interrupts
 * the transition it means to interrupt rather than racing the entry animation.
 */
test.describe('Day Navigation', () => {
    test('rapid day switching lands on the final selection', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);

        // Replaces a hardcoded getTrekData('kilimanjaro'): the camps come from whichever
        // journey was discovered, so this cannot silently assert against the wrong journey.
        expect((await campForDay(page, 3)).coordinates).toBeDefined();

        // Three switches with no waiting in between; the last one must win.
        await selectDay(page, 2);
        await selectDay(page, 3);
        await selectDay(page, 4);

        await expectDay(page, 4);
        await expectCameraMovedTo(page, 4, 1);
    });

    test('rapid switching through all five days lands on the off-route day', async ({ page }) => {
        // Was 'very rapid day switching (5 days quickly)', whose comment claimed "all 5 days
        // of Mount Kenya" while selecting Kilimanjaro, and which asserted only the day
        // number after a blind 3 s sleep. It now also asserts the camera reached the
        // off-route day's own branch.
        await openApp(page);
        await navigateToTrekView(page);

        await selectDay(page, 2);
        await selectDay(page, 3);
        await selectDay(page, 4);
        await selectDay(page, OFF_ROUTE_DAY);

        await expectDay(page, OFF_ROUTE_DAY);
        await expectOffRouteFlyTo(page);
    });

    test('forward and backward day switching', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);

        // Forward, from the settled day 1.
        await selectDay(page, 3);
        await expectDay(page, 3);
        await expectCameraMovedTo(page, 3, 1);

        // And back again.
        await selectDay(page, 1);
        await expectDay(page, 1);
        await expectCameraMovedTo(page, 1, 3);
    });

    test('off-route day uses flyTo centred on the camp, not a route-segment fitBounds', async ({
        page,
    }) => {
        // Was 'Safari day (off-route) navigation works', which asserted getCurrentDay() === 5
        // and nothing about the route at all — and picked a journey whose day 5 is on-route,
        // so the branch in the test's own name was never reached.
        await openApp(page);
        await navigateToTrekView(page);

        expect(await selectDay(page, OFF_ROUTE_DAY)).toBe(true);
        await expectDay(page, OFF_ROUTE_DAY);
        await expectOffRouteFlyTo(page);
    });

    test('rapid switch from an unsettled day straight to the off-route day', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);

        // No settle between these two: the off-route flight has to win over an on-route
        // fitBounds that is still in flight.
        await selectDay(page, 2);
        await selectDay(page, OFF_ROUTE_DAY);

        await expectDay(page, OFF_ROUTE_DAY);
        await expectOffRouteFlyTo(page);
    });

    test('switching from an established day with two rapid switches', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);

        // Establish and settle on day 2 first — the original bug only reproduced from an
        // established camera position, not from the initial trek-view framing. goToDay
        // survives the select-toggle, which a bare selectDay does not.
        await goToDay(page, 2);

        await selectDay(page, 3);
        await selectDay(page, 4);

        await expectDay(page, 4);
        // The critical half: the camera must not still be framing day 2.
        await expectCameraMovedTo(page, 4, 2);
    });

    test('rapid switching back from the off-route day', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);

        await selectDay(page, OFF_ROUTE_DAY);
        // Deliberately no settle here: the point is to interrupt the off-route flight.
        await selectDay(page, 4);
        await selectDay(page, 3);
        await selectDay(page, 2);
        await selectDay(page, 1);

        await expectDay(page, 1);
        // If the camera were stuck on the off-route day this is what fails — and with the
        // off-route camp 12.28 km away from the route, "stuck" is unambiguous now.
        await expectCameraMovedTo(page, 1, OFF_ROUTE_DAY);
    });

    test('triple rapid switch pattern', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);

        // Day 2 -> 4 -> 3, a common user pattern: the final target is BEHIND the intermediate
        // one, which is what used to leave the camera on day 4.
        await selectDay(page, 2);
        await selectDay(page, 4);
        await selectDay(page, 3);

        await expectDay(page, 3);
        await expectCameraMovedTo(page, 3, 4);
    });

    test('console shows no errors during rapid switching', async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
        });
        // An uncaught exception inside a requestAnimationFrame callback lands on the console,
        // which is how an unguarded `route.coordinates[0][0]` would surface if a fixture ever
        // shipped an empty route. That was a real hazard on the Mapbox surface
        // (`useMapbox.ts:1131-1134`, unguarded); MAP-05 deleted it, and the MapKit path GUARDS the
        // case (`src/lib/map/mapkit/geometry.ts:142`, `if (coordinates.length < 2) return null`).
        // The check is kept because it is cheap and because it now guards the guard. Collect
        // pageerror explicitly so the failure names itself instead of arriving as an anonymous
        // console line.
        page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

        await openApp(page);
        await navigateToTrekView(page);

        await selectDay(page, 2);
        await selectDay(page, 3);
        await selectDay(page, 4);
        await selectDay(page, OFF_ROUTE_DAY);
        await expectDay(page, OFF_ROUTE_DAY);
        await waitForCameraSettled(page);

        // This test is the reason the fixture had to cover fetchPublicPhotos as well as
        // fetchPublicJourneys, and had to make canUserComment quiet: entering trek view calls
        // AkashicApp -> getJourneyIdBySlug -> fetchPhotos -> fetchPublicPhotos, and
        // DayCommentsSection calls canUserComment for every selected day. Under the 401 each
        // logged its own '[cloudkit] Error ...' line and failed here.
        const relevantErrors = errors.filter(
            (err) => !err.includes('Download the React DevTools') && !err.includes('DevTools')
        );

        expect(relevantErrors).toEqual([]);
    });

    test('every day exposes a camp with coordinates', async ({ page }) => {
        // NEW. The old suite asserted `coordinates).toBeDefined()` for days 1, 3 and 4 only,
        // as a side effect of the camera tests, and skipped entirely when data was missing.
        // Coordinates are load-bearing for both camera branches, so check all five.
        await openApp(page);
        await navigateToTrekView(page);

        const camps = await getCamps(page);
        expect(camps.length).toBeGreaterThanOrEqual(5);

        for (let day = 1; day <= 5; day++) {
            const camp = await campForDay(page, day);
            expect(camp.coordinates).toHaveLength(2);
            expect(Number.isFinite(camp.coordinates[0])).toBe(true);
            expect(Number.isFinite(camp.coordinates[1])).toBe(true);
        }
    });
});
