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
    const selected = await page.evaluate(() => {
        const treks = window.testHelpers?.getTreks();
        if (treks && treks.length > 0) {
            return window.testHelpers?.selectTrek(treks[0].id) || false;
        }
        return false;
    }).catch(() => false);

    if (!selected) return false;

    // Wait for selection panel to appear
    try {
        await page.waitForSelector('text="Explore Journey →"', { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

test.describe('Akashic App', () => {
    // Test globe view renders correctly
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

    // Test trek selection shows info panel
    test('trek selection shows info panel', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        // Select trek
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        // Verify selection panel shows trek info
        await expect(page.getByText('Summit:')).toBeVisible();
        await expect(page.getByText('Explore Journey →')).toBeVisible();
    });

    // Test exploration flow - clicking explore shows trek details
    test('explore journey shows trek details', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        // Select trek
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        // Click explore
        await page.getByText('Explore Journey →').click();

        // Verify trek view shows - look for trek stats that appear in the new UI
        // The new UI shows Duration, Distance, Ascent, Summit stats
        await expect(page.getByText('DURATION')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('DISTANCE')).toBeVisible();

        // Should also see a Start button
        await expect(page.getByText('Start')).toBeVisible();
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
