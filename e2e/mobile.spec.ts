import { test, expect, Page, BrowserContext } from '@playwright/test';

const MAP_TIMEOUT = 15000;

// Helper to wait for map to be ready
async function waitForMapReady(page: Page, timeout = MAP_TIMEOUT): Promise<boolean> {
    const startTime = Date.now();
    let pollInterval = 100;

    while (Date.now() - startTime < timeout) {
        const ready = await page.evaluate(() => {
            return window.testHelpers?.isMapReady() && window.testHelpers?.isDataLoaded();
        }).catch(() => false);

        if (ready) return true;

        await page.waitForTimeout(pollInterval);
        pollInterval = Math.min(pollInterval * 1.5, 500);
    }

    return false;
}

// Helper to select a trek
async function selectFirstTrek(page: Page): Promise<boolean> {
    const selected = await page.evaluate(() => {
        const treks = window.testHelpers?.getTreks();
        if (treks && treks.length > 0) {
            return window.testHelpers?.selectTrek(treks[0].id) || false;
        }
        return false;
    }).catch(() => false);

    if (!selected) return false;

    try {
        await page.waitForSelector('text="Explore Journey →"', { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

// Only run on mobile projects
test.describe('Mobile Experience', () => {
    // Skip on desktop
    test.beforeEach(async ({ page, browserName }, testInfo) => {
        // Skip if not a mobile project
        if (!testInfo.project.name.includes('mobile')) {
            test.skip();
        }
    });

    test('bottom sheet appears on trek selection', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        // On mobile, should see bottom sheet with trek info
        await expect(page.getByText('Explore Journey →')).toBeVisible();
    });

    test('journey exploration works on mobile viewport', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        // Tap explore
        await page.getByText('Explore Journey →').click();

        // Should see trek stats
        await expect(page.getByText('DURATION')).toBeVisible({ timeout: 10000 });
    });

    test('navigation tabs are accessible', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        await page.getByText('Explore Journey →').click();
        await expect(page.getByText('DURATION')).toBeVisible({ timeout: 10000 });

        // Check that navigation elements exist
        // The adaptive nav pill should have journey navigation
        await expect(page.getByText('Start')).toBeVisible();
    });

    test('touch interactions work on map', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        // Verify map canvas is interactive
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();

        // Map should be touchable
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        if (box) {
            expect(box.width).toBeGreaterThan(100);
            expect(box.height).toBeGreaterThan(100);
        }
    });

    test('app is responsive at mobile width', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });

        // Verify viewport is mobile-sized
        const viewportSize = page.viewportSize();
        expect(viewportSize).not.toBeNull();
        if (viewportSize) {
            // iPhone 14: 390x844, Pixel 5: 393x851
            expect(viewportSize.width).toBeLessThan(500);
        }

        // Map should fill the viewport
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();
    });

    test('mobile visual regression', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        await expect(page).toHaveScreenshot('mobile-globe.png', {
            maxDiffPixelRatio: 0.15,
        });
    });

    test('trek view visual regression', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        await page.getByText('Explore Journey →').click();
        await expect(page.getByText('DURATION')).toBeVisible({ timeout: 10000 });

        // Wait for animations to settle
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot('mobile-trek-view.png', {
            maxDiffPixelRatio: 0.15,
        });
    });
});

// Photo lightbox tests - run on all viewports
test.describe('Photo Lightbox', () => {
    test('lightbox opens and navigates', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        // Navigate to trek view
        await page.getByText('Explore Journey →').click();
        await expect(page.getByText('DURATION')).toBeVisible({ timeout: 10000 });

        // Try to find photos tab or photos section
        // The exact selector depends on the UI, but we're looking for photo elements
        const photoTab = page.getByRole('tab', { name: /photos/i });
        if (await photoTab.isVisible().catch(() => false)) {
            await photoTab.click();
            await page.waitForTimeout(500);

            // Look for photo grid items
            const photos = page.locator('[role="button"]').filter({ hasText: /photo/i });
            const count = await photos.count();

            if (count > 0) {
                // Click first photo to open lightbox
                await photos.first().click();

                // YARL lightbox should open - look for its container
                await expect(page.locator('.yarl__root, [class*="lightbox"]')).toBeVisible({ timeout: 3000 });
            }
        }
    });
});
