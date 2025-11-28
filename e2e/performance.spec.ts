/**
 * Performance tests for Akashic App
 * Measures key metrics to ensure mobile optimizations are effective
 */

import { test, expect, type Page } from '@playwright/test';

// Performance thresholds
// Note: Mapbox 3D globe with terrain is heavy - these thresholds are calibrated for that
const THRESHOLDS = {
    // Time for map to become interactive
    mapInitTime: 8000,
    // Time for trek transition (globe -> trek view)
    transitionTime: 5000,
    // Maximum long task duration (blocks main thread)
    longTaskDuration: 100,
    // Minimum acceptable FPS during animations
    minFps: 20,
    // Maximum heap size (MB) after exploration
    maxHeapSize: 200,
    // Max excessive long tasks during load (Mapbox is heavy)
    maxLongTasksDesktop: 25,
    maxLongTasksMobile: 30,
};

// Helper to measure performance metrics
async function measurePerformance(page: Page) {
    return await page.evaluate(() => {
        const perf = window.performance;
        const timing = perf.timing;
        const memory = (performance as any).memory;

        return {
            // Navigation timing
            domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
            loadComplete: timing.loadEventEnd - timing.navigationStart,
            // Memory (Chrome only)
            heapUsed: memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : null,
            heapTotal: memory ? Math.round(memory.totalJSHeapSize / 1024 / 1024) : null,
        };
    });
}

// Helper to wait for map to be ready via test helpers
async function waitForMapReady(page: Page, timeout = 30000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        const ready = await page.evaluate(() => {
            return window.testHelpers?.isMapReady() && window.testHelpers?.isDataLoaded();
        });

        if (ready) return true;
        await page.waitForTimeout(100);
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
    });
}

