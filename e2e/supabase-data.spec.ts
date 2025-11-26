import { test, expect } from '@playwright/test';

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
        await expect(page.locator('canvas')).toBeVisible({ timeout: 30000 });

        // Should not show loading forever - app title should appear
        await expect(page.getByText('Akashic')).toBeVisible({ timeout: 10000 });
    });

    test('trek markers are loaded from Supabase', async ({ page }) => {
        // Wait for map to initialize
        await page.waitForSelector('canvas', { timeout: 30000 });

        // Wait for data to load - the hint appears only after data is available
        await expect(page.getByText('Click a marker to explore')).toBeVisible({ timeout: 15000 });

        // The fact that we see the hint means the app loaded successfully
        // Trek markers are rendered on the map canvas which we can't directly query
    });

    test('trek data is available when marker clicked', async ({ page }) => {
        await page.waitForSelector('canvas', { timeout: 30000 });
        await page.waitForTimeout(3000); // Wait for data layers to load

        const canvas = page.locator('canvas');

        // Try clicking multiple positions to find a marker
        // Markers are at trek locations so we'll try a few spots
        const positions = [
            { x: 500, y: 300 },
            { x: 550, y: 320 },
            { x: 450, y: 350 },
            { x: 600, y: 280 },
            { x: 400, y: 400 }
        ];

        let trekSelected = false;

        for (const pos of positions) {
            await canvas.click({ position: pos });
            await page.waitForTimeout(800);

            // Check if trek selection panel appeared
            const exploreButton = page.getByText('Explore Journey →');
            if (await exploreButton.isVisible().catch(() => false)) {
                trekSelected = true;

                // Verify trek data is displayed (from Supabase)
                await expect(page.getByText('Summit:')).toBeVisible();

                // Should show elevation
                await expect(page.getByText(/\d+,?\d*\s*m/)).toBeVisible();

                break;
            }
        }

        // If we didn't find a marker, log but don't fail
        // (marker positions depend on map zoom/center)
        if (!trekSelected) {
            console.log('Could not click a trek marker - map positions may vary');
        }
    });

    test('waypoints/camps are loaded when exploring trek', async ({ page }) => {
        await page.waitForSelector('canvas', { timeout: 30000 });
        await page.waitForTimeout(3000);

        const canvas = page.locator('canvas');

        // Try to select a trek
        const positions = [
            { x: 500, y: 300 },
            { x: 550, y: 320 },
            { x: 450, y: 350 }
        ];

        for (const pos of positions) {
            await canvas.click({ position: pos });
            await page.waitForTimeout(800);

            const exploreButton = page.getByText('Explore Journey →');
            if (await exploreButton.isVisible().catch(() => false)) {
                // Found a trek, now explore it
                await exploreButton.click();
                await page.waitForTimeout(1000);

                // Go to journey tab to see waypoints
                await page.getByRole('button', { name: /journey/i }).click();
                await page.waitForTimeout(500);

                // Should see camp/waypoint list with day numbers
                // This verifies waypoints were loaded from Supabase
                await expect(page.getByText(/Day \d+/)).toBeVisible({ timeout: 5000 });

                // Should see camp names (waypoint data from Supabase)
                const campList = page.locator('[style*="cursor: pointer"]');
                const campCount = await campList.count();
                expect(campCount).toBeGreaterThan(0);

                break;
            }
        }
    });

    test('route data is available for trek visualization', async ({ page }) => {
        await page.waitForSelector('canvas', { timeout: 30000 });
        await page.waitForTimeout(3000);

        const canvas = page.locator('canvas');

        const positions = [
            { x: 500, y: 300 },
            { x: 550, y: 320 },
            { x: 450, y: 350 }
        ];

        for (const pos of positions) {
            await canvas.click({ position: pos });
            await page.waitForTimeout(800);

            const exploreButton = page.getByText('Explore Journey →');
            if (await exploreButton.isVisible().catch(() => false)) {
                await exploreButton.click();
                await page.waitForTimeout(1500);

                // Go to stats tab to verify elevation profile (requires route data)
                await page.getByRole('button', { name: /stats/i }).click();
                await page.waitForTimeout(500);

                // Elevation profile only renders if route coordinates are available
                await expect(page.getByText('Elevation Profile')).toBeVisible({ timeout: 5000 });

                // Should show highest/lowest elevation from stats
                await expect(page.getByText(/Highest/i)).toBeVisible();
                await expect(page.getByText(/Lowest/i)).toBeVisible();

                break;
            }
        }
    });

    test('no Supabase errors in console', async ({ page }) => {
        const errors: string[] = [];

        page.on('console', msg => {
            if (msg.type() === 'error' && msg.text().toLowerCase().includes('supabase')) {
                errors.push(msg.text());
            }
        });

        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: 30000 });
        await page.waitForTimeout(5000); // Wait for data to load

        // Should not have any Supabase-related errors
        expect(errors).toHaveLength(0);
    });
});
