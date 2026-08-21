import { defineConfig } from '@playwright/test'

/**
 * Playwright configuration for EX-Commander E2E tests.
 *
 * Prerequisites:
 *   1. Build the Electron app:  pnpm build   (or pnpm test:e2e which does it automatically)
 *   2. Run tests:               pnpm test:e2e
 *      or directly:             ./node_modules/.bin/playwright test
 *
 * The tests launch the Electron app in --mock --skip-startup mode and use
 * a temporary directory for userData so preferences don't bleed between runs.
 */
export default defineConfig({
    testDir: './tests/e2e',
    outputDir: './tests/e2e/test-results',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: [['list'], ['html', { outputFolder: './tests/e2e/playwright-report', open: 'never' }]],
    use: {
        // Electron E2E tests capture traces + screenshots on failure for debugging.
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    // Each test launches its own full Electron process, and compile.spec.ts now
    // additionally spawns a real PlatformIO/avr-gcc build per test (compile is no
    // longer mocked — see CLAUDE.md). 6 concurrent Electron instances plus bursts of
    // native compiler processes was enough to push fixture teardown (app.close()) past
    // the test timeout under load; 4 workers keeps this reliable without a large
    // runtime cost. The 45s test timeout (up from 30s) adds headroom on top of that.
    workers: 4,
})

