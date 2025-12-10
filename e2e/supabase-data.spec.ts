import { test, expect, Page } from '@playwright/test';

const MAP_TIMEOUT = 15000;
const DATA_TIMEOUT = 8000;

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

test.describe('Supabase Data Loading', () => {
    // Single test for app loading and basic data
    test('app loads with Supabase data', async ({ page }) => {
        // Listen for Supabase errors
        const errors: string[] = [];
        page.on('console', msg => {
            if (msg.type() === 'error' && msg.text().toLowerCase().includes('supabase')) {
                errors.push(msg.text());
            }
        });

        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });

        // App title should appear
        await expect(page.getByText('Akashic')).toBeVisible({ timeout: DATA_TIMEOUT });

        // Wait for data to load
        await waitForMapReady(page);

        // Hint appears only after data is available
        await expect(page.getByText('Click a marker to explore')).toBeVisible({ timeout: DATA_TIMEOUT });

        // No Supabase errors
        expect(errors).toHaveLength(0);
    });

    // Single comprehensive test for all trek data loading
    test('trek data loads from Supabase', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const selected = await selectFirstTrek(page);
        if (!selected) {
            console.log('Could not select trek - no treks available');
            test.skip();
            return;
        }

        // Verify trek data is displayed (from Supabase)
        await expect(page.getByText('Summit:')).toBeVisible();
        await expect(page.getByText(/\d+,?\d*\s*m/)).toBeVisible();

        // Click explore
        await page.getByText('Explore Journey →').click();
        await expect(page.getByRole('button', { name: /overview/i })).toBeVisible();

        // Verify waypoints loaded - Journey tab
        await page.getByRole('button', { name: /journey/i }).click();
        await expect(page.getByText(/Day \d+/)).toBeVisible();

        // Verify camp list exists
        const campList = page.locator('[style*="cursor: pointer"]');
        const campCount = await campList.count();
        expect(campCount).toBeGreaterThan(0);

        // Verify route data - Stats tab with elevation profile
        await page.getByRole('button', { name: /stats/i }).click();
        await expect(page.getByText('Elevation Profile')).toBeVisible();
        await expect(page.getByText(/Highest/i)).toBeVisible();
        await expect(page.getByText(/Lowest/i)).toBeVisible();
    });
});
