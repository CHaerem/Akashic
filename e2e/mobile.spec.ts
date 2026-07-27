/**
 * Mobile viewport behaviour, plus the photo lightbox.
 *
 * READ THIS BEFORE SIZING ANY WORK AROUND THIS FILE (QUA-40 finding). CI runs
 * `--project=chromium` only, and the 'Mobile Experience' block skips unless the project name
 * contains 'mobile'. So SIX of these tests never execute in CI, and the responsive behaviour
 * the app actually ships is verified by nothing automated. Running `mobile-chrome` in the gate
 * is a separate decision, deliberately not taken here — it doubles the gate's runtime and this
 * task is about decoupling it from CloudKit.
 *
 * The one test that does run on chromium is the lightbox one, and its photo half was
 * unreachable: it looked for `getByRole('tab', { name: /photos/i })` and nothing in `src/` has
 * `role="tab"` any more (tabs were replaced by `activeMode`), so the `isVisible()` guard was
 * permanently false and the lightbox was never opened. Rather than leave a test whose body
 * silently does nothing, the dead branch is gone and what remains asserts what it actually
 * checks: that a journey renders its overview on this viewport.
 */

import { test, expect } from './fixtures/test';
import { openApp, selectFirstTrek, TIMEOUTS } from './utils/test-helpers';

test.describe('Mobile Experience', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        void page;
        // Not a skip-on-missing-data escape — this one is a genuine project filter, and it is
        // why six of these tests do not run in CI.
        if (!testInfo.project.name.includes('mobile')) {
            test.skip(true, 'mobile-only project');
        }
    });

    test('bottom sheet appears on trek selection', async ({ page }) => {
        await openApp(page);
        await selectFirstTrek(page);
        await expect(page.getByText('Explore Journey →')).toBeVisible();
    });

    test('journey exploration works on mobile viewport', async ({ page }) => {
        await openApp(page);
        await selectFirstTrek(page);

        await page.getByText('Explore Journey →').click();
        await expect(page.getByText('DURATION')).toBeVisible({ timeout: TIMEOUTS.dataLoad });
    });

    test('navigation tabs are accessible', async ({ page }) => {
        await openApp(page);
        await selectFirstTrek(page);

        await page.getByText('Explore Journey →').click();
        await expect(page.getByText('DURATION')).toBeVisible({ timeout: TIMEOUTS.dataLoad });
        await expect(page.getByText('Start', { exact: true })).toBeVisible();
    });

    test('touch interactions work on map', async ({ page }) => {
        await openApp(page);

        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();

        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThan(100);
        expect(box!.height).toBeGreaterThan(100);
    });

    test('app is responsive at mobile width', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: TIMEOUTS.mapInit });

        const viewportSize = page.viewportSize();
        expect(viewportSize).not.toBeNull();
        // iPhone 14: 390x844, Pixel 5: 393x851
        expect(viewportSize!.width).toBeLessThan(500);

        await expect(page.locator('canvas')).toBeVisible();
    });

    test('mobile visual regression', async ({ page }) => {
        await openApp(page);
        await expect(page).toHaveScreenshot('mobile-globe.png', { maxDiffPixelRatio: 0.15 });
    });

    /*
     * MAP-05 DELETED a test here: 'trek view visual regression', with its committed baseline
     * `mobile-trek-view-mobile-chrome-darwin.png`. This is a real reduction in coverage and it is recorded
     * rather than quietly dropped, because the alternative was a test that could only pass for the wrong
     * reason. Three things were tried, in this order, and all are measured:
     *
     * 1. LEAVE THE BASELINE. It was a Mapbox render, so it no longer depicts anything the app can draw. CI
     *    runs `--ignore-snapshots`, so it would never have gone red — it would have silently stopped
     *    meaning anything, which is worse than absent.
     * 2. RE-CAPTURE IT. MapKit initialised and drew the route and Apple's logo, but NO satellite tiles
     *    arrived inside the 500 ms settle: the fresh baseline was a grey rectangle (113 KB against the old
     *    473 KB). Committing it produces a test that fails whenever the tiles DO arrive in time — flaky in
     *    the worst direction, because the failure reads as a genuine visual regression. Waiting for tiles is
     *    not available: `tiles-loaded` is a correctly-spelled MapKit event that was never observed firing
     *    (`src/lib/map/mapkit/events.ts` — "spelled right ≠ guaranteed to fire"), and there is no other
     *    signal.
     * 3. MASK THE MAP with `mask: [page.locator('canvas')]`. MEASURED: the entire snapshot came out solid
     *    magenta and the test passed twice in a row. The map canvas is `position: absolute; inset: 0` behind
     *    the whole UI, so its bounding box IS the viewport and the mask covers everything. A test that
     *    passes against a single flat colour is exactly the vacuous-pass failure this repo keeps warning
     *    about, so it was not kept.
     *
     * What would make this test possible again: an element-scoped screenshot of the bottom sheet
     * (`expect(sheet).toHaveScreenshot()`), which needs a stable `data-testid` on the sheet container —
     * there is none today, and adding one is a source change outside MAP-05's file list. That is the
     * cheapest route back to this coverage and is the recommended follow-up.
     *
     * 'mobile visual regression' (the globe) is UNAFFECTED and still runs: MAP-02 draws that surface from
     * vendored geometry with no tiles and no third party, so it is deterministic by construction. That
     * asymmetry is itself worth noticing — the screen we own can be pinned and the one we rent cannot.
     */
});

test.describe('Photo Lightbox', () => {
    test('a selected journey renders its overview on every viewport', async ({ page }) => {
        // This is the only test in this file the chromium gate runs. It no longer pretends to
        // open a lightbox: the `role="tab"` selector it used matches nothing in the app, so the
        // whole lightbox body was dead code behind an `isVisible()` guard that was always false.
        // Covering the lightbox properly needs a photo entry point that exists — worth its own
        // task rather than a test that reports green for doing nothing.
        await openApp(page);
        await selectFirstTrek(page);

        await page.getByText('Explore Journey →').click();
        await expect(page.getByText('DURATION')).toBeVisible({ timeout: TIMEOUTS.dataLoad });
    });
});
