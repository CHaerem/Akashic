/**
 * Core app flows on the globe and in trek view.
 *
 * WHAT A GREEN RUN NOW MEANS (QUA-40). The journeys come from `src/fixtures`, served by a
 * fixture CloudKit container behind `VITE_E2E_TEST_MODE` — see
 * `src/fixtures/e2eCloudKitContainer.ts`. So green proves "the app works given well-formed
 * public records", NOT "the showcase is live". Nothing here validates the CloudKit token,
 * its environment scoping, or its Allowed Origins any more; that is an owner-run check
 * against the deployed apex with a real `Origin` header, and CLAUDE.md documents the
 * trailing-slash failure that makes it non-theoretical.
 *
 * The `test` import comes from ../fixtures/test, which asserts the run made zero requests
 * to Apple. MAP-05 changed what that means for this file: the map's live dependency used to be
 * `api.mapbox.com`, and it is now `cdn.apple-mapkit.com` plus `sat-cdn.apple-mapkit.com`, which are
 * Apple hosts — so they are matched by the fixture's blocklist and EXPLICITLY ALLOWED through rather
 * than being invisible to it. Note the tests in this file cover the app shell and the landing globe,
 * which MAP-02 draws with no token and no tiles at all, so most of them would pass with the network
 * cut; it is the journey specs that carry the CDN dependency.
 */

import { test, expect } from './fixtures/test';
import { openApp, selectFirstTrek, TIMEOUTS } from './utils/test-helpers';

test.describe('Akashic App', () => {
    test('globe view renders correctly', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('canvas', { timeout: TIMEOUTS.mapInit });

        // Unambiguous only because AuthGuard forces signedIn in E2E mode, which suppresses
        // the "Made with Akashic" attribution chip. Two matches would be a strict-mode
        // violation, not a missing element.
        await expect(page.getByText('Akashic')).toBeVisible();

        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();

        await openApp(page);
        await expect(page.getByText(/(Click|Tap) a marker to explore/)).toBeVisible();
    });

    test('trek selection shows info panel', async ({ page }) => {
        await openApp(page);

        // Was `if (!selected) test.skip()`. The fixture guarantees journeys exist, so a
        // journey that cannot be selected is a defect — selectFirstTrek throws.
        await selectFirstTrek(page);

        await expect(page.getByText('Summit:')).toBeVisible();
        await expect(page.getByText('Explore Journey →')).toBeVisible();
    });

    test('explore journey shows trek details', async ({ page }) => {
        await openApp(page);
        await selectFirstTrek(page);

        await page.getByText('Explore Journey →').click();

        // OverviewTab's four stat labels are 'Duration'/'Distance'/'Ascent'/'Summit',
        // uppercased by CSS; getByText is case-insensitive, which is why these read as
        // upper case here. The fixture's name and description deliberately avoid those
        // five words, or `toBeVisible()` would throw on multiple matches.
        await expect(page.getByText('DURATION')).toBeVisible({ timeout: TIMEOUTS.dataLoad });
        await expect(page.getByText('DISTANCE')).toBeVisible();
        await expect(page.getByText('Start', { exact: true })).toBeVisible();
    });

    test('globe view matches snapshot', async ({ page }) => {
        // CI passes --ignore-snapshots, so this is a local-only regression check. The
        // fixture changed what the globe shows, so the previous baseline was deleted
        // rather than left in place lying; the first local run writes a new one.
        await openApp(page);

        await expect(page).toHaveScreenshot('globe-view.png', {
            maxDiffPixelRatio: 0.1,
        });
    });
});
