/**
 * The MapKit journey surface, against the same assertions the Mapbox one had to pass. (MAP-03)
 *
 * Runs in the `chromium` project, and only when `VITE_MAPKIT_TOKEN` is set — MapKit JS is served exclusively
 * from Apple's CDN and needs a minted JWT, so there is nothing to fall back to. See `playwright.config.ts` for
 * why that is a missing spec rather than a skipped test.
 *
 * MAP-05 folded the dedicated `chromium-mapkit` project and its second dev server away: with Mapbox deleted
 * there is one bundle, so this is no longer the vendor-specific spec — it is the journey-surface spec, and it
 * overlaps `day-navigation.spec.ts` deliberately. See "Why this file duplicates day-navigation.spec.ts"
 * below; that reasoning is unchanged by the deletion, because it was never about there being two vendors.
 *
 * ## Why this file duplicates day-navigation.spec.ts rather than parameterising it
 *
 * Two of its assertions mean something different here, and the difference is the point:
 *
 * - **`cameraZoom` is SYNTHESISED for MapKit.** MapKit JS has no zoom level; the number comes from
 *   `src/lib/map/mapkit/camera.ts` and is calibrated in `camera.test.ts` so the on-route fits stay below 14
 *   and the off-route frame above it. If that calibration were wrong, the shared assertion would pass while
 *   silently stopping to discriminate between the two camera branches — which is exactly the vacuity QUA-40
 *   removed. Asserting it here, on the real surface, is what closes the loop between the unit calibration and
 *   the running app.
 * - **Rapid day switching is a HARDER test on MapKit.** Measured: nothing interrupts an in-flight MapKit
 *   camera animation and there is no `map.stop()` — five different interrupts all left the camera flying to
 *   the earlier target. `src/lib/map/mapkit/cameraQueue.ts` is the mitigation. This spec is the only place
 *   that proves it works against the real animation rather than a fake clock.
 *
 * And one assertion exists ONLY here, because it is a terms requirement rather than a behaviour: Apple's logo
 * and Legal link must be reachable, and they are painted onto a canvas that no CSS can move.
 */

import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import {
    campForDay, distanceKm, getCurrentDay, getSelectedTrekCamps, goToDay, navigateToTrekView, openApp,
    selectDay, waitForCameraSettled,
} from './utils/test-helpers';

/** Same tolerances as day-navigation.spec.ts, so a regression here is comparable to one there. */
const ON_ROUTE_TOLERANCE_KM = 5;
const OFF_ROUTE_TOLERANCE_KM = 0.5;
/** Day 5 of the alpine fixture is MEASURED 12.28 km from its nearest route point. */
const OFF_ROUTE_DAY = 5;

/**
 * A day whose fixture photo sits on its camp's EXACT coordinate — the case QUA-49 was measured on.
 *
 * `src/fixtures/publicShowcase.ts` puts photos on days 1, 3 and 5, each at its day camp's coordinate to the
 * digit (`buildPublicPhotoRecords`'s `at` table against `e2e-alpine-loop.waypoints.json`). Day 3 is the one
 * this had to be: day 5's camp is off-route and therefore outside the whole-route overview this test frames
 * (QUA-49 measured four of the five camps on screen there), and day 1 is the day this test toggles OFF to reach
 * that overview — so a click on day 1 could report success without having done anything, the moment the toggle
 * regressed. Day 3 is also literally the marker the defect was found on: `elementFromPoint` at its centre
 * returned `.photo-stack-main`. MEASURED here after the fix — the stack sits exactly 30 px off it and
 * `div.camp-marker` owns the camp's centre.
 */
const PHOTO_ON_CAMP_DAY = 3;

/**
 * How far the pushed-off stack may be from the camp's centre and still count as "this is the coincident case".
 *
 * `MARKER_CLEARANCE_PX` in `src/lib/map/mapkit/annotations.ts` is 30, so a stack that began exactly on the
 * camp settles ~30 px away. The slack above that is for the projection, not for a different fixture: at ~60 px
 * the pair still reads as one place, while a stack at a different photo location on this route is hundreds of
 * pixels away at overview zoom.
 */
