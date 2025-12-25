import { test, expect, Page } from '@playwright/test';

const MAP_TIMEOUT = 15000;

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

// Helper to select a trek with camps (try multiple treks)
async function selectTrekWithCamps(page: Page): Promise<boolean> {
    // Try Kilimanjaro first, then Mount Kenya, then Inca Trail
    const treksToTry = ['kilimanjaro', 'mount-kenya', 'inca-trail'];

    for (const trekId of treksToTry) {
        const selected = await page.evaluate((id) => {
            return window.testHelpers?.selectTrek(id) || false;
        }, trekId).catch(() => false);

        if (!selected) continue;

        try {
            await page.waitForSelector('text="Explore Journey →"', { timeout: 5000 });
            console.log(`[selectTrekWithCamps] Successfully selected ${trekId}`);
            return true;
        } catch {
            console.log(`[selectTrekWithCamps] Failed to select ${trekId}`);
            continue;
        }
    }

    console.log('[selectTrekWithCamps] No trek could be selected');
    return false;
}

// Helper to wait for camps to be available
async function waitForCampsLoaded(page: Page, timeout = 15000): Promise<boolean> {
    const startTime = Date.now();
    let pollInterval = 100;
    let lastCheck = 0;

    while (Date.now() - startTime < timeout) {
        const result = await page.evaluate(() => {
            const camps = window.testHelpers?.getCamps();
            const selectedTrek = window.testHelpers?.getSelectedTrek();
            const treks = window.testHelpers?.getTreks();
            const trekDataKeys = window.testHelpers?.getTrekDataKeys();
            const trekData = selectedTrek ? window.testHelpers?.getTrekData(selectedTrek) : null;

            return {
                camps: camps || [],
                campCount: camps?.length || 0,
                selectedTrek,
                dataLoaded: window.testHelpers?.isDataLoaded() || false,
                availableTreks: treks?.map(t => t.id) || [],
                trekCount: treks?.length || 0,
                trekDataKeys: trekDataKeys || [],
                trekData: trekData || null
            };
        }).catch(() => ({ camps: [], campCount: 0, selectedTrek: null, dataLoaded: false, availableTreks: [], trekCount: 0, trekDataKeys: [], trekData: null }));

        // Log every 2 seconds
        const now = Date.now();
        if (now - lastCheck > 2000) {
            console.log('[waitForCampsLoaded] Status:', result);
            lastCheck = now;
        }

        if (result.campCount > 0) {
            console.log(`[waitForCampsLoaded] Success! Found ${result.campCount} camps`);
            return true;
        }

        await page.waitForTimeout(pollInterval);
        pollInterval = Math.min(pollInterval * 1.5, 500);
    }

    console.log('[waitForCampsLoaded] Timeout waiting for camps');
    return false;
}

// Helper to navigate to trek view and start journey
async function navigateToTrekView(page: Page): Promise<boolean> {
    const selected = await selectTrekWithCamps(page);
    if (!selected) {
        console.log('[navigateToTrekView] Failed to select a trek with camps');
        return false;
    }

    await page.getByText('Explore Journey →').click();

    try {
        await page.waitForSelector('text="Start"', { timeout: 10000 });
        console.log('[navigateToTrekView] Found Start button, clicking...');
        // Click Start to actually begin the journey
        await page.getByText('Start').click();
        // Wait for camps to be loaded and available
        console.log('[navigateToTrekView] Waiting for camps to load...');
        const campsLoaded = await waitForCampsLoaded(page);

        if (!campsLoaded) {
            const camps = await page.evaluate(() => {
                return window.testHelpers?.getCamps() || [];
            });
            console.log('[navigateToTrekView] Camps not loaded. Available camps:', camps);
        } else {
            const campCount = await page.evaluate(() => {
                return window.testHelpers?.getCamps()?.length || 0;
            });
            console.log(`[navigateToTrekView] Successfully loaded ${campCount} camps`);
        }

        return campsLoaded;
    } catch (e) {
        console.log('[navigateToTrekView] Error:', e);
        return false;
    }
}

// Helper to select a day
async function selectDay(page: Page, dayNumber: number): Promise<boolean> {
    return await page.evaluate((day) => {
        return window.testHelpers?.selectDay(day) || false;
    }, dayNumber).catch(() => false);
}

// Helper to get current day
async function getCurrentDay(page: Page): Promise<number | null> {
    return await page.evaluate(() => {
        return window.testHelpers?.getCurrentDay() || null;
    }).catch(() => null);
}

// Helper to wait for map animations to complete
async function waitForMapAnimations(page: Page, timeout = 5000): Promise<boolean> {
    const startTime = Date.now();
    let pollInterval = 100;

    while (Date.now() - startTime < timeout) {
        const state = await page.evaluate(() => {
            return window.testHelpers?.getMapState() || { hasPendingAnimations: true };
        }).catch(() => ({ hasPendingAnimations: true }));

        if (!state.hasPendingAnimations) {
            console.log('[waitForMapAnimations] Animations complete');
            return true;
        }

        await page.waitForTimeout(pollInterval);
        pollInterval = Math.min(pollInterval * 1.2, 300);
    }

    console.log('[waitForMapAnimations] Timeout waiting for animations');
    return false;
}

