import { defineConfig } from '@playwright/test'

/**
 * Playwright configuration for EX-Installer E2E tests.
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
    timeout: 30_000,
    expect: { timeout: 10_000 },
    reporter: [['list'], ['html', { outputFolder: './tests/e2e/playwright-report', open: 'never' }]],
    use: {
        // Electron E2E tests capture traces + screenshots on failure for debugging.
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    // Run all E2E tests parallel — each test launches its own Electron process.
    workers: 6,
})

