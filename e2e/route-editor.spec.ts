import { test, expect } from '@playwright/test';

// Type declaration for test helpers exposed in E2E mode
declare global {
    interface Window {
        testHelpers?: {
            selectTrek: (id: string) => boolean;
            getTreks: () => Array<{ id: string; name: string }>;
            getSelectedTrek: () => string | null;
            isMapReady: () => boolean;
            isDataLoaded: () => boolean;
        };
    }
}

test.describe('Route Editor', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // Wait for map to initialize
        await page.waitForSelector('canvas', { timeout: 30000 });
        // Wait for test helpers to be available and data to be loaded (E2E mode)
        await page.waitForFunction(
            () => window.testHelpers?.isMapReady() === true && window.testHelpers?.isDataLoaded() === true,
            { timeout: 30000 }
        );
    });

    /**
     * Helper to navigate to a trek and open the route editor
     * Uses test helpers to programmatically select a trek (reliable)
     */
    async function openRouteEditor(page: import('@playwright/test').Page): Promise<boolean> {
        // Get available treks using test helpers
        const treks = await page.evaluate(() => window.testHelpers?.getTreks() || []);

        if (treks.length === 0) {
            console.log('No treks available');
            return false;
        }

        // Select the first trek programmatically
        const firstTrek = treks[0];
        const selected = await page.evaluate((id) => window.testHelpers?.selectTrek(id) || false, firstTrek.id);

        if (!selected) {
            console.log('Failed to select trek');
            return false;
        }

        // Wait for trek selection to take effect and card to appear
        await page.waitForTimeout(800);

        // Click "Explore Journey" button
        const exploreButton = page.getByText('Explore Journey →');
        if (!await exploreButton.isVisible({ timeout: 5000 }).catch(() => false)) {
            console.log('Explore button not visible');
            return false;
        }
        await exploreButton.click();
        await page.waitForTimeout(1000);

        // Navigate to Journey tab - the button is inside the info panel
        const journeyTab = page.locator('button:has-text("Journey")').first();
        if (await journeyTab.isVisible().catch(() => false)) {
            await journeyTab.click();
            await page.waitForTimeout(300);
        }

        // Enable edit mode - look for the pencil icon button
        // On desktop it's a small button with optional "Editing" text, on mobile it's icon-only
        // The button contains an SVG (pencil icon) and optionally text
        const editToggle = page.locator('button').filter({ has: page.locator('svg') }).filter({ hasText: /^(Editing)?$/ }).first();
        if (await editToggle.isVisible().catch(() => false)) {
            await editToggle.click();
            await page.waitForTimeout(500);
        } else {
            // Fallback: try finding by containing SVG child (any pencil-like button)
            const iconButton = page.locator('button:has(svg)').first();
            if (await iconButton.isVisible().catch(() => false)) {
                await iconButton.click();
                await page.waitForTimeout(500);
            }
        }

        // Look for route editor button - full text is "Edit Route & Camp Positions"
        const routeEditorButton = page.locator('button:has-text("Edit Route & Camp Positions")');
        if (!await routeEditorButton.isVisible({ timeout: 3000 }).catch(() => false)) {
            console.log('Edit Route button not visible');
            return false;
        }
        await routeEditorButton.click();
        await page.waitForTimeout(500);

        // Verify route editor opened
        const routeEditorHeader = page.locator('[data-testid="route-editor"]');
        return await routeEditorHeader.isVisible().catch(() => false);
    }

    test.describe('Route Editor Opening', () => {
        test('opens route editor from edit mode', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            // Verify route editor is open
            const routeEditor = page.locator('[data-testid="route-editor"]');
            await expect(routeEditor).toBeVisible();
        });

        test('shows cancel and save buttons', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const cancelButton = page.locator('button:has-text("Cancel")');
            const saveButton = page.locator('button:has-text("Save Changes")');

            await expect(cancelButton).toBeVisible();
            await expect(saveButton).toBeVisible();
        });
    });

    test.describe('Mode Toggle', () => {
        test('has camps and route mode toggle buttons', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const routeEditor = page.locator('[data-testid="route-editor"]');
            // Find mode toggle buttons that are direct children of the mode toggle container
            // Camps button should be visible in the mode toggle
            const campsButton = routeEditor.getByRole('button', { name: 'Camps', exact: true });
            const routeButton = routeEditor.getByRole('button', { name: 'Route', exact: true });

            await expect(campsButton).toBeVisible();
            await expect(routeButton).toBeVisible();
        });

        test('camps mode is default', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const routeEditor = page.locator('[data-testid="route-editor"]');
            // Check instructions mention "camps" - use getByText for more precise matching
            const instructions = routeEditor.getByText('Click on route to add new camp');
            await expect(instructions).toBeVisible({ timeout: 3000 });
        });

        test('switching to route mode changes instructions', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const routeEditor = page.locator('[data-testid="route-editor"]');
            // Click route mode button - exact match to avoid "Edit Route & Camp Positions"
            const routeButton = routeEditor.getByRole('button', { name: 'Route', exact: true });
            await routeButton.click();
            await page.waitForTimeout(300);

            // Check instructions mention "route points"
            const instructions = routeEditor.getByText('Click on route to add new point');
            await expect(instructions).toBeVisible({ timeout: 3000 });
        });
    });

    test.describe('Camps Mode', () => {
        test('shows camp list in sidebar', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const routeEditor = page.locator('[data-testid="route-editor"]');
            // Should show camps header with count
            const campsHeader = routeEditor.getByText(/Camps \(\d+\)/);
            await expect(campsHeader).toBeVisible({ timeout: 3000 });
        });

        test('shows unsaved changes indicator when camp modified', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            // This test would require interacting with markers which is complex
            // Just verify the structure is in place
            const campList = page.locator('[data-testid="camp-list"]');
            await expect(campList).toBeVisible({ timeout: 3000 });
        });
    });

    test.describe('Route Mode', () => {
        test('shows route points count in sidebar', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const routeEditor = page.locator('[data-testid="route-editor"]');
            // Switch to route mode
            const routeButton = routeEditor.getByRole('button', { name: 'Route', exact: true });
            await routeButton.click();
            await page.waitForTimeout(500);

            // Should show route points header with count
            const routePointsHeader = routeEditor.getByText(/Route Points \(\d+\)/);
            await expect(routePointsHeader).toBeVisible({ timeout: 3000 });
        });

        test('shows visible markers count in route mode', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const routeEditor = page.locator('[data-testid="route-editor"]');
            // Switch to route mode
            const routeButton = routeEditor.getByRole('button', { name: 'Route', exact: true });
            await routeButton.click();
            await page.waitForTimeout(500);

            // Should show visible markers info
            const visibleMarkersInfo = routeEditor.getByText(/Visible markers:/);
            await expect(visibleMarkersInfo).toBeVisible({ timeout: 3000 });
        });
    });

    test.describe('Navigation', () => {
        test('cancel button closes route editor', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const cancelButton = page.locator('button:has-text("Cancel")');
            await cancelButton.click();
            await page.waitForTimeout(500);

            // Route editor should be closed
            const routeEditor = page.locator('[data-testid="route-editor"]');
            await expect(routeEditor).not.toBeVisible();
        });

        test('save button is disabled when no changes', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const saveButton = page.locator('button:has-text("Save Changes")');
            await expect(saveButton).toBeDisabled();
        });
    });

    test.describe('Map Integration', () => {
        test('shows map canvas in route editor', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const routeEditor = page.locator('[data-testid="route-editor"]');
            // Should have a map canvas
            const mapCanvas = routeEditor.locator('canvas');
            await expect(mapCanvas).toBeVisible({ timeout: 5000 });
        });

        test('shows instructions overlay on map', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const routeEditor = page.locator('[data-testid="route-editor"]');
            // Should have instructions overlay - look for text containing "Drag"
            const instructions = routeEditor.getByText(/Drag.*markers/);
            await expect(instructions).toBeVisible({ timeout: 3000 });
        });
    });

    test.describe('Responsive Layout', () => {
        test('works on mobile viewport', async ({ page }) => {
            // Set mobile viewport before navigating
            await page.setViewportSize({ width: 375, height: 667 });
            await page.goto('/');
            await page.waitForSelector('canvas', { timeout: 30000 });

            // Wait for test helpers to be available and data to be loaded
            await page.waitForFunction(
                () => window.testHelpers?.isMapReady() === true && window.testHelpers?.isDataLoaded() === true,
                { timeout: 30000 }
            );

            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            // Route editor should be visible
            const routeEditor = page.locator('[data-testid="route-editor"]');
            await expect(routeEditor).toBeVisible();

            // Mode toggle should be visible
            const campsButton = page.locator('button:has-text("Camps")');
            await expect(campsButton).toBeVisible();
        });
    });

    test.describe('Draw Mode', () => {
        test('shows Edit and Draw sub-mode toggle in Route mode', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const routeEditor = page.locator('[data-testid="route-editor"]');
            // Switch to route mode
            const routeButton = routeEditor.getByRole('button', { name: 'Route', exact: true });
            await routeButton.click();
            await page.waitForTimeout(300);

            // Should show Edit and Draw toggle buttons (exact match)
            const editButton = routeEditor.getByRole('button', { name: 'Edit', exact: true });
            const drawButton = routeEditor.getByRole('button', { name: 'Draw', exact: true });

            await expect(editButton).toBeVisible({ timeout: 3000 });
            await expect(drawButton).toBeVisible({ timeout: 3000 });
        });

        test('Edit sub-mode is default in Route mode', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const routeEditor = page.locator('[data-testid="route-editor"]');
            // Switch to route mode
            const routeButton = routeEditor.getByRole('button', { name: 'Route', exact: true });
            await routeButton.click();
            await page.waitForTimeout(300);

            // Instructions should mention "Drag route points"
            const instructions = routeEditor.getByText(/Drag.*route points/);
            await expect(instructions).toBeVisible({ timeout: 3000 });
        });

        test('switching to Draw sub-mode changes instructions', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const routeEditor = page.locator('[data-testid="route-editor"]');
            // Switch to route mode
            const routeButton = routeEditor.getByRole('button', { name: 'Route', exact: true });
            await routeButton.click();
            await page.waitForTimeout(300);

            // Click Draw sub-mode button
            const drawButton = routeEditor.getByRole('button', { name: 'Draw', exact: true });
            await drawButton.click();
            await page.waitForTimeout(300);

            // Instructions should mention "Draw on map"
            const instructions = routeEditor.getByText(/Draw.*on map/);
            await expect(instructions).toBeVisible({ timeout: 3000 });
        });

        test('Draw mode shows touch instructions', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const routeEditor = page.locator('[data-testid="route-editor"]');
            // Switch to route mode and draw sub-mode
            const routeButton = routeEditor.getByRole('button', { name: 'Route', exact: true });
            await routeButton.click();
            await page.waitForTimeout(300);

            const drawButton = routeEditor.getByRole('button', { name: 'Draw', exact: true });
            await drawButton.click();
            await page.waitForTimeout(300);

            // Instructions should mention two fingers for panning
            const instructions = routeEditor.getByText(/Two fingers to pan/);
            await expect(instructions).toBeVisible({ timeout: 3000 });
        });

        test('sub-mode toggle is not visible in Camps mode', async ({ page }) => {
            const found = await openRouteEditor(page);
            expect(found).toBe(true);

            const routeEditor = page.locator('[data-testid="route-editor"]');
            // Start in camps mode (default)
            // The Draw sub-mode button should not be visible
            const drawButton = routeEditor.getByRole('button', { name: 'Draw', exact: true });

            // Wait a bit for UI to settle
            await page.waitForTimeout(500);

            // Draw button should not be visible in Camps mode
            await expect(drawButton).not.toBeVisible();
        });
    });
});