const COINCIDENT_STACK_WITNESS_PX = 60;

test.describe('MapKit journey surface', () => {
    test('renders the journey on a MapKit canvas, and on no other', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);

        // MapKit's DOM, measured: div.mk-map-view > [canvas.syrup-canvas, canvas.rt-root] plus
        // div.mk-annotation-container. `canvas.syrup-canvas` is what keeps the six existing
        // `waitForSelector('canvas')` call sites working on this surface.
        await expect(page.locator('.mk-map-view')).toHaveCount(1);
        await expect(page.locator('canvas.syrup-canvas')).toHaveCount(1);
        // MAP-05 note on the line below: it used to prove "not both vendors at once", because a MapKit
        // surface with a live Mapbox map behind it would pass every other assertion in this file. Mapbox is
        // deleted, so NOTHING IN THE TREE CAN PRODUCE THIS CLASS and the assertion can no longer fail for the
        // reason it was written. It is kept as a REINTRODUCTION guard — the same role `boundary.test.ts` gives
        // its surviving `mapbox` patterns — and deliberately not described as evidence of single-vendor
        // rendering any more. If it ever goes red, someone reinstalled mapbox-gl.
        await expect(page.locator('.mapboxgl-map')).toHaveCount(0);
    });

    test('draws the route and one annotation per camp', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);
        const camps = await getSelectedTrekCamps(page);
        expect(camps.length).toBeGreaterThanOrEqual(5);

        // The annotation factory is called LAZILY on first display, so poll rather than assert immediately.
        await expect(page.locator('.mk-annotation-container .camp-marker')).toHaveCount(camps.length, {
            timeout: 15_000,
        });

        // Five overlays: two for the base route (glow + core) and three for the active-day halo. There is no
        // blur in mapkit.Style, so the halo is stacked strokes — see src/lib/map/mapkit/overlays.ts.
        const overlayCount = await page.evaluate(() => window.mapkit?.maps[0]?.overlays.length ?? -1);
        expect(overlayCount).toBe(5);
    });

    test('clicking a camp with a photo on its exact coordinate selects that day (QUA-49)', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);
        const camps = await getSelectedTrekCamps(page);
        expect(
            camps.some((c) => c.dayNumber === PHOTO_ON_CAMP_DAY),
            `the fixture no longer has a day ${PHOTO_ON_CAMP_DAY} — see PHOTO_ON_CAMP_DAY`,
        ).toBe(true);

        // TWO MEASURED MapKit behaviours make a naive `click()` on a named day flaky, and both are worth
        // knowing before writing any spec that touches a marker.
        //
        // 1. An OFF-SCREEN annotation keeps its element in the DOM with `display: flex` and
        //    `visibility: visible` but collapses to a ZERO bounding box. Framed on day 1's segment, the
        //    day 3/4/5 markers all report rect [0,0,0,0]; Playwright's visibility test is "non-empty
        //    bounding box", so `click()` fails with "element is not visible" on a marker that is genuinely
        //    there and genuinely not on screen. Hence: back out to the whole-route overview first, where
        //    every on-route camp is positioned.
        // 2. A PHOTO STACK CAN COVER A CAMP MARKER AND INTERCEPT ITS CLICKS. This comment used to continue
        //    "and nothing the app can set changes MapKit's annotation paint order — not z-index (the elements
        //    compute `position: static`), not `DisplayPriority`, not DOM order", and that conclusion was
        //    FALSE, which is why this test changed shape. The three levers named are still measurably
        //    useless — the elements do compute `position: static`, and z-index cannot cross out of the
        //    per-slot wrapper inside `.mk-annotation-container`'s CLOSED shadow root. But paint order is ADD
        //    ORDER, so re-adding an annotation does move it to the top, and QUA-49 fixed the defect with
        //    exactly that: `src/lib/map/mapkit/annotations.ts` re-adds the camps after any photo diff that
        //    creates a stack, and pushes a stack within 30 page px of a camp off along the camp→stack
        //    direction. Read that file's header and `src/index.css`'s `.camp-marker` comment before touching
        //    marker stacking.
        //
        // So the day is NAMED, not discovered. The old version of this test scanned for "a camp whose own
        // element is the topmost thing at its centre" and clicked whichever it found — which, with days 1, 3
        // and 5 of the fixture each carrying a photo on the camp's exact coordinate, could only ever have
        // found days 2 or 4, and so stayed green for the whole period the defect shipped. Naming a coincident
        // day is what makes this a regression test, and it was PROVEN in both directions rather than argued:
        // carried into a throwaway worktree at `87f4127~1` — the commit before the fix — this test fails on
        // `campOwnsCentre: false` with `nearestStackOwnsCentre: true`, i.e. the stack owns the camp's centre
        // and the camp owns nothing, which is the defect exactly. (`scripts/prove.mjs` does the same job
        // mechanically for the unit half, in `annotations.test.ts`.)
        await page.evaluate(() => window.testHelpers?.selectDay(1));
        // Asserted rather than assumed: if the toggle-out ever stopped working the camera would still be
        // framed on day 1, and the click below would be asserting a selection that was already there.
        await expect
            .poll(() => getCurrentDay(page), {
                timeout: 10_000,
                message: 'selectDay(1) did not deselect day 1, so this test never reached the whole-route '
                    + 'overview where every on-route camp is positioned',
            })
            .toBeNull();
        await waitForCameraSettled(page);

        // Polled, not sampled once: the photo stacks are re-diffed on every `region-change-end`, so a single
        // snapshot can land mid-diff, before the clearance for the settled projection has been written.
        await expect
            .poll(() => markerPrecedence(page, PHOTO_ON_CAMP_DAY), {
                timeout: 15_000,
                message: `day ${PHOTO_ON_CAMP_DAY}'s camp has a fixture photo on its exact coordinate. Both `
                    + 'halves of QUA-49 must hold: the camp owns its own centre (the re-add), and so does the '
                    + 'stack that was pushed off it (the clearance). `campCentreHit` names what is on top '
                    + 'instead — a `.photo-stack-*` there is the original defect back.',
            })
            .toMatchObject({
                found: true, onScreen: true, campOwnsCentre: true, nearestStackOwnsCentre: true,
            });

        // THE WITNESS, and it is load-bearing: everything above would also pass on a day with no photo
        // anywhere near it, which is precisely how the discovery loop this replaced stayed green through the
        // defect. `MARKER_CLEARANCE_PX` is 30, so a stack that started exactly on this camp ends up ~30 px
        // from its centre. If the fixture ever moves the photo away, this fails and says so rather than
        // quietly turning the test back into a plain marker click.
        const sample = await markerPrecedence(page, PHOTO_ON_CAMP_DAY);
        console.log(`[mapkit] day ${PHOTO_ON_CAMP_DAY} camp: nearest photo stack ${sample.nearestStackPx} px `
            + `from its centre, topmost at the camp centre is ${sample.campCentreHit}`);
        expect(sample.nearestStackPx, `no photo stack is near day ${PHOTO_ON_CAMP_DAY}'s camp any more, so `
            + 'this test no longer exercises marker precedence at all — pick another coincident day (the '
            + 'fixture puts photos on days 1, 3 and 5) or restore the fixture photo')
            .toBeLessThanOrEqual(COINCIDENT_STACK_WITNESS_PX);

        // A DOM click on the factory element, not MapKit's own `select` event: onCampSelect TOGGLES, and
        // map.selectedAnnotation is single-select map state that would desync from that toggle. Playwright's
        // own hit-target check is part of the assertion here — it is what reported the interception before the
        // fix, so a regression fails on `click()` even if the probe above were somehow satisfied.
        const marker = page.locator('.mk-annotation-container .camp-marker').filter({
            has: page.locator('.camp-marker-badge', { hasText: String(PHOTO_ON_CAMP_DAY) }),
        });
        await expect(marker).toHaveCount(1, { timeout: 15_000 });
        await marker.click();

        await expect
            .poll(() => getCurrentDay(page), { timeout: 10_000 })
            .toBe(PHOTO_ON_CAMP_DAY);
    });

    test('rapid day switching lands on the final selection, despite no way to cancel a flight', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);

        const before = await cameraCentre(page);

        // Fire three switches without waiting. On MapKit every one of these after the first is DROPPED by the
        // SDK — measured. Landing on day 4 is the coalescing queue working, not MapKit doing the right thing.
        await selectDay(page, 2);
        await selectDay(page, 3);
        await selectDay(page, 4);

        await expect.poll(() => getCurrentDay(page), { timeout: 15_000 }).toBe(4);
        await expectOnRouteCamera(page, 4, before);
    });

    test('an on-route day fits its own segment, below the zoom-14 branch threshold', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);
        const before = await cameraCentre(page);
        await goToDay(page, 2);
        await expectOnRouteCamera(page, 2, before);

        const zoom = await cameraZoom(page);
        expect(zoom, 'an on-route segment fit must stay below 14, or the off-route assertion below stops '
            + 'discriminating between the two camera branches').toBeLessThan(14);
    });

    test('an off-route day centres on its camp above zoom 14', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);
        await goToDay(page, OFF_ROUTE_DAY);

        const centre = await waitForCameraSettled(page);
        const camp = await campForDay(page, OFF_ROUTE_DAY);
        const offset = distanceKm(centre, camp.coordinates);
        const zoom = await cameraZoom(page);
        console.log(`[mapkit] off-route day settled ${offset.toFixed(3)} km from its camp, zoom ${zoom}`);

        expect(offset, 'the off-route day did not centre on its camp — it took the on-route segment-fit '
            + 'branch, so geometry.ts\'s OFF_ROUTE_KM gate is not being exercised')
            .toBeLessThanOrEqual(OFF_ROUTE_TOLERANCE_KM);
        // The second, independent signal for the same branch, and the one that ties the synthesised zoom in
        // src/lib/map/mapkit/camera.ts to the running app.
        expect(zoom).not.toBeNull();
        expect(zoom!).toBeGreaterThan(14);
    });

    test('reports a LIVE camera centre, so the settle helper is not vacuous', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);

        // MEASURED: map.center interpolates during setRegionAnimated (61.600 -> 61.700 at 89 ms -> 61.820 at
        // 188 ms -> 61.900 at 287 ms). If it ever jumped straight to the destination, waitForCameraSettled
        // would return instantly and every camera assertion above would pass without the camera moving. This
        // asserts the property directly rather than trusting it.
        const before = await page.evaluate(
            () => window.testHelpers?.getMapState().cameraCenter ?? null);
        await selectDay(page, OFF_ROUTE_DAY);
        const immediately = await page.evaluate(
            () => window.testHelpers?.getMapState().cameraCenter ?? null);
        expect(before).not.toBeNull();
        expect(immediately).not.toBeNull();

        const camp = await campForDay(page, OFF_ROUTE_DAY);
        // The instant after requesting the move, the camera must NOT already be at the destination.
        expect(
            distanceKm(immediately!, camp.coordinates),
            'getMapState().cameraCenter reported the destination before the flight — waitForCameraSettled '
                + 'would then return instantly and every camera assertion in this suite would be vacuous'
        ).toBeGreaterThan(OFF_ROUTE_TOLERANCE_KM);

        const settled = await waitForCameraSettled(page);
        expect(distanceKm(settled, camp.coordinates)).toBeLessThanOrEqual(OFF_ROUTE_TOLERANCE_KM);
    });

    test('hasPendingAnimations always clears, so the settle helper cannot deadlock', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);

        // MEASURED: a no-op animated set fires ZERO region-change-end events. Re-selecting the day the camera
        // is already framed on is exactly that case, and without cameraQueue's watchdog the flag would stick
        // true forever — which hangs e2e/utils/test-helpers.ts:325 for the whole suite, not just this test.
        await goToDay(page, 2);
        await page.evaluate(() => window.testHelpers?.selectDay(2));   // deselect (it toggles)
        await page.evaluate(() => window.testHelpers?.selectDay(2));   // reselect the same frame
        await expect
            .poll(() => page.evaluate(
                () => window.testHelpers?.getMapState().hasPendingAnimations ?? true), { timeout: 15_000 })
            .toBe(false);
    });

    test('Apple\'s attribution band is unobstructed, and the lift is wired to auth state', async ({ page }) => {
        await openApp(page);
        await navigateToTrekView(page);

        // ## THE PART THIS SUITE CANNOT REACH, stated rather than faked
        //
        // The terms case is the SIGNED-OUT showcase: a bottom-left "Family sign-in" pill and a bottom-right
        // "Made with Akashic" chip that would otherwise sit on top of Apple's logo and Legal link. But
        // `src/components/AuthGuard.tsx:92` is `signedIn = isE2ETestMode || user != null`, so **every
        // Playwright run is signed IN**, `.public-chrome` never mounts, and the 80 px lift is correctly NOT
        // applied. An assertion of `padding.bottom === 80` here would be asserting a state this suite can
        // never produce — it failed exactly that way when first written.
        //
        // Where the signed-out case IS proven: `src/lib/map/mapkit/chrome.test.ts` pins the value — it used
        // to cross-check it against the Mapbox rule in `src/index.css`, but MAP-05 deleted both the rule and
        // that assertion, so the constant now stands alone — and the before/after screenshot pair from
        // `scripts/mapkit/surface-probe/?probe=attrib` is the evidence for the EFFECT — Apple paints the logo
        // and Legal onto `canvas.rt-root`, so there is no element to locate and no pixel to read (neither
        // `getImageData` on `rt-root` nor `gl.readPixels` on `syrup-canvas` can see what MapKit drew).
        //
        // What this test CAN do, and it is not nothing: prove the padding tracks auth state rather than being
        // hardcoded, and prove nothing in the app's chrome covers the band Apple actually paints into. The
        // second is the assertion that fails the day someone adds a signed-in chip at the bottom of the map.
        const padding = await page.evaluate(() => {
            const p = window.mapkit?.maps[0]?.padding;
            return p ? { top: p.top, right: p.right, bottom: p.bottom, left: p.left } : null;
        });
        expect(padding).not.toBeNull();
        // Signed in there are no bottom chips, so no bottom band is needed — but the DESKTOP JOURNEY PANEL is
        // still there, on the LEFT (`Sidebar.tsx:102-106`: fixed, left 12, width 340), covering the corner
        // Apple paints into. A zero left padding would mean that clearance is not being applied.
        expect(padding!.bottom, 'signed in there are no bottom chips, so the map needs no bottom band')
            .toBe(0);
        expect(padding!.left, 'the desktop journey panel is on the LEFT and covers the corner Apple paints '
            + 'into, so map.padding.left must clear it — see src/lib/map/mapkit/chrome.ts')
            .toBeGreaterThan(300);

        const hits = await page.evaluate((pad) => {
            const view = document.querySelector('.mk-map-view');
            if (!view) return null;
            const rect = view.getBoundingClientRect();
            // Sample where Apple's attribution actually IS: inside the padded rect, 14 px above its bottom
            // edge. Probing at the raw container corners instead samples the app's own chrome — and when a
            // padding is 0 it lands outside the element, where elementFromPoint returns null. Both of those
            // is how this assertion failed on its first two attempts.
            const y = rect.bottom - pad.bottom - 14;
            const probes: Array<[number, number]> = [
                [rect.left + pad.left + 30, y],
                [rect.left + pad.left + 90, y],
                [rect.right - pad.right - 40, y],
            ];
            return probes.map(([x, py]) => {
                const element = document.elementFromPoint(x, py);
                if (!element) return `none @ ${Math.round(x)},${Math.round(py)}`;
                const box = element.getBoundingClientRect();
                // Rect and probe position in the message on purpose: a bare "div." says nothing about WHICH
                // chrome is over Apple's logo, and that is the only thing a reader needs to fix it.
                return `${element.tagName.toLowerCase()}.${String(element.className) || '(no class)'} `
                    + `[${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}x`
                    + `${Math.round(box.height)}] @ ${Math.round(x)},${Math.round(py)}`;
            });
        }, padding!);

        expect(hits).not.toBeNull();
        for (const hit of hits!) {
            // MapKit hit-tests internally, so a point over the map resolves to one of ITS OWN elements.
            // Measured here: `div.mk-map-node-element` and `div.mk-controls-container`, the latter tracking
            // map.padding — it measured [364, 0, 916 x 720] once the left clearance was applied, which is
            // itself a useful confirmation that MapKit moved its own furniture. Anything whose class is not
            // MapKit's is app chrome sitting on Apple's attribution, and that is the terms violation.
            expect(hit, `something is covering Apple's attribution band: ${hit}`)
                .toMatch(/\.mk-|syrup-canvas|rt-root/);
        }
    });
});

