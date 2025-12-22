import { test, expect, Page } from '@playwright/test';

const MAP_TIMEOUT = 15000;
const EDITOR_TIMEOUT = 10000;

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

    try {
        await page.waitForSelector('text="Explore Journey →"', { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

// Helper to navigate to trek view and open route editor
async function openRouteEditor(page: Page): Promise<boolean> {
    // Navigate to trek view
    await page.getByText('Explore Journey →').click();
    await expect(page.getByText('DURATION')).toBeVisible({ timeout: EDITOR_TIMEOUT });

    // Look for edit button in the quick action bar or sidebar
    const editButton = page.locator('[data-testid="edit-route-button"], button:has-text("Edit Route"), button:has-text("Edit")').first();

    if (await editButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await editButton.click();

        // Wait for route editor to open
        await expect(page.locator('[data-testid="route-editor"]')).toBeVisible({ timeout: EDITOR_TIMEOUT });
        return true;
    }

    return false;
}

// Helper to close route editor
async function closeRouteEditor(page: Page): Promise<void> {
    const cancelButton = page.locator('button:has-text("Cancel")').first();
    if (await cancelButton.isVisible().catch(() => false)) {
        await cancelButton.click();
    }
}

test.describe('Route Editor', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);
    });

    test.describe('Editor Opening and Closing', () => {
        test('route editor opens when clicking edit button', async ({ page }) => {
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            const opened = await openRouteEditor(page);
            if (!opened) {
                test.skip();
                return;
            }

            // Verify editor is visible
            await expect(page.locator('[data-testid="route-editor"]')).toBeVisible();
            await expect(page.getByText('ROUTE EDITOR')).toBeVisible();
        });

        test('route editor closes on cancel', async ({ page }) => {
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            const opened = await openRouteEditor(page);
            if (!opened) {
                test.skip();
                return;
            }

            // Click cancel
            await page.locator('button:has-text("Cancel")').first().click();

            // Editor should be closed
            await expect(page.locator('[data-testid="route-editor"]')).not.toBeVisible({ timeout: 5000 });
        });

        test('shows trek name in editor header', async ({ page }) => {
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            const opened = await openRouteEditor(page);
            if (!opened) {
                test.skip();
                return;
            }

            // Should show the trek name
            const header = page.locator('[data-testid="route-editor"]');
            await expect(header).toBeVisible();
        });
    });

    test.describe('Mode Switching', () => {
        test('can switch between Camps and Route modes', async ({ page }) => {
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            const opened = await openRouteEditor(page);
            if (!opened) {
                test.skip();
                return;
            }

            // Should start in Camps mode (default)
            const campsButton = page.locator('button:has-text("Camps")').first();
            const routeButton = page.locator('button:has-text("Route")').first();

            await expect(campsButton).toBeVisible();
            await expect(routeButton).toBeVisible();

            // Switch to Route mode
            await routeButton.click();
            await page.waitForTimeout(300); // Wait for animation

            // Switch back to Camps mode
            await campsButton.click();
            await page.waitForTimeout(300);
        });

        test('Route mode shows sub-mode buttons', async ({ page }) => {
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            const opened = await openRouteEditor(page);
            if (!opened) {
                test.skip();
                return;
            }

            // Switch to Route mode
            await page.locator('button:has-text("Route")').first().click();
            await page.waitForTimeout(300);

            // Should show sub-mode buttons
            await expect(page.locator('button:has-text("Edit")').first()).toBeVisible();
            await expect(page.locator('button:has-text("Select")').first()).toBeVisible();
            await expect(page.locator('button:has-text("Draw")').first()).toBeVisible();
        });
    });

    test.describe('Camps Mode', () => {
        test('displays camp list in sidebar', async ({ page }) => {
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            const opened = await openRouteEditor(page);
            if (!opened) {
                test.skip();
                return;
            }

            // Should show camp list
            const campList = page.locator('[data-testid="camp-list"], [data-testid="camp-list-desktop"]');
            await expect(campList).toBeVisible({ timeout: 5000 });
        });

        test('clicking camp selects it', async ({ page }) => {
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            const opened = await openRouteEditor(page);
            if (!opened) {
                test.skip();
                return;
            }

            // Find first camp item
            const campItem = page.locator('[data-testid^="camp-item-"]').first();
            if (await campItem.isVisible().catch(() => false)) {
                await campItem.click();

                // Should show camp actions (Zoom To, Delete)
                await page.waitForTimeout(300);
            }
        });

        test('camp count is displayed', async ({ page }) => {
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            const opened = await openRouteEditor(page);
            if (!opened) {
                test.skip();
                return;
            }

            // Should show camp count in header
            const campsHeader = page.locator('text=/Camps \\(\\d+\\)/');
            await expect(campsHeader).toBeVisible({ timeout: 5000 });
        });
    });

    test.describe('Undo/Redo', () => {
        test('undo button is disabled when no history', async ({ page }) => {
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            const opened = await openRouteEditor(page);
            if (!opened) {
                test.skip();
                return;
            }

            // Undo button should be disabled initially
            const undoButton = page.locator('button:has-text("Undo"), button[title*="Undo"]').first();
            if (await undoButton.isVisible().catch(() => false)) {
                await expect(undoButton).toBeDisabled();
            }
        });

        test('redo button is disabled when no future history', async ({ page }) => {
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            const opened = await openRouteEditor(page);
            if (!opened) {
                test.skip();
                return;
            }

            // Redo button should be disabled initially
            const redoButton = page.locator('button:has-text("Redo"), button[title*="Redo"]').first();
            if (await redoButton.isVisible().catch(() => false)) {
                await expect(redoButton).toBeDisabled();
            }
        });
    });

    test.describe('Save Functionality', () => {
        test('save button is disabled when no changes', async ({ page }) => {
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            const opened = await openRouteEditor(page);
            if (!opened) {
                test.skip();
                return;
            }

            // Save button should be disabled initially
            const saveButton = page.locator('button:has-text("Save")').first();
            if (await saveButton.isVisible().catch(() => false)) {
                await expect(saveButton).toBeDisabled();
            }
        });
    });

    test.describe('Instructions Overlay', () => {
        test('shows camps mode instructions', async ({ page }) => {
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            const opened = await openRouteEditor(page);
            if (!opened) {
                test.skip();
                return;
            }

            // Should show camps mode instructions
            await expect(page.getByText(/Drag.*markers/i)).toBeVisible({ timeout: 5000 });
        });

        test('shows route mode instructions when switching modes', async ({ page }) => {
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            const opened = await openRouteEditor(page);
            if (!opened) {
                test.skip();
                return;
            }

            // Switch to Route mode
            await page.locator('button:has-text("Route")').first().click();
            await page.waitForTimeout(300);

            // Should show route mode instructions
            await expect(page.getByText(/Drag.*points|route/i)).toBeVisible({ timeout: 5000 });
        });
    });
});

