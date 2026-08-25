/**
 * E2E tests: "Strict compile" preference.
 *
 * When enabled (Settings → Build → Strict compile), the Compile button must
 * disable itself while any config file's Monaco editor has an error marker,
 * and re-enable once the error clears or the preference is turned back off.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Strict compile"
 */

import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

async function openSettings(page: Page) {
    await page.getByTestId('settings-button').click()
}

async function closeSettings(page: Page) {
    await page.getByRole('button', { name: 'Done' }).click()
}

async function openRawRoster(page: Page) {
    await page.getByText('Roster', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
}

/** Replace the Monaco editor content and wait for the debounce + validator pipeline to settle. */
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

test.describe('Strict compile', () => {
    test('disables Compile while an error marker exists, re-enables once fixed', async ({ workspacePage: page }) => {
        await openSettings(page)
        const strictCompileCheckbox = page.getByTestId('settings-strict-compile')
        await expect(strictCompileCheckbox).not.toBeChecked()
        await strictCompileCheckbox.check({ force: true })
        await closeSettings(page)

        const compileBtn = page.getByRole('button', { name: 'Compile' })
        await expect(compileBtn).toBeEnabled()

        await openRawRoster(page)
        await setMonacoContent(page, 'ROSTER(notAnInt, "Loco", "LIGHT")')
        await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 4_000 })

        await expect(compileBtn).toBeDisabled()
        await expect(compileBtn).toHaveAttribute('title', /Strict compile is on/)

        await setMonacoContent(page, 'ROSTER(42, "Loco", "LIGHT")')
        await expect(page.locator('.squiggly-error')).toHaveCount(0)
        await expect(compileBtn).toBeEnabled()
    })

    test('turning Strict compile off re-enables Compile even with an active error marker', async ({ workspacePage: page }) => {
        await openSettings(page)
        await page.getByTestId('settings-strict-compile').check({ force: true })
        await closeSettings(page)

        await openRawRoster(page)
        await setMonacoContent(page, 'ROSTER(notAnInt, "Loco", "LIGHT")')
        await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 4_000 })

        const compileBtn = page.getByRole('button', { name: 'Compile' })
        await expect(compileBtn).toBeDisabled()

        await openSettings(page)
        await page.getByTestId('settings-strict-compile').uncheck({ force: true })
        await closeSettings(page)

        await expect(compileBtn).toBeEnabled()
    })

    test('Strict compile off (default) never blocks Compile, regardless of error markers', async ({ workspacePage: page }) => {
        const compileBtn = page.getByRole('button', { name: 'Compile' })

        await openRawRoster(page)
        await setMonacoContent(page, 'ROSTER(notAnInt, "Loco", "LIGHT")')
        await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 4_000 })

        await expect(compileBtn).toBeEnabled()
    })
})