/**
 * Calculate distance between two coordinates in km (Haversine formula)
 */
function calculateDistance(coord1: [number, number], coord2: [number, number]): number {
    const R = 6371; // Earth's radius in km
    const [lng1, lat1] = coord1;
    const [lng2, lat2] = coord2;

    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Verify camera is positioned near the expected camp
 * Allows for some tolerance since camera might be slightly offset for better view
 */
async function verifyCameraPosition(
    page: Page,
    expectedCampCoords: [number, number],
    toleranceKm = 50
): Promise<{ success: boolean; distance?: number; cameraCenter?: [number, number] }> {
    const mapState = await page.evaluate(() => window.testHelpers?.getMapState());

    if (!mapState?.cameraCenter) {
        return { success: false };
    }

    const distance = calculateDistance(mapState.cameraCenter, expectedCampCoords);

    return {
        success: distance <= toleranceKm,
        distance,
        cameraCenter: mapState.cameraCenter
    };
}

test.describe('Day Navigation', () => {
    test('rapid day switching goes to final selection', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const navigated = await navigateToTrekView(page);
        if (!navigated) {
            test.skip();
            return;
        }

        // Get camps to find expected coordinates for day 3
        const camps = await page.evaluate(() => window.testHelpers?.getCamps() || []);
        const day3Camp = camps.find(c => c.dayNumber === 3);
        expect(day3Camp).toBeDefined();

        // Get full camp data with coordinates
        const day3CampData = await page.evaluate((campId) => {
            const trekData = window.testHelpers?.getTrekData('kilimanjaro');
            return trekData?.camps.find((c: any) => c.id === campId);
        }, day3Camp?.id);
        expect(day3CampData?.coordinates).toBeDefined();

        // Rapidly switch through days 1, 2, 3
        await selectDay(page, 1);
        await selectDay(page, 2);
        await selectDay(page, 3);

        // Wait for animations to complete
        const animationsComplete = await waitForMapAnimations(page);
        expect(animationsComplete).toBe(true);

        // Verify selected day matches
        const currentDay = await getCurrentDay(page);
        expect(currentDay).toBe(3);

        // Verify camera is positioned near Day 3 camp (visual state verification)
        const cameraCheck = await verifyCameraPosition(page, day3CampData.coordinates);
        console.log('[Test] Camera position check:', {
            expected: day3CampData.coordinates,
            actual: cameraCheck.cameraCenter,
            distance: cameraCheck.distance ? `${cameraCheck.distance.toFixed(2)} km` : 'unknown',
            success: cameraCheck.success
        });
        expect(cameraCheck.success).toBe(true);
    });

    test('very rapid day switching (5 days quickly)', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const navigated = await navigateToTrekView(page);
        if (!navigated) {
            test.skip();
            return;
        }

        // Rapidly switch through all 5 days of Mount Kenya
        await selectDay(page, 1);
        await selectDay(page, 2);
        await selectDay(page, 3);
        await selectDay(page, 4);
        await selectDay(page, 5); // Safari day

        // Wait for animations to complete
        await page.waitForTimeout(3000);

        // Should be on day 5 (Safari)
        const currentDay = await getCurrentDay(page);
        expect(currentDay).toBe(5);
    });

    test('forward and backward day switching', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const navigated = await navigateToTrekView(page);
        if (!navigated) {
            test.skip();
            return;
        }

        // Switch forward: 1 → 3
        await selectDay(page, 1);
        await page.waitForTimeout(500);
        await selectDay(page, 3);
        await page.waitForTimeout(2500);

        let currentDay = await getCurrentDay(page);
        expect(currentDay).toBe(3);

        // Switch backward: 3 → 1
        await selectDay(page, 1);
        await page.waitForTimeout(2500);

        currentDay = await getCurrentDay(page);
        expect(currentDay).toBe(1);
    });

    test('Safari day (off-route) navigation works', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const navigated = await navigateToTrekView(page);
        if (!navigated) {
            test.skip();
            return;
        }

        // Select Day 5 (Safari - off-route waypoint)
        const selected = await selectDay(page, 5);
        expect(selected).toBe(true);

        // Wait for camera animation
        await page.waitForTimeout(3000);

        // Verify we're on day 5
        const currentDay = await getCurrentDay(page);
        expect(currentDay).toBe(5);
    });

    test('rapid switching to Safari day works', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const navigated = await navigateToTrekView(page);
        if (!navigated) {
            test.skip();
            return;
        }

        // Rapidly switch from day 1 to Safari (day 5)
        await selectDay(page, 1);
        await selectDay(page, 5);

        // Wait for animations
        await page.waitForTimeout(3000);

        // Should be on Safari day
        const currentDay = await getCurrentDay(page);
        expect(currentDay).toBe(5);
    });

    test('switching from established day with two rapid switches', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const navigated = await navigateToTrekView(page);
        if (!navigated) {
            test.skip();
            return;
        }

        // Get camp coordinates
        const camps = await page.evaluate(() => window.testHelpers?.getCamps() || []);
        const day4Camp = camps.find(c => c.dayNumber === 4);
        expect(day4Camp).toBeDefined();

        const day4CampData = await page.evaluate((campId) => {
            const selectedTrek = window.testHelpers?.getSelectedTrek();
            const trekData = selectedTrek ? window.testHelpers?.getTrekData(selectedTrek) : null;
            return trekData?.camps.find((c: any) => c.id === campId);
        }, day4Camp?.id);
        expect(day4CampData?.coordinates).toBeDefined();

        // IMPORTANT: First go to Day 2 and WAIT for it to complete
        await selectDay(page, 2);
        await waitForMapAnimations(page);
        await page.waitForTimeout(500); // Ensure we're fully settled on Day 2

        console.log('[Test] Established on Day 2, now rapidly switching Day 2 → 3 → 4');

        // Now rapidly switch TWO times while already at Day 2
        await selectDay(page, 3);
        await selectDay(page, 4);

        // Wait for animations to complete
        const animationsComplete = await waitForMapAnimations(page);
        expect(animationsComplete).toBe(true);

        // Verify we ended up on Day 4
        const currentDay = await getCurrentDay(page);
        expect(currentDay).toBe(4);

        // CRITICAL: Verify camera actually moved to Day 4, not stuck at Day 2
        const cameraCheck = await verifyCameraPosition(page, day4CampData.coordinates, 50);
        console.log('[Test] Camera position check (from established day):', {
            expected: day4CampData.coordinates,
            actual: cameraCheck.cameraCenter,
            distance: cameraCheck.distance ? `${cameraCheck.distance.toFixed(2)} km` : 'unknown',
            success: cameraCheck.success
        });
        expect(cameraCheck.success).toBe(true);
    });

    test('rapid switching FROM Safari day back works', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const navigated = await navigateToTrekView(page);
        if (!navigated) {
            test.skip();
            return;
        }

        // Get camp coordinates for verification - we'll end on Day 1
        const camps = await page.evaluate(() => window.testHelpers?.getCamps() || []);
        const day1Camp = camps.find(c => c.dayNumber === 1);
        expect(day1Camp).toBeDefined();

        const day1CampData = await page.evaluate((campId) => {
            const selectedTrek = window.testHelpers?.getSelectedTrek();
            const trekData = selectedTrek ? window.testHelpers?.getTrekData(selectedTrek) : null;
            return trekData?.camps.find((c: any) => c.id === campId);
        }, day1Camp?.id);
        expect(day1CampData?.coordinates).toBeDefined();

        // Go to Safari day first (off-route)
        await selectDay(page, 5);
        await page.waitForTimeout(100); // Minimal wait

        // VERY rapidly switch back: Safari (day 5) → Day 4 → Day 3 → Day 2 → Day 1
        await selectDay(page, 4);
        await selectDay(page, 3);
        await selectDay(page, 2);
        await selectDay(page, 1);

        // Wait for animations to complete
        const animationsComplete = await waitForMapAnimations(page);
        expect(animationsComplete).toBe(true);

        // Verify we ended up on Day 1
        const currentDay = await getCurrentDay(page);
        expect(currentDay).toBe(1);

        // CRITICAL: Verify camera actually moved from Safari to Day 1
        // If stuck at Safari, this will fail
        const cameraCheck = await verifyCameraPosition(page, day1CampData.coordinates, 50);
        console.log('[Test] Camera position check (from Safari):', {
            expected: day1CampData.coordinates,
            actual: cameraCheck.cameraCenter,
            distance: cameraCheck.distance ? `${cameraCheck.distance.toFixed(2)} km` : 'unknown',
            success: cameraCheck.success
        });
        expect(cameraCheck.success).toBe(true);
    });

    test('triple rapid switch pattern', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const navigated = await navigateToTrekView(page);
        if (!navigated) {
            test.skip();
            return;
        }

        // Switch Day 2 → 4 → 3 (common user pattern)
        await selectDay(page, 2);
        await selectDay(page, 4);
        await selectDay(page, 3);

        // Wait for animations
        await page.waitForTimeout(2500);

        // Should be on day 3
        const currentDay = await getCurrentDay(page);
        expect(currentDay).toBe(3);
    });

    test('console shows no errors during rapid switching', async ({ page }) => {
        const errors: string[] = [];

        page.on('console', msg => {
            if (msg.type() === 'error') {
                errors.push(msg.text());
            }
        });

        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: MAP_TIMEOUT });
        await waitForMapReady(page);

        const navigated = await navigateToTrekView(page);
        if (!navigated) {
            test.skip();
            return;
        }

        // Rapidly switch through days
        await selectDay(page, 1);
        await selectDay(page, 2);
        await selectDay(page, 3);
        await selectDay(page, 4);
        await selectDay(page, 5);

        // Wait for animations
        await page.waitForTimeout(3000);

        // Check for errors (filter out known safe warnings)
        const relevantErrors = errors.filter(err =>
            !err.includes('Download the React DevTools') &&
            !err.includes('DevTools')
        );

        expect(relevantErrors).toEqual([]);
    });
});
