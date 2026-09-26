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

        // Left nav, including the "Device Settings" tree. Like the toolbar above, this column
        // has its own overflow-y-auto (workspace.html) rather than clipping — with "Device
        // Settings" expanded by default, its 4 children push later entries (e.g. "Roster") below
        // the fold at this height, so reachability here means "scrollable to", not "on-screen
        // already", same as the toolbar's horizontal scroll.
        for (const navLocator of [
            page.getByTestId('throttle-nav-item'),
            page.getByText('Roster', { exact: true }).first(),
            page.getByTestId('nav-general-wifi'),
            page.getByTestId('nav-accessories'),
            page.getByTestId('nav-startup'),
            page.getByTestId('nav-advanced'),
        ]) {
            await navLocator.scrollIntoViewIfNeeded()
            await expect(navLocator).toBeInViewport()
        }

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

    test('Settings dialog keeps Done reachable', async ({ electronApp, workspacePage: page }) => {
        await resizeWindow(electronApp, SMALL_WIDTH, SMALL_HEIGHT)
        await page.waitForTimeout(300)

        await page.getByTestId('settings-button').click()
        await expect(page.getByText('App-wide preferences.')).toBeVisible({ timeout: 10_000 })

        // The body (Appearance/Connection/Build/Config Editors/Block Editor sections) scrolls on
        // its own overflow-y-auto — same reachability contract as the wizard/toolbar/left-nav
        // above — while the version caption and Done button stay pinned in the shrink-0 footer.
        const doneButton = page.getByRole('button', { name: 'Done' })
        await doneButton.scrollIntoViewIfNeeded()
        await expect(doneButton).toBeInViewport()
        await expect(page.getByTestId('app-version')).toBeInViewport()
    })

    test('Home screen: saved-config cards past the fold are reachable by scrolling', async ({ manySavedConfigsApp, manySavedConfigsPage: page }) => {
        await resizeWindow(manySavedConfigsApp, SMALL_WIDTH, SMALL_HEIGHT)
        await page.waitForTimeout(300)

        // Deliberately real wheel input, not scrollIntoViewIfNeeded()/toBeInViewport(): home.html
        // is a normal in-flow page (not a position:fixed dialog), so scrollIntoViewIfNeeded can
        // reposition scroll through an overflow:hidden ancestor in a way a real mouse wheel cannot —
        // it gave a false pass here during development. A bounding-box check after actual wheel
        // events is the only reliable signal for this element shape.
        const lastCard = page.getByText('Layout 14', { exact: true })
        await expect(lastCard).not.toBeInViewport()

        await page.mouse.move(SMALL_WIDTH / 2, SMALL_HEIGHT / 2)
        for (let i = 0; i < 15; i++) {
            await page.mouse.wheel(0, 400)
        }
        await page.waitForTimeout(300)

        const box = await lastCard.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.y).toBeGreaterThanOrEqual(0)
        expect(box!.y + box!.height).toBeLessThanOrEqual(SMALL_HEIGHT)
    })

    test('Select Port dialog keeps "Use This Board" reachable', async ({ electronApp, workspacePage: page }) => {
        await resizeWindow(electronApp, SMALL_WIDTH, SMALL_HEIGHT)
        await page.waitForTimeout(300)

        // Opens device-picker-dialog with the full (8-entry) mock board list — same
        // position:fixed-overlay shape as the wizard/settings dialogs, so
        // scrollIntoViewIfNeeded()/toBeInViewport() is valid here (see the Home-screen
        // test above for why that pairing is NOT valid for in-flow pages).
        await page.getByTestId('port-badge').click()
        await expect(page.getByText('Select Port', { exact: true })).toBeVisible({ timeout: 10_000 })

        const useThisBoardButton = page.getByRole('button', { name: 'Use This Board' })
        await useThisBoardButton.scrollIntoViewIfNeeded()
        await expect(useThisBoardButton).toBeInViewport()
        await expect(page.getByRole('button', { name: 'Cancel' })).toBeInViewport()
    })
})
