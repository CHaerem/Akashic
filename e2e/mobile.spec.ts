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

    test('trek view visual regression', async ({ page }) => {
        await openApp(page);
        await selectFirstTrek(page);

        await page.getByText('Explore Journey →').click();
        await expect(page.getByText('DURATION')).toBeVisible({ timeout: TIMEOUTS.dataLoad });

        // Let the entry animation settle before capturing.
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot('mobile-trek-view.png', { maxDiffPixelRatio: 0.15 });
    });
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
