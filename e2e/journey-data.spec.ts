/**
 * The data path: records -> mappers -> transforms -> UI.
 *
 * This is the spec QUA-40 was failing on. Test 1 collects console errors matching
 * /supabase|cloudkit/ and asserts zero; with the production token in CI it received
 * "[cloudkit] Error fetching public journeys" on every run. MEASURED against the REST
 * endpoint with that token: `Origin: https://akashic.no` -> 200,
 * `Origin: http://localhost:5173` -> 401, no `Origin` header -> 401. The token is
 * origin-locked to the apex and CI serves from localhost, so no amount of publishing
 * records could have turned this green — the 401 precedes any record being considered.
 *
 * The records now come from a fixture container (`src/fixtures/e2eCloudKitContainer.ts`),
 * but they are fed in as CloudKit WIRE FORMAT — TIMESTAMP numbers, LOCATION objects, CKAsset
 * descriptors, camelCase day content — so `performQueryAll`, every coercion in `records.ts`,
 * `recordToPublicDbJourney`, `mapWaypoint`, the deterministic sort and
 * `toTrekConfig`/`toTrekData` are all still exercised end to end. The name kept "CloudKit"
 * because the CloudKit code really is what is under test; only the transport is fixed.
 */

import { test, expect } from './fixtures/test';
import { openApp, selectFirstTrek, getTreks, TIMEOUTS } from './utils/test-helpers';

test.describe('CloudKit Data Loading', () => {
    test('app loads with no CloudKit errors on the console', async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error' && /supabase|cloudkit/.test(msg.text().toLowerCase())) {
                errors.push(msg.text());
            }
        });

        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: TIMEOUTS.mapInit });

        await expect(page.getByText('Akashic')).toBeVisible({ timeout: TIMEOUTS.dataLoad });

        await openApp(page);

        // The hint appears only once data is available.
        await expect(page.getByText(/(Click|Tap) a marker to explore/)).toBeVisible({
            timeout: TIMEOUTS.dataLoad,
        });

        expect(errors).toHaveLength(0);
    });

    test('more than one journey loads, in deterministic order', async ({ page }) => {
        // NEW, and it is the assertion the old suite could not make: with live data the
        // globe's contents were whatever the owner had published, so nothing could check
        // ordering. The fixture holds two journeys whose query order is the OPPOSITE of
        // their dateStarted order, so this asserts the deterministic sort at
        // publicAdapter.ts:223-230 — the one that stopped the globe reshuffling its
        // journeys between page loads depending on which route asset resolved first.
        await openApp(page);

        const first = await getTreks(page);
        expect(first.length).toBeGreaterThan(1);

        await page.reload();
        await openApp(page);
        const second = await getTreks(page);

        expect(second.map((t) => t.id)).toEqual(first.map((t) => t.id));
    });

    test('trek data reaches the overview panel', async ({ page }) => {
        await openApp(page);

        // Was `if (!selected) { console.log(...); test.skip(); }` — which is how this file
        // stayed nominally green while proving nothing.
        await selectFirstTrek(page);

        await expect(page.getByText('Summit:')).toBeVisible();

        await page.getByText('Explore Journey →').click();

        // BottomSheetContent/Sidebar only render OverviewTab when trekData is non-null, so
        // these three also prove the selected journey made it into trekDataMap — a journey
        // present in `treks` but missing from `trekDataMap` renders nothing here.
        await expect(page.getByText('DURATION')).toBeVisible({ timeout: TIMEOUTS.dataLoad });
        await expect(page.getByText('DISTANCE')).toBeVisible();
        await expect(page.getByText('SUMMIT')).toBeVisible();
    });
});
