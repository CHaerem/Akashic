import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

/**
 * MAP-03: the MapKit journey surface gets its own project, its own dev server and its own port.
 *
 * It has to be a second server rather than a second project on the same one, because `VITE_MAP_VENDOR` is
 * baked into the served bundle — Playwright's `webServer.env` is per server, not per project. Port 5174 with
 * `VITE_MAP_VENDOR=mapkit`; port 5173 keeps the default Mapbox build, so the existing three projects and their
 * 18-passing run are untouched by this task.
 *
 * SKIPPED WITHOUT A TOKEN, on purpose and visibly. MapKit JS is served only from Apple's CDN and needs a
 * minted JWT (`node scripts/mapkit/devToken.mjs`), so there is no offline mode to fall back to. Rather than
 * fail confusingly on a machine without the `.p8`, the project and its server are simply not registered —
 * `npx playwright test --list` then shows no mapkit tests at all, which is a louder signal than a green run
 * that skipped them. Putting this in CI needs the `MAPKIT_PRIVATE_KEY` secret plus a minting step; see
 * `e2e/fixtures/test.ts` for what that costs in terms of a live Apple dependency.
 */
const mapkitToken = process.env.VITE_MAPKIT_TOKEN;
const MAPKIT_PORT = 5174;

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: isCI,
    retries: isCI ? 1 : 0,
    workers: isCI ? 2 : undefined,
    reporter: isCI ? [['html'], ['github']] : 'html',

    // Timeouts - keep them tight
    timeout: 60000,
    expect: {
        timeout: 10000,
    },

    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        actionTimeout: 8000,
        navigationTimeout: 20000,
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
            // The MapKit spec is vendor-specific; the default projects must not pick it up.
            testIgnore: /mapkit-journey\.spec\.ts/,
        },
        {
            name: 'mobile-chrome',
            use: { ...devices['Pixel 5'] },
            testIgnore: /mapkit-journey\.spec\.ts/,
        },
        {
            name: 'mobile-safari',
            use: { ...devices['iPhone 14'] },
            testIgnore: /mapkit-journey\.spec\.ts/,
        },
        ...(mapkitToken
            ? [{
                name: 'chromium-mapkit',
                use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${MAPKIT_PORT}` },
                testMatch: /mapkit-journey\.spec\.ts/,
            }]
            : []),
    ],

    webServer: [
        {
            command: 'npm run dev -- --port 5173',
            url: 'http://localhost:5173',
            reuseExistingServer: !isCI,
            timeout: 60000,
            stdout: 'ignore',
            stderr: 'pipe',
            env: {
                VITE_E2E_TEST_MODE: 'true',
            },
        },
        ...(mapkitToken
            ? [{
                command: `npm run dev -- --port ${MAPKIT_PORT}`,
                url: `http://localhost:${MAPKIT_PORT}`,
                reuseExistingServer: !isCI,
                timeout: 60000,
                stdout: 'ignore' as const,
                stderr: 'pipe' as const,
                env: {
                    VITE_E2E_TEST_MODE: 'true',
                    VITE_MAP_VENDOR: 'mapkit',
                    VITE_MAPKIT_TOKEN: mapkitToken,
                },
            }]
            : []),
    ],
});