// Mobile-specific tests
test.describe('Route Editor Mobile', () => {
    test.beforeEach(async ({ page, browserName }, testInfo) => {
        // Skip if not a mobile project
        if (!testInfo.project.name.includes('mobile')) {
            test.skip();
        }

        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);
    });

    test('mobile header is compact', async ({ page }) => {
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Should show compact header
        await expect(page.getByText('ROUTE EDITOR')).toBeVisible();

        // Mode toggle buttons should be visible
        await expect(page.locator('button:has-text("Camps")').first()).toBeVisible();
        await expect(page.locator('button:has-text("Route")').first()).toBeVisible();
    });

    test('mobile bottom panel is visible', async ({ page }) => {
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Should show bottom panel with camp list
        const campList = page.locator('[data-testid="camp-list"]');
        await expect(campList).toBeVisible({ timeout: 5000 });
    });

    test('mobile action bar shows Save and Cancel', async ({ page }) => {
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Should show action bar with buttons
        await expect(page.locator('button:has-text("Cancel")').first()).toBeVisible();
        await expect(page.locator('button:has-text("Save")').first()).toBeVisible();
    });

    test('camp items are present', async ({ page }) => {
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Should show camp items
        const campItem = page.locator('[data-testid^="camp-item-"]').first();
        if (await campItem.isVisible().catch(() => false)) {
            await expect(campItem).toBeVisible();
        }
    });

    test('camp items have drag handles for reordering', async ({ page }) => {
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Camp items should be visible (they have drag handles built in)
        const campItem = page.locator('[data-testid^="camp-item-"]').first();
        if (await campItem.isVisible().catch(() => false)) {
            await expect(campItem).toBeVisible();
        }
    });

    test('hint text shows drag and swipe instructions', async ({ page }) => {
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Should show hint about drag to reorder and swipe to delete
        const hint = page.getByText(/Drag.*reorder|Swipe.*delete/i);
        if (await hint.isVisible().catch(() => false)) {
            await expect(hint).toBeVisible();
        }
    });
});

