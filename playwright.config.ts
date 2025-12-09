import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    workers: isCI ? 1 : undefined,
    reporter: isCI ? [['html'], ['github']] : 'html',

    // Global timeout settings - more generous for map-heavy tests
    timeout: isCI ? 90000 : 60000, // 90s in CI, 60s locally

    // Expect timeout for assertions
    expect: {
        timeout: isCI ? 15000 : 10000, // 15s in CI, 10s locally
    },

    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: isCI ? 'retain-on-failure' : 'off',

        // Action timeouts
        actionTimeout: 10000,
        navigationTimeout: 30000,
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'mobile-chrome',
            use: { ...devices['Pixel 5'] },
        },
        {
            name: 'mobile-safari',
            use: { ...devices['iPhone 14'] },
        },
    ],

    webServer: {
        command: 'npm run dev -- --port 5173',
        url: 'http://localhost:5173',
        reuseExistingServer: !isCI,
        timeout: 120000,
        stdout: 'ignore',
        stderr: 'pipe',
        env: {
            VITE_E2E_TEST_MODE: 'true',
        },
    },
});
