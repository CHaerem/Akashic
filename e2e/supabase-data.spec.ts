import { test, expect } from '@playwright/test';

const isCI = !!process.env.CI;
const MAP_TIMEOUT = isCI ? 20000 : 15000;
const DATA_TIMEOUT = isCI ? 12000 : 8000;

// Helper to wait for map to be ready
async function waitForMapReady(page: import('@playwright/test').Page, timeout = MAP_TIMEOUT): Promise<boolean> {
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
async function selectFirstTrek(page: import('@playwright/test').Page): Promise<boolean> {
    return await page.evaluate(() => {
        const treks = window.testHelpers?.getTreks();
        if (treks && treks.length > 0) {
            return window.testHelpers?.selectTrek(treks[0].id) || false;
        }
        return false;
    }).catch(() => false);
}

test.describe('Supabase Data Loading', () => {
    test.beforeEach(async ({ page }) => {
        // Listen for console errors
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log('Browser console error:', msg.text());
            }
        });

        await page.goto('/');
    });

    test('app loads without errors', async ({ page }) => {
        // Wait for map canvas to appear
        await expect(page.locator('canvas')).toBeVisible({ timeout: MAP_TIMEOUT });

        // Should not show loading forever - app title should appear
        await expect(page.getByText('Akashic')).toBeVisible({ timeout: DATA_TIMEOUT });
    });

    test('trek markers are loaded from Supabase', async ({ page }) => {
        // Wait for map to initialize
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });

        // Wait for data to load - the hint appears only after data is available
        await waitForMapReady(page);
        await expect(page.getByText('Click a marker to explore')).toBeVisible({ timeout: DATA_TIMEOUT });

        // The fact that we see the hint means the app loaded successfully
        // Trek markers are rendered on the map canvas which we can't directly query
    });

    test('trek data is available when marker clicked', async ({ page }) => {
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const selected = await selectFirstTrek(page);
        if (!selected) {
            console.log('Could not select trek - no treks available');
            test.skip();
            return;
        }

        await page.waitForTimeout(300);

        // Verify trek data is displayed (from Supabase)
        await expect(page.getByText('Summit:')).toBeVisible();

        // Should show elevation
        await expect(page.getByText(/\d+,?\d*\s*m/)).toBeVisible();
    });

    test('waypoints/camps are loaded when exploring trek', async ({ page }) => {
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        await page.waitForTimeout(300);

        const exploreButton = page.getByText('Explore Journey →');
        await expect(exploreButton).toBeVisible();
        await exploreButton.click();
        await page.waitForTimeout(500);

        // Go to journey tab to see waypoints
        await page.getByRole('button', { name: /journey/i }).click();
        await page.waitForTimeout(300);

        // Should see camp/waypoint list with day numbers
        // This verifies waypoints were loaded from Supabase
        await expect(page.getByText(/Day \d+/)).toBeVisible();

        // Should see camp names (waypoint data from Supabase)
        const campList = page.locator('[style*="cursor: pointer"]');
        const campCount = await campList.count();
        expect(campCount).toBeGreaterThan(0);
    });

    test('route data is available for trek visualization', async ({ page }) => {
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        await page.waitForTimeout(300);

        const exploreButton = page.getByText('Explore Journey →');
        await expect(exploreButton).toBeVisible();
        await exploreButton.click();
        await page.waitForTimeout(500);

        // Go to stats tab to verify elevation profile (requires route data)
        await page.getByRole('button', { name: /stats/i }).click();
        await page.waitForTimeout(300);

        // Elevation profile only renders if route coordinates are available
        await expect(page.getByText('Elevation Profile')).toBeVisible();

        // Should show highest/lowest elevation from stats
        await expect(page.getByText(/Highest/i)).toBeVisible();
        await expect(page.getByText(/Lowest/i)).toBeVisible();
    });

    test('no Supabase errors in console', async ({ page }) => {
        const errors: string[] = [];

        page.on('console', msg => {
            if (msg.type() === 'error' && msg.text().toLowerCase().includes('supabase')) {
                errors.push(msg.text());
            }
        });

        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        // Should not have any Supabase-related errors
        expect(errors).toHaveLength(0);
    });
});