async function cameraZoom(page: Page): Promise<number | null> {
    return page.evaluate(() => window.testHelpers?.getMapState().cameraZoom ?? null);
}

/** One sample of who owns which centre around a camp marker. Uniform shape so a poll can match on it. */
interface MarkerPrecedence {
    /** The camp marker for that day number is in the annotation container at all. */
    found: boolean;
    /** …and has a non-empty bounding box, i.e. MapKit has it positioned rather than collapsed off-screen. */
    onScreen: boolean;
    /** `elementFromPoint` at the camp's own centre lands inside the camp marker. */
    campOwnsCentre: boolean;
    /** What it lands on instead, for the failure message — a `.photo-stack-*` here is QUA-49's defect. */
    campCentreHit: string;
    /** Page-pixel distance from the camp's centre to the nearest positioned photo stack's centre. */
    nearestStackPx: number | null;
    /** That stack owns ITS own centre too — the mirror defect `clearedAnchorOffset` exists for. */
    nearestStackOwnsCentre: boolean;
}

/**
 * Sample the paint order around one day's camp marker, in the page.
 *
 * `elementFromPoint` rather than anything MapKit exposes, because the thing being asserted lives inside
 * `.mk-annotation-container`'s closed shadow root: there is no API for "which annotation is on top", and the
 * light-DOM order is measurably not it. Hit testing at a centre is the only observation that answers the
 * question a user's click asks.
 */
