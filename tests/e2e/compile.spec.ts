/**
 * E2E tests: Compile button.
 *
 * Compile always runs for real against the bundled PlatformIO toolchain — it
 * never touches hardware, so there's nothing to mock. Only upload is mocked
 * (--mock-upload, passed by the standard e2e fixture), since these tests never
 * have a real device to flash.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 */

import { test, expect } from './fixtures'

test.describe('Compile button', () => {
    test('compile button is visible', async ({ workspacePage }) => {
        const compileBtn = workspacePage.getByRole('button', { name: 'Compile' })
        await expect(compileBtn).toBeVisible()
        await expect(workspacePage.getByRole('button', { name: 'Compile & Upload' })).not.toBeVisible()
    })

    test('firmware version selector is visible next to Compile and shows the active version', async ({ workspacePage }) => {
        const versionControl = workspacePage.locator('div[title^="Firmware version"]')
        await expect(versionControl).toBeVisible()
        // No real git repo in the e2e fixture, so listTags()/pull() both fail
        // silently and loadVersions() falls back to keeping the saved config's
        // version selectable.
        await expect(versionControl).toContainText('v5.4.0-Prod')
    })

    test('Device Settings no longer shows a version field', async ({ workspacePage }) => {
        await workspacePage.getByText('Device Settings', { exact: true }).first().click()
        await expect(workspacePage.locator('config-h-editor')).toBeVisible()

        await expect(workspacePage.locator('commandstation-config-form').getByText('Version', { exact: true })).not.toBeVisible()
    })

    test('compiling with the version selector present still succeeds', async ({ workspacePage }) => {
        await workspacePage.getByRole('button', { name: 'Compile' }).click()
        await expect(workspacePage.getByText('✓ Success')).toBeVisible({ timeout: 10_000 })
    })

    test('clicking Compile shows Compiling... then ✓ Success and a success toast', async ({ workspacePage }) => {
        await workspacePage.getByRole('button', { name: 'Compile' }).click()

        await expect(workspacePage.getByRole('button', { name: 'Compiling...' })).toBeVisible()
        await expect(workspacePage.getByRole('button', { name: 'Compiling...' })).toBeDisabled()

        await expect(workspacePage.getByText('✓ Success')).toBeVisible({ timeout: 10_000 })
        await expect(workspacePage.getByRole('button', { name: 'Compile' })).toBeEnabled()

        await expect(workspacePage.locator('.e-toast-success')).toBeVisible({ timeout: 5_000 })
        await expect(workspacePage.locator('.e-toast-success')).toContainText('Compile Successful')
    })

    test('railroad progress bar is visible while compiling and removed on completion', async ({ workspacePage }) => {
        await workspacePage.getByRole('button', { name: 'Compile' }).click()

        // The compile-progress custom element and its inner track should
        // appear as soon as isCompiling flips to true
        await expect(workspacePage.locator('compile-progress')).toBeVisible()
        await expect(workspacePage.locator('.rr-wrapper')).toBeVisible()

        // Wait for mock compile to finish
        await expect(workspacePage.getByText('✓ Success')).toBeVisible({ timeout: 10_000 })

        // If.bind removes the element from the DOM when isCompiling returns to false
        await expect(workspacePage.locator('compile-progress')).not.toBeVisible()
        await expect(workspacePage.locator('.rr-wrapper')).not.toBeVisible()
    })

    test('compile output panel shows log text', async ({ workspacePage }) => {
        await workspacePage.getByRole('button', { name: 'Compile' }).click()
        await expect(workspacePage.getByText('✓ Success')).toBeVisible({ timeout: 10_000 })

        // xterm's accessibility tree only renders the current scroll viewport, not the
        // full buffer — a real compile streams far more lines than the terminal can show
        // at once, so only lines still near the end (where output naturally settles) are
        // asserted here. The Copy-button test below reads the full clipboard buffer and
        // covers the early "Compiling for" line.
        const outputPanel = workspacePage.locator('compile-output-terminal .xterm-accessibility-tree')
        await expect(outputPanel).toContainText('Flash:')
        await expect(outputPanel).toContainText('✓ Compile successful!')
    })

    test('Clear button removes the compile output panel content', async ({ workspacePage }) => {
        await workspacePage.getByRole('button', { name: 'Compile' }).click()
        await expect(workspacePage.getByText('✓ Success')).toBeVisible({ timeout: 10_000 })

        await workspacePage.getByRole('button', { name: /Clear/ }).click()

        await expect(workspacePage.getByText('✓ Success')).not.toBeVisible()
        const outputPanel = workspacePage.locator('compile-output-terminal .xterm-accessibility-tree')
        await expect(outputPanel).not.toContainText('Compiling for')
        await expect(outputPanel).not.toContainText('Compile successful!')
    })

    test('Copy button copies the compile output to the clipboard', async ({ workspacePage, electronApp }) => {
        await workspacePage.getByRole('button', { name: 'Compile' }).click()
        await expect(workspacePage.getByText('✓ Success')).toBeVisible({ timeout: 10_000 })

        await workspacePage.locator('button[title="Copy output to clipboard"]').click()
        await expect(workspacePage.locator('.e-toast-success').last()).toContainText('Copied', { timeout: 5_000 })

        // Read via Electron's native clipboard module rather than the renderer's
        // navigator.clipboard.readText(): reading through the web Clipboard API
        // requires a 'clipboard-read' permission grant that Electron doesn't hand
        // out by default, so it can silently resolve empty even though the app's
        // own writeText() (which needs no such grant) already succeeded.
        //
        // The write itself crosses renderer → OS clipboard → this out-of-process
        // read, and on Windows that hop can be measurably delayed by clipboard
        // hooks (DLP/EDR agents, clipboard-history managers) that sit between
        // SetClipboardData and other readers — so poll instead of reading once.
        await expect
            .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5_000 })
            .toContain('Compiling for')
        const clipboardText = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
        expect(clipboardText).toContain('✓ Compile successful!')
    })

    test('Save button is visible and enabled next to Copy and Clear', async ({ workspacePage }) => {
        await workspacePage.getByRole('button', { name: 'Compile' }).click()
        await expect(workspacePage.getByText('✓ Success')).toBeVisible({ timeout: 10_000 })

        await expect(workspacePage.locator('button[title="Save output to a file"]')).toBeEnabled()
    })

    test('a second compile after clearing also succeeds', async ({ workspacePage }) => {
        await workspacePage.getByRole('button', { name: 'Compile' }).click()
        await expect(workspacePage.getByText('✓ Success')).toBeVisible({ timeout: 10_000 })

        await workspacePage.getByRole('button', { name: /Clear/ }).click()
        await expect(workspacePage.getByText('✓ Success')).not.toBeVisible()

        await workspacePage.getByRole('button', { name: 'Compile' }).click()
        await expect(workspacePage.getByText('✓ Success')).toBeVisible({ timeout: 10_000 })
    })

    test('compile succeeds with invalid lines present in roster raw', async ({ workspacePage }) => {
        await workspacePage.getByText('Roster', { exact: true }).first().click()
        await workspacePage.getByRole('button', { name: 'Raw' }).click()
        await expect(workspacePage.locator('div.monaco-editor')).toBeVisible()

        const editor = workspacePage.locator('div.monaco-editor').first()
        await editor.click()
        await workspacePage.keyboard.press('Control+End')
        await workspacePage.keyboard.type('\nROSTER(badentry)')
        await workspacePage.getByRole('button', { name: 'Visual' }).click()
        await workspacePage.waitForTimeout(300)

        await workspacePage.getByRole('button', { name: 'Compile' }).click()
        await expect(workspacePage.getByText('✓ Success')).toBeVisible({ timeout: 10_000 })
    })
})

