/**
 * E2E tests: "Quick compile" preference (Settings → Build → Quick compile).
 *
 * On by default. When on, saveFiles() fires a real (never mocked — see
 * compile.spec.ts's own note on this) syntax-only check of the sketch's own
 * source files in the background after every Save, and any diagnostics land
 * as Monaco markers under the 'quick-compile' owner — same `.squiggly-error`
 * CSS class as the local dccex-validator's own markers (see
 * strict-compile.spec.ts), and the same file-list error dot.
 *
 * config.h has no local dccex-validator entry (see FILE_VALIDATORS in
 * dccex-validators.ts) and isn't an EXRAIL command-vocabulary file, so any
 * squiggle that appears on it can only have come from Quick Compile — no
 * ambiguity with the always-on static validators the other config files have.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Quick compile"
 */

import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

const BROKEN_CONFIG_H = [
    '// config.h — mock test configuration',
    '#define MAIN_DRIVER_MOTOR_SHIELD STANDARD_MOTOR_SHIELD',
    'this is not valid C++ syntax !!!',
].join('\n')

const VALID_CONFIG_H = [
    '// config.h — mock test configuration',
    '#define MAIN_DRIVER_MOTOR_SHIELD STANDARD_MOTOR_SHIELD',
    '// a harmless comment, to make a Save necessary',
].join('\n')

async function openSettings(page: Page) {
    await page.getByTestId('settings-button').click()
}

async function closeSettings(page: Page) {
    await page.getByRole('button', { name: 'Done' }).click()
}

/** The toolbar Save button only opens a diff-review dialog — the actual save happens on its own Save button (see file-changes-preview.spec.ts's identical openChanges() helper). */
async function clickSave(page: Page) {
    await page.getByTestId('save-button').click()
    await page.getByTestId('file-changes-close-button').waitFor({ state: 'visible' })
    await page.getByTestId('file-changes-save-button').click()
}

async function openRawConfigH(page: Page) {
    await page.getByTestId('nav-general-wifi').click()
    await expect(page.locator('config-h-editor')).toBeVisible()
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
}

/** Replace the Monaco editor content and wait for the debounce to settle. */
async function setMonacoContent(page: Page, text: string) {
    const editor = page.locator('div.monaco-editor').first()
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
        await page.keyboard.type(lines[i])
        if (i < lines.length - 1) await page.keyboard.press('Enter')
    }
    await page.waitForTimeout(600)
}

test.describe('Quick compile', () => {
    test('is on by default', async ({ workspacePage: page }) => {
        await openSettings(page)
        await expect(page.getByTestId('settings-quick-compile')).toBeChecked()
        await closeSettings(page)
    })

    test('a syntax error in config.h surfaces as a squiggle and error dot after Save, and clears once fixed', async ({ workspacePage: page }) => {
        await openRawConfigH(page)
        await setMonacoContent(page, BROKEN_CONFIG_H)
        await clickSave(page)

        await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 20_000 })
        await expect(page.getByTestId('error-dot-general-wifi')).toBeVisible()

        await setMonacoContent(page, VALID_CONFIG_H)
        await clickSave(page)

        await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: 20_000 })
        await expect(page.getByTestId('error-dot-general-wifi')).toHaveCount(0)
    })

    test('saving a valid config reports no errors', async ({ workspacePage: page }) => {
        await openRawConfigH(page)
        await setMonacoContent(page, VALID_CONFIG_H)
        await clickSave(page)

        // Give the real (unmocked) quick-compile round trip time to run, then
        // confirm it found nothing — a fixed wait rather than a toBeVisible
        // poll, since there is no positive event to wait on for "no error
        // appeared".
        await page.waitForTimeout(6_000)
        await expect(page.locator('.squiggly-error')).toHaveCount(0)
        await expect(page.getByTestId('error-dot-general-wifi')).toHaveCount(0)
    })

    test('turning Quick compile off stops it from running on Save', async ({ workspacePage: page }) => {
        await openSettings(page)
        await page.getByTestId('settings-quick-compile').uncheck({ force: true })
        await closeSettings(page)

        await openRawConfigH(page)
        await setMonacoContent(page, BROKEN_CONFIG_H)
        await clickSave(page)

        // Same real config.h that produces a squiggle in the test above —
        // with the preference off, nothing ran to detect it.
        await page.waitForTimeout(6_000)
        await expect(page.locator('.squiggly-error')).toHaveCount(0)
        await expect(page.getByTestId('error-dot-general-wifi')).toHaveCount(0)
    })

    test('writes a status line with timing to the Output panel when it is open', async ({ workspacePage: page }) => {
        // A real Compile is the normal way the Output panel gets opened with
        // the Output tab active — reuse that rather than reaching into
        // workspace.ts internals (see compile.spec.ts for the same pattern).
        await page.getByRole('button', { name: 'Compile' }).click()
        await expect(page.getByText('✓ Success')).toBeVisible({ timeout: 30_000 })

        await openRawConfigH(page)
        await setMonacoContent(page, VALID_CONFIG_H)
        await clickSave(page)

        const outputPanel = page.locator('compile-output-terminal .xterm-accessibility-tree')
        await expect(outputPanel).toContainText('[Quick Compile] ✓ OK', { timeout: 20_000 })
        await expect(outputPanel).toContainText(/\[Quick Compile\][^\n]*\(\d+\.\d+s\)/)
    })

    test('does not write to the Output panel while it is closed', async ({ workspacePage: page }) => {
        // Panel starts collapsed by default — never opened in this test.
        await openRawConfigH(page)
        await setMonacoContent(page, VALID_CONFIG_H)
        await clickSave(page)

        await page.waitForTimeout(6_000)
        // xterm doesn't mount its accessibility tree at all while its container has
        // near-zero height (the pane collapsed), so this locator may resolve to zero
        // elements rather than an empty one — either way proves nothing was written.
        const outputPanel = page.locator('compile-output-terminal .xterm-accessibility-tree')
        if (await outputPanel.count() > 0) {
            await expect(outputPanel).not.toContainText('[Quick Compile]')
        }
    })
})