async function markerPrecedence(page: Page, dayNumber: number): Promise<MarkerPrecedence> {
    return page.evaluate((day) => {
        const centreOf = (element: Element) => {
            const rect = element.getBoundingClientRect();
            return { rect, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        };
        const describe = (element: Element | null) => element
            ? `${element.tagName.toLowerCase()}.${String(element.className) || '(no class)'}`
            : 'none';
        const empty: MarkerPrecedence = {
            found: false, onScreen: false, campOwnsCentre: false, campCentreHit: 'none',
            nearestStackPx: null, nearestStackOwnsCentre: false,
        };

        const camps = [...document.querySelectorAll('.mk-annotation-container .camp-marker')];
        const camp = camps.find(
            (c) => c.querySelector('.camp-marker-badge')?.textContent?.trim() === String(day));
        if (!camp) return empty;
        const at = centreOf(camp);
        if (at.rect.width === 0 || at.rect.height === 0) return { ...empty, found: true };

        const campHit = document.elementFromPoint(at.x, at.y);
        let nearest: { distance: number; ownsCentre: boolean } | null = null;
        for (const stack of document.querySelectorAll('.mk-annotation-container .photo-stack')) {
            const stackAt = centreOf(stack);
            if (stackAt.rect.width === 0 || stackAt.rect.height === 0) continue;
            const distance = Math.hypot(stackAt.x - at.x, stackAt.y - at.y);
            if (nearest && distance >= nearest.distance) continue;
            const hit = document.elementFromPoint(stackAt.x, stackAt.y);
            nearest = { distance, ownsCentre: !!hit && stack.contains(hit) };
        }

        return {
            found: true,
            onScreen: true,
            campOwnsCentre: !!campHit && camp.contains(campHit),
            campCentreHit: describe(campHit),
            nearestStackPx: nearest ? Math.round(nearest.distance) : null,
            nearestStackOwnsCentre: nearest ? nearest.ownsCentre : false,
        };
    }, dayNumber);
}

/**
 * The settled camera must be within tolerance of the target day's camp, and it must have MOVED TOWARDS it.
 *
 * ## Why this is not `day-navigation.spec.ts:96-121` verbatim
 *
 * That helper's second assertion is "the settled centre is strictly nearer the target camp than the camp it
 * came from". MEASURED, that held on Mapbox **because of the asymmetric `right: 400` padding**
 * (`useMapbox.ts:1094-1096`, deleted with that surface by MAP-05), which shifted the centre east, towards the
 * later camp. It is not a property of a
 * correct segment fit: a day's segment runs from the previous camp to this one, so a fit that pads
 * symmetrically centres the camera BETWEEN the two — measured 2.66 km from day 2 and 2.45 km from day 1 on
 * the fixture. The MapKit surface pads symmetrically on purpose (the desktop panel is on the LEFT, so the
 * incumbent's padding clears the empty side — see `src/lib/map/mapkit/chrome.ts`), and that made the
 * inherited assertion fail on a camera that had done exactly the right thing.
 *
 * So the defect is restated rather than the number relaxed. "The camera ended up on a day the user is no
 * longer looking at" means: it did not move, or it moved away. Comparing the distance-to-target before and
 * after says precisely that, and it depends on no vendor's padding maths at all.
 */
async function expectOnRouteCamera(
    page: Page, targetDay: number, beforeCentre: [number, number],
): Promise<void> {
    const centre = await waitForCameraSettled(page);
    const camps = await getSelectedTrekCamps(page);
    const target = camps.find((c) => c.dayNumber === targetDay);
    expect(target?.coordinates).toBeDefined();

    const toTarget = distanceKm(centre, target!.coordinates);
    const wasToTarget = distanceKm(beforeCentre, target!.coordinates);
    console.log(`[mapkit] settled ${JSON.stringify(centre)} — ${toTarget.toFixed(2)} km from day `
        + `${targetDay}, was ${wasToTarget.toFixed(2)} km before the switch`);

    expect(toTarget, `camera settled ${toTarget.toFixed(2)} km from day ${targetDay}`)
        .toBeLessThanOrEqual(ON_ROUTE_TOLERANCE_KM);
    expect(toTarget, `camera did not move towards day ${targetDay} — it was ${wasToTarget.toFixed(2)} km `
        + `away and settled ${toTarget.toFixed(2)} km away`).toBeLessThan(wasToTarget);
}

/** The live camera centre right now, for the before/after comparison above. */
async function cameraCentre(page: Page): Promise<[number, number]> {
    const centre = await page.evaluate(() => window.testHelpers?.getMapState().cameraCenter ?? null);
    expect(centre, 'getMapState() reported no camera centre').not.toBeNull();
    return centre as [number, number];
}
