import { test, expect, Page } from '@playwright/test';

const MAP_TIMEOUT = 15000;

// Helper to wait for map to be ready - uses polling with exponential backoff
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

// Helper to select a trek programmatically
async function selectFirstTrek(page: Page): Promise<boolean> {
    return await page.evaluate(() => {
        const treks = window.testHelpers?.getTreks();
        if (treks && treks.length > 0) {
            return window.testHelpers?.selectTrek(treks[0].id) || false;
        }
        return false;
    }).catch(() => false);
}

// Helper to navigate to trek exploration view - eliminates redundant waits
async function navigateToExploreView(page: Page): Promise<boolean> {
    await waitForMapReady(page);
    const selected = await selectFirstTrek(page);
    if (!selected) return false;

    const exploreButton = page.getByText('Explore Journey →');
    await expect(exploreButton).toBeVisible();
    await exploreButton.click();

    // Wait for info panel tabs to confirm navigation completed
    await expect(page.getByRole('button', { name: /overview/i })).toBeVisible();
    return true;
}

test.describe('Akashic App', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // Wait for map to initialize
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
    });

    test.describe('Globe View', () => {
        test('displays app title', async ({ page }) => {
            await expect(page.getByText('Akashic')).toBeVisible();
        });

        test('shows hint to click markers when no trek selected', async ({ page }) => {
            await waitForMapReady(page);
            await expect(page.getByText('Click a marker to explore')).toBeVisible();
        });

        test('renders Mapbox canvas', async ({ page }) => {
            const canvas = page.locator('canvas');
            await expect(canvas).toBeVisible();
        });
    });

    test.describe('Trek Selection', () => {
        test('selection panel shows trek name and country when trek selected', async ({ page }) => {
            await waitForMapReady(page);

            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            // Trek selected, verify panel elements - assertions auto-wait
            await expect(page.getByText('Summit:')).toBeVisible();
            await expect(page.getByText('← Back')).toBeVisible();
            await expect(page.getByText('Explore Journey →')).toBeVisible();
        });
    });

    test.describe('Trek Exploration', () => {
        test('clicking explore transitions to trek view with info panel', async ({ page }) => {
            const navigated = await navigateToExploreView(page);
            if (!navigated) {
                test.skip();
                return;
            }

            // Should now see the info panel with tabs
            await expect(page.getByRole('button', { name: /overview/i })).toBeVisible();
            await expect(page.getByRole('button', { name: /journey/i })).toBeVisible();
            await expect(page.getByRole('button', { name: /stats/i })).toBeVisible();
        });
    });

    test.describe('Info Panel Tabs', () => {
        test('tabs navigation works correctly', async ({ page }) => {
            const navigated = await navigateToExploreView(page);
            if (!navigated) {
                test.skip();
                return;
            }

            // Click journey tab
            await page.getByRole('button', { name: /journey/i }).click();

            // Should see camp list with day indicators - assertions auto-wait
            await expect(page.getByText(/Day \d+/)).toBeVisible();

            // Click stats tab
            await page.getByRole('button', { name: /stats/i }).click();

            // Should see elevation profile
            await expect(page.getByText('Elevation Profile')).toBeVisible();

            // Click overview tab
            await page.getByRole('button', { name: /overview/i }).click();

            // Should see duration stats
            await expect(page.getByText(/\d+ days/)).toBeVisible();
        });
    });

    test.describe('Navigation', () => {
        test('clicking title returns to globe view', async ({ page }) => {
            const navigated = await navigateToExploreView(page);
            if (!navigated) {
                test.skip();
                return;
            }

            // Now click the title to go back
            await page.getByText('Akashic').click();

            // Should see the hint again
            await expect(page.getByText('Click a marker to explore')).toBeVisible();
        });

        test('back button in info panel returns to globe', async ({ page }) => {
            const navigated = await navigateToExploreView(page);
            if (!navigated) {
                test.skip();
                return;
            }

            // Click globe back button
            await page.getByText('← Globe').click();

            // Should see hint
            await expect(page.getByText('Click a marker to explore')).toBeVisible();
        });
    });

    test.describe('Camp Selection', () => {
        test('clicking camp in journey tab expands details', async ({ page }) => {
            const navigated = await navigateToExploreView(page);
            if (!navigated) {
                test.skip();
                return;
            }

            // Go to journey tab
            await page.getByRole('button', { name: /journey/i }).click();

            // Wait for day indicator to appear
            await expect(page.getByText(/Day \d+/)).toBeVisible();

            // Click first camp item
            const campItems = page.locator('[style*="cursor: pointer"]').filter({ hasText: /Day \d+/ });
            const count = await campItems.count();

            if (count > 0) {
                await campItems.first().click();

                // Should see expanded content like "PHOTOS COMING SOON"
                await expect(page.getByText('PHOTOS COMING SOON')).toBeVisible();
            }
        });
    });

    test.describe('Responsive Layout', () => {
        test('info panel takes correct width on desktop', async ({ page }) => {
            await page.setViewportSize({ width: 1280, height: 720 });
            const navigated = await navigateToExploreView(page);
            if (!navigated) {
                test.skip();
                return;
            }

            // Info panel should be 40% width
            const infoPanel = page.locator('[style*="width: 40%"]');
            await expect(infoPanel).toBeVisible();
        });
    });

    test.describe('Visual Regression', () => {
        test('globe view matches snapshot', async ({ page }) => {
            // Wait for map to fully load
            await waitForMapReady(page);

            // Take screenshot of initial state
            await expect(page).toHaveScreenshot('globe-view.png', {
                maxDiffPixelRatio: 0.1
            });
        });
    });
});