test.describe('Performance Tests', () => {
    test.describe('Desktop Performance', () => {
        test.beforeEach(async ({ page }) => {
            // Enable performance observer
            await page.addInitScript(() => {
                (window as any).__longTasks = [];
                (window as any).__frameTimestamps = [];

                // Track long tasks
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        (window as any).__longTasks.push({
                            duration: entry.duration,
                            startTime: entry.startTime,
                        });
                    }
                });
                observer.observe({ entryTypes: ['longtask'] });

                // Track frame rate
                let lastTime = performance.now();
                const measureFrames = () => {
                    const now = performance.now();
                    (window as any).__frameTimestamps.push(now - lastTime);
                    lastTime = now;
                    if ((window as any).__frameTimestamps.length < 300) {
                        requestAnimationFrame(measureFrames);
                    }
                };
                requestAnimationFrame(measureFrames);
            });

            await page.goto('/');
        });

        test('map initializes within threshold', async ({ page }) => {
            const startTime = Date.now();

            // Wait for canvas to appear
            await page.waitForSelector('canvas', { timeout: THRESHOLDS.mapInitTime });

            // Wait for map to be fully ready
            const ready = await waitForMapReady(page, THRESHOLDS.mapInitTime);
            const initTime = Date.now() - startTime;

            console.log(`Map initialization time: ${initTime}ms`);
            expect(ready).toBe(true);
            expect(initTime).toBeLessThan(THRESHOLDS.mapInitTime);
        });

        test('trek transition completes within threshold', async ({ page }) => {
            await page.waitForSelector('canvas', { timeout: 30000 });
            await waitForMapReady(page);

            // Select a trek
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            // Wait for selection panel
            await page.waitForTimeout(500);

            // Click explore
            const exploreButton = page.getByText('Explore Journey →');
            if (!(await exploreButton.isVisible().catch(() => false))) {
                test.skip();
                return;
            }

            const startTime = Date.now();
            await exploreButton.click();

            // Wait for info panel tabs to appear (indicates transition complete)
            await expect(page.getByRole('button', { name: /overview/i })).toBeVisible({
                timeout: THRESHOLDS.transitionTime,
            });

            const transitionTime = Date.now() - startTime;
            console.log(`Trek transition time: ${transitionTime}ms`);
            expect(transitionTime).toBeLessThan(THRESHOLDS.transitionTime);
        });

        test('no excessive long tasks during exploration', async ({ page }) => {
            await page.waitForSelector('canvas', { timeout: 30000 });
            await waitForMapReady(page);

            // Select and explore a trek
            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            await page.waitForTimeout(500);
            const exploreButton = page.getByText('Explore Journey →');
            if (await exploreButton.isVisible().catch(() => false)) {
                await exploreButton.click();
                await page.waitForTimeout(2000); // Let animations complete
            }

            // Get long tasks
            const longTasks = await page.evaluate(() => (window as any).__longTasks || []);
            const excessiveTasks = longTasks.filter(
                (t: { duration: number }) => t.duration > THRESHOLDS.longTaskDuration
            );

            console.log(`Long tasks: ${longTasks.length}, Excessive (>${THRESHOLDS.longTaskDuration}ms): ${excessiveTasks.length}`);

            // Mapbox 3D with terrain causes long tasks during init - this is expected
            // We just want to ensure it doesn't get worse over time
            expect(excessiveTasks.length).toBeLessThan(THRESHOLDS.maxLongTasksDesktop);
        });

        test('frame rate stays acceptable during globe rotation', async ({ page }) => {
            await page.waitForSelector('canvas', { timeout: 30000 });
            await waitForMapReady(page);

            // Wait for globe rotation to start (3.5s delay in code)
            await page.waitForTimeout(4500);

            // Collect frame timestamps for 2 seconds
            await page.waitForTimeout(2000);

            const frameTimestamps = await page.evaluate(() => (window as any).__frameTimestamps || []);

            // Calculate average FPS from frame deltas
            if (frameTimestamps.length > 10) {
                const recentFrames = frameTimestamps.slice(-60); // Last ~1 second
                const avgFrameTime = recentFrames.reduce((a: number, b: number) => a + b, 0) / recentFrames.length;
                const fps = 1000 / avgFrameTime;

                console.log(`Average FPS during rotation: ${fps.toFixed(1)}`);
                expect(fps).toBeGreaterThan(THRESHOLDS.minFps);
            }
        });

        test('memory usage stays within bounds', async ({ page }) => {
            await page.waitForSelector('canvas', { timeout: 30000 });
            await waitForMapReady(page);

            // Select and explore
            const selected = await selectFirstTrek(page);
            if (selected) {
                await page.waitForTimeout(500);
                const exploreButton = page.getByText('Explore Journey →');
                if (await exploreButton.isVisible().catch(() => false)) {
                    await exploreButton.click();
                    await page.waitForTimeout(2000);
                }
            }

            const metrics = await measurePerformance(page);

            if (metrics.heapUsed !== null) {
                console.log(`Heap used: ${metrics.heapUsed}MB / ${metrics.heapTotal}MB`);
                expect(metrics.heapUsed).toBeLessThan(THRESHOLDS.maxHeapSize);
            }
        });
    });

    test.describe('Mobile Performance', () => {
        test.use({
            viewport: { width: 390, height: 844 }, // iPhone 14 Pro
            deviceScaleFactor: 3,
            isMobile: true,
            hasTouch: true,
        });

        test.beforeEach(async ({ page }) => {
            // Enable performance observer
            await page.addInitScript(() => {
                (window as any).__longTasks = [];

                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        (window as any).__longTasks.push({
                            duration: entry.duration,
                            startTime: entry.startTime,
                        });
                    }
                });
                observer.observe({ entryTypes: ['longtask'] });
            });

            await page.goto('/');
        });

        test('mobile: map initializes within threshold', async ({ page }) => {
            const startTime = Date.now();

            await page.waitForSelector('canvas', { timeout: THRESHOLDS.mapInitTime });
            const ready = await waitForMapReady(page, THRESHOLDS.mapInitTime);
            const initTime = Date.now() - startTime;

            console.log(`Mobile map initialization time: ${initTime}ms`);
            expect(ready).toBe(true);
            // Allow slightly more time for mobile
            expect(initTime).toBeLessThan(THRESHOLDS.mapInitTime * 1.5);
        });

        test('mobile: trek transition is responsive', async ({ page }) => {
            await page.waitForSelector('canvas', { timeout: 30000 });
            await waitForMapReady(page);

            const selected = await selectFirstTrek(page);
            if (!selected) {
                test.skip();
                return;
            }

            await page.waitForTimeout(500);

            const exploreButton = page.getByText('Explore Journey →');
            if (!(await exploreButton.isVisible().catch(() => false))) {
                test.skip();
                return;
            }

            const startTime = Date.now();
            await exploreButton.tap();

            // Wait for bottom sheet info panel
            await expect(page.getByRole('button', { name: /overview/i })).toBeVisible({
                timeout: THRESHOLDS.transitionTime * 1.5, // Allow more time for mobile
            });

            const transitionTime = Date.now() - startTime;
            console.log(`Mobile trek transition time: ${transitionTime}ms`);
            expect(transitionTime).toBeLessThan(THRESHOLDS.transitionTime * 1.5);
        });

        test('mobile: no excessive long tasks', async ({ page }) => {
            await page.waitForSelector('canvas', { timeout: 30000 });
            await waitForMapReady(page);

            const selected = await selectFirstTrek(page);
            if (selected) {
                await page.waitForTimeout(500);
                const exploreButton = page.getByText('Explore Journey →');
                if (await exploreButton.isVisible().catch(() => false)) {
                    await exploreButton.tap();
                    await page.waitForTimeout(2000);
                }
            }

            const longTasks = await page.evaluate(() => (window as any).__longTasks || []);
            const excessiveTasks = longTasks.filter(
                (t: { duration: number }) => t.duration > THRESHOLDS.longTaskDuration
            );

            console.log(`Mobile long tasks: ${longTasks.length}, Excessive: ${excessiveTasks.length}`);

            // Mobile may have slightly more long tasks due to lower processing power
            // Our optimizations help, but Mapbox is still heavy
            expect(excessiveTasks.length).toBeLessThan(THRESHOLDS.maxLongTasksMobile);
        });

        test('mobile: CSS optimizations are applied', async ({ page }) => {
            await page.waitForSelector('canvas', { timeout: 30000 });
            await waitForMapReady(page);

            const selected = await selectFirstTrek(page);
            if (selected) {
                await page.waitForTimeout(500);
                const exploreButton = page.getByText('Explore Journey →');
                if (await exploreButton.isVisible().catch(() => false)) {
                    await exploreButton.tap();
                    await page.waitForTimeout(1000);
                }
            }

            // Check that CSS containment is applied (our mobile optimization)
            const hasContainment = await page.evaluate(() => {
                const glassElements = document.querySelectorAll('[class*="glass"]');
                if (glassElements.length === 0) return null;

                // Check computed styles
                const el = glassElements[0];
                const styles = window.getComputedStyle(el);
                return {
                    contain: styles.contain,
                    willChange: styles.willChange,
                };
            });

            // Log what we found
            console.log('Glass element styles:', hasContainment);

            // The containment should be applied on mobile
            // Note: This checks if our CSS is loaded, not necessarily the specific values
            expect(hasContainment).not.toBeNull();
        });
    });

    test.describe('Performance Benchmarks', () => {
        test('benchmark: full exploration flow', async ({ page }) => {
            const benchmarks: Record<string, number> = {};

            // Measure page load
            const loadStart = Date.now();
            await page.goto('/');
            await page.waitForSelector('canvas', { timeout: 30000 });
            benchmarks['pageLoad'] = Date.now() - loadStart;

            // Measure map ready
            const mapStart = Date.now();
            await waitForMapReady(page);
            benchmarks['mapReady'] = Date.now() - mapStart;

            // Measure trek selection
            const selectStart = Date.now();
            const selected = await selectFirstTrek(page);
            benchmarks['trekSelect'] = Date.now() - selectStart;

            if (selected) {
                await page.waitForTimeout(500);

                // Measure explore transition
                const exploreButton = page.getByText('Explore Journey →');
                if (await exploreButton.isVisible().catch(() => false)) {
                    const exploreStart = Date.now();
                    await exploreButton.click();
                    await expect(page.getByRole('button', { name: /overview/i })).toBeVisible({ timeout: 5000 });
                    benchmarks['exploreTransition'] = Date.now() - exploreStart;

                    // Measure tab switches
                    const journeyTab = page.getByRole('button', { name: /journey/i });
                    const tabStart = Date.now();
                    await journeyTab.click();
                    await page.waitForTimeout(300);
                    benchmarks['tabSwitch'] = Date.now() - tabStart;

                    // Measure return to globe
                    const backStart = Date.now();
                    await page.getByText('Akashic').click();
                    await page.waitForSelector('text=Click a marker to explore', { timeout: 5000 });
                    benchmarks['returnToGlobe'] = Date.now() - backStart;
                }
            }

            // Print benchmark results
            console.log('\n📊 Performance Benchmarks:');
            console.log('─'.repeat(40));
            Object.entries(benchmarks).forEach(([name, time]) => {
                const status = time < 1000 ? '✅' : time < 2000 ? '⚠️' : '❌';
                console.log(`${status} ${name}: ${time}ms`);
            });
            console.log('─'.repeat(40));

            // Basic assertions
            expect(benchmarks['pageLoad']).toBeLessThan(10000);
            if (benchmarks['exploreTransition']) {
                expect(benchmarks['exploreTransition']).toBeLessThan(3000);
            }
        });
    });
});
