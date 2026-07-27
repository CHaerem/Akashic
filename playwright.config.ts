import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

/**
 * ONE server, one vendor. (MAP-05 collapsed this; MAP-03 built the split it replaced.)
 *
 * MAP-03 needed two dev servers on two ports, because `VITE_MAP_VENDOR` is baked into the served bundle and
 * Playwright's `webServer.env` is per server, not per project: port 5173 served the default Mapbox build for
 * the three device projects, and port 5174 served `VITE_MAP_VENDOR=mapkit` for a fourth. MAP-05 deleted Mapbox
 * and the flag, so there is one bundle, one server, and `mapkit-journey.spec.ts` is no longer vendor-specific
 * — it is just the journey-surface spec, and it runs in `chromium` with everything else.
 *
 * ## The token, and why a missing one skips loudly rather than failing 20 times
 *
 * MapKit JS is served only from Apple's CDN and needs a minted JWT (`node scripts/mapkit/devToken.mjs`), and
 * MAP-05 removed the surface that used to cover for its absence. So on a machine with no `.p8` the journey
 * view is `MapErrorFallback` and every spec that opens a journey fails on a canvas that will never appear —
 * about twenty timeouts, none of which names the cause.
 *
 * `JOURNEY_SPECS` is therefore ignored when no token is present. That is a deliberate, visible reduction in
 * coverage and not a fix: `npx playwright test --list` shows the journey specs missing, and the warning below
 * says why, which is a louder signal than a green run full of skips. **In CI a token is minted, so nothing is
 * skipped there** — see `.github/workflows/e2e.yml`. What survives tokenless is the landing globe, the app
 * shell and the journey DATA specs, which is exactly MAP-02's payoff: the first screen needs no credential.
 *
 * Do not "fix" the tokenless case by mocking Apple's CDN. `e2e/fixtures/test.ts` explains what the suite's
 * external dependencies are and asserts them per run; a mock would make that assertion pass for the wrong
 * reason, which is the failure shape that file exists to remove.
 */
const mapkitToken = process.env.VITE_MAPKIT_TOKEN;

/** Specs that mount the MapKit journey surface, and therefore cannot run without a token. */
const JOURNEY_SPECS = /(mapkit-journey|day-navigation)\.spec\.ts/;

if (!mapkitToken) {
    // Not an error: the tokenless run is a legitimate and useful one. But it must not look complete.
    console.warn(
        '\n[playwright] VITE_MAPKIT_TOKEN is not set, so the journey-surface specs '
        + '(mapkit-journey, day-navigation) are NOT REGISTERED.\n'
        + '[playwright] MAP-05 deleted the Mapbox surface, so the journey map cannot render without a '
        + 'MapKit token — those specs would fail on a canvas that never appears.\n'
        + '[playwright] Mint one:  export VITE_MAPKIT_TOKEN=$(node scripts/mapkit/devToken.mjs)\n',
    );
}

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
            ...(mapkitToken ? {} : { testIgnore: JOURNEY_SPECS }),
        },
        {
            name: 'mobile-chrome',
            use: { ...devices['Pixel 5'] },
            // `mapkit-journey.spec.ts` is desktop-framed (it asserts the left sidebar's attribution
            // clearance), so it stays a chromium-only spec on its own merits rather than by vendor.
            testIgnore: mapkitToken ? /mapkit-journey\.spec\.ts/ : JOURNEY_SPECS,
        },
        {
            name: 'mobile-safari',
            use: { ...devices['iPhone 14'] },
            testIgnore: mapkitToken ? /mapkit-journey\.spec\.ts/ : JOURNEY_SPECS,
        },
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
                // Spread rather than set unconditionally: `env` values must be strings, and passing
                // `undefined` here would put the literal "undefined" in the bundle, which reads as a
                // present-but-invalid token and fails at `mapkit.init` instead of at the missing-token
                // guard in `src/lib/map/mapkit/useMapKitJourney.ts`.
                ...(mapkitToken ? { VITE_MAPKIT_TOKEN: mapkitToken } : {}),
            },
        },
    ],
});
