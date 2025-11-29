import { test, expect, Page } from '@playwright/test';

/**
 * Tests for globe centering behavior after zoom/pan operations.
 *
 * Issue: Zooming in, moving around, and then zooming back out
 * can cause the globe position to shift so it's no longer centered.
 *
 * Fix: The useMapbox hook now includes a zoomend listener that automatically
 * recenters the globe when the user zooms back out to globe level (zoom < 2.5)
 * while in globe view mode with no trek selected.
 */
test.describe('Globe Zoom Centering', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // Wait for map canvas to be ready
        await page.waitForSelector('canvas', { timeout: 30000 });
        // Wait for map to fully initialize and settle
        await page.waitForTimeout(2000);
    });

    /**
     * Helper to simulate scroll wheel zoom on the map canvas
     */
    async function scrollZoom(page: Page, deltaY: number, times: number = 1): Promise<void> {
        const canvas = page.locator('canvas');
        const box = await canvas.boundingBox();
        if (!box) throw new Error('Canvas not found');

        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;

        await page.mouse.move(centerX, centerY);

        for (let i = 0; i < times; i++) {
            await page.mouse.wheel(0, deltaY);
            await page.waitForTimeout(100);
        }
    }

    /**
     * Helper to simulate drag/pan on the map
     */
    async function panMap(page: Page, offsetX: number, offsetY: number): Promise<void> {
        const canvas = page.locator('canvas');
        const box = await canvas.boundingBox();
        if (!box) throw new Error('Canvas not found');

        const startX = box.x + box.width / 2;
        const startY = box.y + box.height / 2;

        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX + offsetX, startY + offsetY, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(300);
    }

    test('globe returns to center after zoom in, pan, and zoom out', async ({ page }) => {
        // Wait for globe rotation to start (indicates globe is ready)
        await page.waitForTimeout(4000);

        // Stop rotation by clicking the map
        const canvas = page.locator('canvas');
        await canvas.click();
        await page.waitForTimeout(500);

        // STEP 1: Zoom in significantly
        await scrollZoom(page, -200, 5); // Negative = zoom in
        await page.waitForTimeout(1000);

        // STEP 2: Pan the map in various directions to move away from center
        await panMap(page, 150, 0);   // Pan right
        await panMap(page, 0, -100);  // Pan up
        await panMap(page, -100, 50); // Pan left-down
        await page.waitForTimeout(500);

        // STEP 3: Zoom back out to globe view
        await scrollZoom(page, 200, 8); // Positive = zoom out
        await page.waitForTimeout(2500); // Wait for auto-recenter animation

        // The globe should now be properly centered (auto-recenter triggered)
        await expect(page).toHaveScreenshot('globe-centered-after-zoom.png', {
            maxDiffPixelRatio: 0.15,
            threshold: 0.3
        });
    });

    test('globe center position is stable after multiple zoom/pan cycles', async ({ page }) => {
        // Wait for initial load and rotation
        await page.waitForTimeout(4000);

        // Stop rotation
        const canvas = page.locator('canvas');
        await canvas.click();
        await page.waitForTimeout(500);

        // Perform multiple zoom/pan cycles
        for (let cycle = 0; cycle < 3; cycle++) {
            // Zoom in
            await scrollZoom(page, -150, 4);
            await page.waitForTimeout(500);

            // Pan movements
            await panMap(page, (cycle + 1) * 50, -(cycle + 1) * 30);
            await panMap(page, -(cycle + 1) * 30, (cycle + 1) * 40);
            await page.waitForTimeout(300);

            // Zoom back out
            await scrollZoom(page, 150, 6);
            await page.waitForTimeout(2000); // Wait for auto-recenter
        }

        // After all cycles, the globe should still be centered
        await expect(page).toHaveScreenshot('globe-after-multi-cycles.png', {
            maxDiffPixelRatio: 0.2,
            threshold: 0.3
        });
    });

    test('clicking title recenters globe after pan/zoom', async ({ page }) => {
        // Wait for initial load
        await page.waitForTimeout(3000);

        // Stop rotation
        const canvas = page.locator('canvas');
        await canvas.click();
        await page.waitForTimeout(500);

        // Zoom in and pan to disrupt centering
        await scrollZoom(page, -200, 5);
        await page.waitForTimeout(500);
        await panMap(page, 200, -100);
        await page.waitForTimeout(500);

        // Zoom back out (auto-recenter should trigger)
        await scrollZoom(page, 200, 6);
        await page.waitForTimeout(2000);

        // Click the Akashic title to explicitly trigger flyToGlobe
        await page.getByText('Akashic').click();
        await page.waitForTimeout(3500); // Wait for flyToGlobe animation

        // The globe should be properly centered
        await expect(page).toHaveScreenshot('globe-recentered-via-title.png', {
            maxDiffPixelRatio: 0.15,
            threshold: 0.3
        });
    });
});
