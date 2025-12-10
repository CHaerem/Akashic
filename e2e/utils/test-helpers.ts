/**
 * Shared E2E test utilities
 * Common helpers for Akashic app testing
 */

import type { Page } from '@playwright/test';

// Timeout constants - keep tight for fast CI
export const TIMEOUTS = {
    mapInit: 15000,
    dataLoad: 8000,
    transition: 5000,
    action: 3000,
} as const;

/**
 * Wait for map to be fully ready using test helpers exposed by the app
 */
export async function waitForMapReady(page: Page, timeout = TIMEOUTS.mapInit): Promise<boolean> {
    const startTime = Date.now();
    let pollInterval = 100;
    const maxInterval = 500;

    while (Date.now() - startTime < timeout) {
        const ready = await page.evaluate(() => {
            return window.testHelpers?.isMapReady() && window.testHelpers?.isDataLoaded();
        }).catch(() => false);

        if (ready) return true;

        await page.waitForTimeout(pollInterval);
        // Exponential backoff to reduce CPU usage
        pollInterval = Math.min(pollInterval * 1.5, maxInterval);
    }

    return false;
}

/**
 * Select the first available trek programmatically
 */
export async function selectFirstTrek(page: Page): Promise<boolean> {
    return await page.evaluate(() => {
        const treks = window.testHelpers?.getTreks();
        if (treks && treks.length > 0) {
            return window.testHelpers?.selectTrek(treks[0].id) || false;
        }
        return false;
    }).catch(() => false);
}

/**
 * Select a specific trek by name (case-insensitive partial match)
 */
export async function selectTrekByName(page: Page, name: string): Promise<boolean> {
    return await page.evaluate((searchName) => {
        const treks = window.testHelpers?.getTreks() || [];
        const trek = treks.find((t: { id: string; name: string }) =>
            t.name.toLowerCase().includes(searchName.toLowerCase())
        );
        if (trek) {
            return window.testHelpers?.selectTrek(trek.id) || false;
        }
        return false;
    }, name).catch(() => false);
}

/**
 * Get list of available treks
 */
export async function getTreks(page: Page): Promise<Array<{ id: string; name: string }>> {
    return await page.evaluate(() => {
        return window.testHelpers?.getTreks() || [];
    }).catch(() => []);
}

/**
 * Navigate to trek exploration view
 */
export async function navigateToTrek(page: Page): Promise<boolean> {
    const selected = await selectFirstTrek(page);
    if (!selected) return false;

    await page.waitForTimeout(300);

    const exploreButton = page.getByText('Explore Journey →');
    const isVisible = await exploreButton.isVisible().catch(() => false);
    if (!isVisible) return false;

    await exploreButton.click();
    await page.waitForTimeout(300);

    return true;
}

/**
 * Setup performance observers for long task and frame rate tracking
 */
export async function setupPerformanceObserver(page: Page): Promise<void> {
    await page.addInitScript(() => {
        (window as any).__longTasks = [];
        (window as any).__frameTimestamps = [];

        // Track long tasks
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    (window as any).__longTasks.push({
                        duration: entry.duration,
                        startTime: entry.startTime,
                    });
                }
            });
            observer.observe({ entryTypes: ['longtask'] });
        } catch {
            // PerformanceObserver may not support longtask in all browsers
        }

        // Track frame rate
        let lastTime = performance.now();
        let frameCount = 0;
        const measureFrames = () => {
            const now = performance.now();
            (window as any).__frameTimestamps.push(now - lastTime);
            lastTime = now;
            frameCount++;
            if (frameCount < 300) {
                requestAnimationFrame(measureFrames);
            }
        };
        requestAnimationFrame(measureFrames);
    });
}

/**
 * Get long tasks recorded during the test
 */
export async function getLongTasks(page: Page): Promise<Array<{ duration: number; startTime: number }>> {
    return await page.evaluate(() => (window as any).__longTasks || []);
}

/**
 * Get frame timestamps for FPS calculation
 */
export async function getFrameTimestamps(page: Page): Promise<number[]> {
    return await page.evaluate(() => (window as any).__frameTimestamps || []);
}

/**
 * Calculate average FPS from frame timestamps
 */
export function calculateFps(frameTimestamps: number[], sampleSize = 60): number {
    if (frameTimestamps.length < 10) return 0;

    const recentFrames = frameTimestamps.slice(-sampleSize);
    const avgFrameTime = recentFrames.reduce((a, b) => a + b, 0) / recentFrames.length;
    return 1000 / avgFrameTime;
}
