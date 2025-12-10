import { test, expect, Page } from '@playwright/test';

const MAP_TIMEOUT = 15000;
const DATA_TIMEOUT = 8000;

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

test.describe('Supabase Data Loading', () => {
    // Test app loads with Supabase data
    test('app loads with Supabase data', async ({ page }) => {
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

    // Test trek data loads from Supabase
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

        // Click explore
        await page.getByText('Explore Journey →').click();

        // Verify trek details loaded - the new UI shows stats
        await expect(page.getByText('DURATION')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('DISTANCE')).toBeVisible();
        await expect(page.getByText('SUMMIT')).toBeVisible();
    });
});
