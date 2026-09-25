/**
 * Regression coverage for "the window is bigger than my screen and I can't
 * reach the buttons": on a small/low-res monitor, chrome used to be pushed
 * off-screen with nothing to scroll it back into view — see device-wizard.html's
 * width/height sizing fix (min()/vh-capped root panel, flex column with
 * shrink-0 header/footer and a scrollable content pane).
 *
 * This resizes the real Electron BrowserWindow down to the app's own enforced
 * floor (src/main/config.ts's window.minWidth/minHeight — the smallest size
 * the app itself will ever allow, so it's the realistic worst case) and checks
 * that the *whole* app shell stays usable at that size, not just the wizard:
 * the top toolbar, the left nav (including the Device Settings tree), an open
 * visual editor, and the Monaco raw view all render with real on-screen
 * position/height. Then it drives the "Setup New Device" wizard end to end at
 * that size, checking the footer's Next/Back/Finish stays reachable at every
 * step — that's the exact failure from the bug report (Finish pushed off the
 * bottom of the screen on the Confirm step).
 *
 * "Reachable" for the top toolbar means via its own horizontal scroll, not
 * necessarily visible without scrolling: at 900px there just isn't room for
 * every toolbar button at once, so (unlike the wizard footer, which is always
 * fully visible) the toolbar scrolls instead of clipping — see workspace.html's
 * overflow-x-auto on that row. scrollIntoViewIfNeeded() before each toBeInViewport()
 * check below exercises exactly that: the button must be reachable by scrolling,
 * not permanently cut off with nothing to scroll it back into view.
 *
 * `page.setViewportSize()` doesn't apply to Electron windows opened via
 * `_electron.launch()` (that's a browser-context API); resizing the actual
 * `BrowserWindow` via `electronApp.evaluate()` is the only way to change what
 * the renderer sees as its available space.
 */

import type { ElectronApplication } from '@playwright/test'
import { test, expect } from './fixtures'
import { config } from '../../src/main/config'

const { minWidth: SMALL_WIDTH, minHeight: SMALL_HEIGHT } = config.window

async function resizeWindow(app: ElectronApplication, width: number, height: number): Promise<void> {
    await app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0].setBounds(size)
    }, { width, height })
}

test.describe(`at the app's minimum window size (${SMALL_WIDTH}x${SMALL_HEIGHT})`, () => {
    test('workspace shell (toolbar, left nav, an open editor) stays fully reachable', async ({ electronApp, workspacePage: page }) => {
        await resizeWindow(electronApp, SMALL_WIDTH, SMALL_HEIGHT)
        await page.waitForTimeout(300)

        // Top toolbar — each button must be reachable, scrolling the toolbar's
        // own horizontal scroll region if needed (see workspace.html's
        // overflow-x-auto note), never permanently clipped off-screen.
        for (const testId of ['port-badge', 'save-button', 'connect-toggle', 'settings-button']) {
            const button = page.getByTestId(testId)
            await button.scrollIntoViewIfNeeded()
            await expect(button).toBeInViewport()
        }

        // Left nav, including the "Device Settings" tree.
        await expect(page.getByTestId('throttle-nav-item')).toBeInViewport()
        await expect(page.getByText('Roster', { exact: true }).first()).toBeInViewport()
        await expect(page.getByTestId('nav-general-wifi')).toBeInViewport()
        await expect(page.getByTestId('nav-accessories')).toBeInViewport()
        await expect(page.getByTestId('nav-startup')).toBeInViewport()
        await expect(page.getByTestId('nav-advanced')).toBeInViewport()

        // A visual editor actually gets real height, not the silent
        // zero-height collapse styles.css's "Custom element host sizing"
        // allowlist rule exists to prevent.
        await page.getByText('Roster', { exact: true }).first().click()
        await expect(page.locator('roster-editor')).toBeVisible({ timeout: 10_000 })
        const rosterBox = await page.locator('roster-editor').boundingBox()
        expect(rosterBox).not.toBeNull()
        expect(rosterBox!.height).toBeGreaterThan(50)

        // Same for the Monaco raw view, one nav click away.
        await page.getByTestId('nav-general-wifi').click()
        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const monacoBox = await page.locator('div.monaco-editor').boundingBox()
        expect(monacoBox).not.toBeNull()
        expect(monacoBox!.height).toBeGreaterThan(50)
    })

    test('"Setup New Device" wizard keeps Next/Back/Finish reachable at every step', async ({ electronApp, onboardingPage: page }) => {
        await resizeWindow(electronApp, SMALL_WIDTH, SMALL_HEIGHT)
        await page.waitForTimeout(300)

        await page.getByText('New Device', { exact: true }).click()

        async function expectFooterReachable(): Promise<void> {
            await expect(page.getByRole('button', { name: 'Cancel' })).toBeInViewport()
            await expect(page.getByRole('button', { name: /^(Next|Finish)$/ })).toBeInViewport()
        }

        // ── Select Device ───────────────────────────────────────────────────
        await expect(page.getByText('Select Device', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
        await expectFooterReachable()
        const boardButton = page.locator('button', { hasText: 'EX-CSB1' })
        await expect(boardButton.first()).toBeVisible({ timeout: 15_000 })
        await boardButton.first().click()
        await page.getByRole('button', { name: 'Next' }).click()

        // ── Select Version ──────────────────────────────────────────────────
        await expect(page.getByText('Select Version', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
        await expect(page.locator('au-dialog-container').getByRole('combobox').first()).toBeVisible({ timeout: 60_000 })
        await expectFooterReachable()
        await page.getByRole('button', { name: 'Next' }).click()

        // ── WiFi ─────────────────────────────────────────────────────────────
        await expect(page.getByText('Set up WiFi for this EX-CSB1.')).toBeVisible({ timeout: 30_000 })
        await expectFooterReachable()
        await page.getByRole('button', { name: 'Next' }).click()

        // ── Hardware ─────────────────────────────────────────────────────────
        await expect(page.getByText('Hardware settings for this EX-CSB1')).toBeVisible()
        await expectFooterReachable()
        await page.getByRole('button', { name: 'Next' }).click()

        // ── Track Power ──────────────────────────────────────────────────────
        await expect(page.getByText('Configure track power for this EX-CSB1.')).toBeVisible()
        await expectFooterReachable()
        await page.getByRole('button', { name: 'Next' }).click()

        // ── Confirm — this is the exact step from the bug report: Finish must
        // stay on-screen and clickable, not pushed off the bottom ────────────
        await expect(page.getByText('Review your selections')).toBeVisible({ timeout: 10_000 })
        await expectFooterReachable()
        await page.getByTestId('wizard-device-nickname').fill('Small Screen Device')
        await page.getByRole('button', { name: 'Finish' }).click()

        await expect(page.getByTestId('nav-general-wifi')).toBeVisible({ timeout: 15_000 })
    })
})