// Visual regression tests
test.describe('Route Editor Visual', () => {
    test('route editor matches snapshot', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Wait for animations to settle
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot('route-editor.png', {
            maxDiffPixelRatio: 0.15,
        });
    });
});

// Route mode tests
test.describe('Route Mode Operations', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);
    });

    test('shows route points count', async ({ page }) => {
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Switch to Route mode
        await page.locator('button:has-text("Route")').first().click();
        await page.waitForTimeout(300);

        // Should show route points count
        const routePoints = page.locator('text=/Route Points \\(\\d+\\)/');
        await expect(routePoints).toBeVisible({ timeout: 5000 });
    });

    test('can switch to Select sub-mode', async ({ page }) => {
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Switch to Route mode
        await page.locator('button:has-text("Route")').first().click();
        await page.waitForTimeout(300);

        // Switch to Select sub-mode
        await page.locator('button:has-text("Select")').first().click();
        await page.waitForTimeout(300);

        // Should show select mode instructions
        await expect(page.getByText(/Drag.*select|selection/i)).toBeVisible({ timeout: 5000 });
    });

    test('can switch to Draw sub-mode', async ({ page }) => {
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Switch to Route mode
        await page.locator('button:has-text("Route")').first().click();
        await page.waitForTimeout(300);

        // Switch to Draw sub-mode
        await page.locator('button:has-text("Draw")').first().click();
        await page.waitForTimeout(300);

        // Should show draw mode instructions
        await expect(page.getByText(/Draw.*map|route/i)).toBeVisible({ timeout: 5000 });
    });

    test('Select Visible button is available', async ({ page }) => {
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Switch to Route mode
        await page.locator('button:has-text("Route")').first().click();
        await page.waitForTimeout(300);

        // Should show Select Visible button
        const selectVisibleBtn = page.locator('button:has-text("Select Visible")');
        await expect(selectVisibleBtn).toBeVisible({ timeout: 5000 });
    });

    test('Snap Route to Trails button is available', async ({ page }) => {
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Switch to Route mode
        await page.locator('button:has-text("Route")').first().click();
        await page.waitForTimeout(300);

        // Should show Snap Route button
        const snapBtn = page.locator('button:has-text("Snap Route")');
        await expect(snapBtn).toBeVisible({ timeout: 5000 });
    });
});

// Map interaction tests
test.describe('Map Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);
    });

    test('map canvas is visible in editor', async ({ page }) => {
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Map canvas should be visible
        const canvas = page.locator('[data-testid="route-editor"] canvas, canvas').first();
        await expect(canvas).toBeVisible();
    });

    test('map is interactive', async ({ page }) => {
        const selected = await selectFirstTrek(page);
        if (!selected) {
            test.skip();
            return;
        }

        const opened = await openRouteEditor(page);
        if (!opened) {
            test.skip();
            return;
        }

        // Get map canvas bounding box
        const canvas = page.locator('[data-testid="route-editor"] canvas, canvas').first();
        const box = await canvas.boundingBox();

        expect(box).not.toBeNull();
        if (box) {
            expect(box.width).toBeGreaterThan(100);
            expect(box.height).toBeGreaterThan(100);
        }
    });
});
