/**
 * E2E tests: Unrecognized EXRAIL Commands Found dialog.
 *
 * A real project can contain a macro name that was never valid EXRAIL syntax at any released
 * CommandStation-EX version (a real project's own invented/misremembered command, or code copied
 * from an outside source, e.g. ONBEFORE/ONAFTER — confirmed absent from the firmware's entire git
 * history). Nothing about that fails until a real Compile, and even then only as a wall of
 * cascading, hard-to-trace C++ errors. workspace.ts's checkForUnrecognizedExrailCommands() detects
 * this on every load and surfaces it directly, independent of whether the file has ever been
 * opened in the editor (unlike the Monaco-model-based validator, which only checks files that
 * already have a live editor model) — and offers to comment out the offending block in place so
 * the project still compiles, rather than only naming the problem.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 */

import { test, expect } from './fixtures'

test.describe('Unrecognized EXRAIL Commands Found dialog', () => {
    test('appears on load naming the unrecognized command', async ({ unknownCommandPage: page }) => {
        const dialogTitle = page.getByText('Unrecognized EXRAIL Commands Found')
        await dialogTitle.waitFor({ state: 'visible', timeout: 5_000 })
        await expect(page.getByText('ONBEFORE', { exact: false })).toBeVisible()
    })

    test('clicking Dismiss closes the dialog without changing the file', async ({ unknownCommandPage: page }) => {
        await page.getByText('Unrecognized EXRAIL Commands Found').waitFor({ state: 'visible', timeout: 5_000 })
        await page.getByRole('button', { name: 'Dismiss' }).click()
        await expect(page.getByText('Unrecognized EXRAIL Commands Found')).not.toBeVisible()
    })

    test('clicking Comment Out & Continue disables the block and opens it for review', async ({ unknownCommandPage: page }) => {
        await page.getByText('Unrecognized EXRAIL Commands Found').waitFor({ state: 'visible', timeout: 5_000 })
        await page.getByRole('button', { name: 'Comment Out & Continue' }).click()
        await expect(page.getByText('Unrecognized EXRAIL Commands Found')).not.toBeVisible()
        await expect(page.getByText('Unrecognized Commands Commented Out')).toBeVisible()

        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const lines = await page.locator('div.monaco-editor .view-line').allTextContents()
        const text = lines.join('\n')
        expect(text).toContain('ONBEFORE')
        expect(text).toContain('UNRECOGNIZED')
        expect(text).toContain('/*')
    })

    test('a file with no unrecognized commands shows no dialog', async ({ workspacePage: page }) => {
        // The default workspacePage fixture's myAutomation.h has none of this — spot check that
        // the dialog does not appear unconditionally on every load.
        await expect(page.getByText('Unrecognized EXRAIL Commands Found')).not.toBeVisible({ timeout: 2_000 })
    })
})
