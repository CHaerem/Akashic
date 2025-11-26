import { test, expect } from '@playwright/test';

test.describe('Photo Lightbox', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // Wait for map to initialize
        await page.waitForSelector('canvas', { timeout: 30000 });
    });

    /**
     * Helper to navigate to a trek with photos
     */
    async function navigateToTrekPhotos(page: import('@playwright/test').Page) {
        const canvas = page.locator('canvas');

        // Try clicking different positions to find a trek marker
        const positions = [
            { x: 500, y: 300 },
            { x: 600, y: 350 },
            { x: 400, y: 400 },
            { x: 550, y: 280 }
        ];

        for (const pos of positions) {
            await canvas.click({ position: pos });
            await page.waitForTimeout(500);

            const exploreButton = page.getByText('Explore Journey →');
            if (await exploreButton.isVisible().catch(() => false)) {
                await exploreButton.click();
                await page.waitForTimeout(500);

                // Go to Photos tab
                const photosTab = page.getByRole('button', { name: /photos/i });
                if (await photosTab.isVisible().catch(() => false)) {
                    await photosTab.click();
                    await page.waitForTimeout(300);
                    return true;
                }
            }
        }
        return false;
    }

    test('clicking backdrop closes lightbox', async ({ page }) => {
        const found = await navigateToTrekPhotos(page);
        if (!found) {
            test.skip();
            return;
        }

        // Wait for photos to potentially load
        await page.waitForTimeout(2000);

        // Check if there are any photo thumbnails
        const photoThumbnails = page.locator('img[alt*="photo"], img[alt*="Photo"]').first();

        if (await photoThumbnails.isVisible().catch(() => false)) {
            // Click to open lightbox
            await photoThumbnails.click();
            await page.waitForTimeout(500);

            // Lightbox should be open (check for close button)
            const closeButton = page.locator('button[aria-label="Close"]');
            await expect(closeButton).toBeVisible({ timeout: 3000 });

            // Get the lightbox container (the backdrop)
            const lightbox = page.locator('[style*="z-index: 9999"]');
            await expect(lightbox).toBeVisible();

            // Click on the backdrop (edge of the screen, not on the image)
            await lightbox.click({ position: { x: 10, y: 10 } });
            await page.waitForTimeout(500);

            // Lightbox should be closed
            await expect(closeButton).not.toBeVisible();
        }
    });

    test('clicking X button closes lightbox', async ({ page }) => {
        const found = await navigateToTrekPhotos(page);
        if (!found) {
            test.skip();
            return;
        }

        await page.waitForTimeout(2000);

        const photoThumbnails = page.locator('img[alt*="photo"], img[alt*="Photo"]').first();

        if (await photoThumbnails.isVisible().catch(() => false)) {
            await photoThumbnails.click();
            await page.waitForTimeout(500);

            const closeButton = page.locator('button[aria-label="Close"]');
            await expect(closeButton).toBeVisible({ timeout: 3000 });

            // Click the X button
            await closeButton.click();
            await page.waitForTimeout(300);

            // Lightbox should be closed
            await expect(closeButton).not.toBeVisible();
        }
    });

    test('pressing Escape closes lightbox', async ({ page }) => {
        const found = await navigateToTrekPhotos(page);
        if (!found) {
            test.skip();
            return;
        }

        await page.waitForTimeout(2000);

        const photoThumbnails = page.locator('img[alt*="photo"], img[alt*="Photo"]').first();

        if (await photoThumbnails.isVisible().catch(() => false)) {
            await photoThumbnails.click();
            await page.waitForTimeout(500);

            const closeButton = page.locator('button[aria-label="Close"]');
            await expect(closeButton).toBeVisible({ timeout: 3000 });

            // Press Escape
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);

            // Lightbox should be closed
            await expect(closeButton).not.toBeVisible();
        }
    });

    test('clicking on image does NOT close lightbox', async ({ page }) => {
        const found = await navigateToTrekPhotos(page);
        if (!found) {
            test.skip();
            return;
        }

        await page.waitForTimeout(2000);

        const photoThumbnails = page.locator('img[alt*="photo"], img[alt*="Photo"]').first();

        if (await photoThumbnails.isVisible().catch(() => false)) {
            await photoThumbnails.click();
            await page.waitForTimeout(500);

            const closeButton = page.locator('button[aria-label="Close"]');
            await expect(closeButton).toBeVisible({ timeout: 3000 });

            // Wait for image to load
            await page.waitForTimeout(1000);

            // Click on the image (center of screen)
            const lightboxImage = page.locator('[style*="z-index: 9999"] img');
            if (await lightboxImage.isVisible().catch(() => false)) {
                await lightboxImage.click();
                await page.waitForTimeout(300);

                // Lightbox should still be open
                await expect(closeButton).toBeVisible();
            }
        }
    });

    test('arrow keys navigate between photos', async ({ page }) => {
        const found = await navigateToTrekPhotos(page);
        if (!found) {
            test.skip();
            return;
        }

        await page.waitForTimeout(2000);

        const photoThumbnails = page.locator('img[alt*="photo"], img[alt*="Photo"]').first();

        if (await photoThumbnails.isVisible().catch(() => false)) {
            await photoThumbnails.click();
            await page.waitForTimeout(500);

            // Look for photo counter (e.g., "1 / 5")
            const photoCounter = page.locator('span:has-text(" / ")');

            if (await photoCounter.isVisible().catch(() => false)) {
                const initialText = await photoCounter.textContent();

                // Try right arrow
                await page.keyboard.press('ArrowRight');
                await page.waitForTimeout(300);

                const newText = await photoCounter.textContent();

                // If there are multiple photos, counter should change
                if (initialText?.includes('1 /') && !initialText.endsWith('/ 1')) {
                    expect(newText).not.toBe(initialText);
                }
            }
        }
    });

    test('navigation buttons work', async ({ page }) => {
        const found = await navigateToTrekPhotos(page);
        if (!found) {
            test.skip();
            return;
        }

        await page.waitForTimeout(2000);

        const photoThumbnails = page.locator('img[alt*="photo"], img[alt*="Photo"]').first();

        if (await photoThumbnails.isVisible().catch(() => false)) {
            await photoThumbnails.click();
            await page.waitForTimeout(500);

            // Look for next button
            const nextButton = page.locator('button[aria-label="Next photo"]');

            if (await nextButton.isVisible().catch(() => false)) {
                const photoCounter = page.locator('span:has-text(" / ")');
                const initialText = await photoCounter.textContent().catch(() => '');

                await nextButton.click();
                await page.waitForTimeout(300);

                const newText = await photoCounter.textContent().catch(() => '');

                // Counter should change
                expect(newText).not.toBe(initialText);
            }
        }
    });

    test('controls auto-hide after timeout', async ({ page }) => {
        const found = await navigateToTrekPhotos(page);
        if (!found) {
            test.skip();
            return;
        }

        await page.waitForTimeout(2000);

        const photoThumbnails = page.locator('img[alt*="photo"], img[alt*="Photo"]').first();

        if (await photoThumbnails.isVisible().catch(() => false)) {
            await photoThumbnails.click();
            await page.waitForTimeout(500);

            const closeButton = page.locator('button[aria-label="Close"]');
            await expect(closeButton).toBeVisible({ timeout: 3000 });

            // Wait for controls to auto-hide (5 seconds + buffer)
            await page.waitForTimeout(6000);

            // Close button should have opacity 0 (hidden via CSS)
            // We check if it's still in DOM but has pointer-events: none
            const topBar = page.locator('[style*="z-index: 9999"] > div').first();
            const opacity = await topBar.evaluate(el =>
                window.getComputedStyle(el).opacity
            ).catch(() => '1');

            expect(parseFloat(opacity)).toBeLessThan(1);
        }
    });

    test('clicking shows hidden controls', async ({ page }) => {
        const found = await navigateToTrekPhotos(page);
        if (!found) {
            test.skip();
            return;
        }

        await page.waitForTimeout(2000);

        const photoThumbnails = page.locator('img[alt*="photo"], img[alt*="Photo"]').first();

        if (await photoThumbnails.isVisible().catch(() => false)) {
            await photoThumbnails.click();
            await page.waitForTimeout(500);

            // Wait for controls to auto-hide
            await page.waitForTimeout(6000);

            // Click on image to show controls again
            const lightboxImage = page.locator('[style*="z-index: 9999"] img');
            if (await lightboxImage.isVisible().catch(() => false)) {
                await lightboxImage.click();
                await page.waitForTimeout(500);

                // Controls should be visible again
                const closeButton = page.locator('button[aria-label="Close"]');
                const opacity = await closeButton.evaluate(el =>
                    window.getComputedStyle(el).opacity
                ).catch(() => '0');

                expect(parseFloat(opacity)).toBeGreaterThan(0);
            }
        }
    });
});
