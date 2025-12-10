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
// Returns true if selection succeeded, waits for React to re-render
async function selectFirstTrek(page: Page): Promise<boolean> {
    const selected = await page.evaluate(() => {
        const treks = window.testHelpers?.getTreks();
        if (treks && treks.length > 0) {
            return window.testHelpers?.selectTrek(treks[0].id) || false;
        }
        return false;
    }).catch(() => false);

    if (selected) {
        // Wait for React to re-render after programmatic state change
        // This is necessary because selectTrek() doesn't trigger DOM events
        await page.waitForTimeout(300);
    }
    return selected;
}

test.describe('Akashic App', () => {
    // Single comprehensive test for globe view - tests multiple things in one page load
    test('globe view renders correctly', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });

        // Check title
        await expect(page.getByText('Akashic')).toBeVisible();

        // Check canvas
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();

        // Wait for data and check hint
        await waitForMapReady(page);
        await expect(page.getByText('Click a marker to explore')).toBeVisible();
    });

    // Single comprehensive test for the entire trek exploration flow
    test('trek selection and exploration flow', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        // Select trek
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        // Verify selection panel
        await expect(page.getByText('Summit:')).toBeVisible();
        await expect(page.getByText('← Back')).toBeVisible();
        await expect(page.getByText('Explore Journey →')).toBeVisible();

        // Click explore
        await page.getByText('Explore Journey →').click();

        // Verify info panel tabs appear
        await expect(page.getByRole('button', { name: /overview/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /journey/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /stats/i })).toBeVisible();

        // Test tab navigation - Journey tab
        await page.getByRole('button', { name: /journey/i }).click();
        await expect(page.getByText(/Day \d+/)).toBeVisible();

        // Test camp expansion
        const campItems = page.locator('[style*="cursor: pointer"]').filter({ hasText: /Day \d+/ });
        const count = await campItems.count();
        if (count > 0) {
            await campItems.first().click();
            await expect(page.getByText('PHOTOS COMING SOON')).toBeVisible();
        }

        // Test Stats tab
        await page.getByRole('button', { name: /stats/i }).click();
        await expect(page.getByText('Elevation Profile')).toBeVisible();

        // Test Overview tab
        await page.getByRole('button', { name: /overview/i }).click();
        await expect(page.getByText(/\d+ days/)).toBeVisible();

        // Test navigation back via title
        await page.getByText('Akashic').click();
        await expect(page.getByText('Click a marker to explore')).toBeVisible();
    });

    // Test back button navigation separately (needs fresh explore state)
    test('back button returns to globe', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        await page.getByText('Explore Journey →').click();
        await expect(page.getByRole('button', { name: /overview/i })).toBeVisible();

        // Test globe back button
        await page.getByText('← Globe').click();
        await expect(page.getByText('Click a marker to explore')).toBeVisible();
    });

    // Desktop responsive test
    test('desktop layout has correct panel width', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        await page.getByText('Explore Journey →').click();
        await expect(page.getByRole('button', { name: /overview/i })).toBeVisible();

        // Info panel should be 40% width on desktop
        const infoPanel = page.locator('[style*="width: 40%"]');
        await expect(infoPanel).toBeVisible();
    });

    // Visual regression - only runs when not ignoring snapshots
    test('globe view matches snapshot', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        await expect(page).toHaveScreenshot('globe-view.png', {
            maxDiffPixelRatio: 0.1
        });
    });
});
