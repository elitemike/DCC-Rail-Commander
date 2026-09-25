/**
 * App self-update UI, driven by the fake updater (`--mock-update`, see
 * MOCK_UPDATE_INFO in src/main/dev-mock.ts): it always reports 99.0.0 as
 * available, with notes for 99.0.0 and 98.0.0, and fakes the download.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { test as base, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { cleanupDir, launchMockUpdateApp, navigateToWorkspace } from './fixtures'

interface UpdateFixtures {
    launched: { app: ElectronApplication; testDataDir: string }
    page: Page
}

const test = base.extend<UpdateFixtures & { preferences: Record<string, unknown> | undefined }>({
    preferences: [undefined, { option: true }],
    launched: async ({ preferences }, use) => {
        const launched = await launchMockUpdateApp(preferences)
        await use(launched)
        await launched.app.close()
        cleanupDir(launched.testDataDir)
    },
    page: async ({ launched }, use) => {
        const page = await launched.app.firstWindow()
        await page.waitForLoadState('domcontentloaded')
        await page.evaluate(() => {
            document.querySelectorAll('[id^="ej2-licensing"]').forEach((el) => el.remove())
        }).catch(() => undefined)
        await use(page)
    },
})

function readPreferences(testDataDir: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(testDataDir, 'app-preferences', 'dcc-rail-commander-preferences.json'), 'utf-8'))
}

test.describe('app update', () => {
    test('startup check shows the release notes for every newer version, then downloads and installs', async ({ page }) => {
        const dialog = page.getByTestId('update-dialog')
        // The background check runs a few seconds after startup.
        await expect(dialog).toBeVisible({ timeout: 20_000 })
        await expect(page.getByTestId('update-dialog-title')).toHaveText('Update available')
        await expect(page.getByTestId('update-dialog-versions')).toContainText('99.0.0')

        const notes = page.getByTestId('update-release-notes')
        await expect(notes.getByTestId('update-release-notes-entry')).toHaveCount(2)
        await expect(notes.getByText('Version 99.0.0')).toBeVisible()
        await expect(notes.getByText('Version 98.0.0')).toBeVisible()
        await expect(notes.getByText('Mock release note for 98.0.0.')).toBeVisible()
        // Links in notes open in the OS browser, never inside the app window.
        await expect(notes.getByRole('link', { name: 'releases page' })).toHaveAttribute('target', '_blank')

        await page.getByTestId('update-download').click()
        await expect(page.getByTestId('update-install')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('update-dialog-title')).toHaveText('Update ready to install')

        // The mock backend never actually quits; the dialog just closes once install is requested.
        await page.getByTestId('update-install').click()
        await expect(dialog).toBeHidden()
    })

    test('"Skip this version" is remembered', async ({ page, launched }) => {
        await expect(page.getByTestId('update-dialog')).toBeVisible({ timeout: 20_000 })
        await page.getByTestId('update-skip').click()
        await expect(page.getByTestId('update-dialog')).toBeHidden()
        await expect.poll(() => readPreferences(launched.testDataDir).skippedUpdateVersion).toBe('99.0.0')
    })

    test.describe('with automatic checks turned off', () => {
        test.use({ preferences: { autoCheckForUpdates: false } })

        test('Settings shows the version and can check manually', async ({ launched }) => {
            const page = await navigateToWorkspace(launched.app)
            await page.getByTestId('settings-button').click()

            await expect(page.getByTestId('settings-auto-check-updates')).not.toBeChecked()
            await expect(page.getByTestId('settings-app-version')).not.toBeEmpty()
            // No startup check ran, so no update is known yet.
            await expect(page.getByTestId('update-dialog')).toHaveCount(0)

            await page.getByTestId('settings-check-updates').click()
            await expect(page.getByTestId('update-dialog')).toBeVisible({ timeout: 10_000 })
            await expect(page.getByTestId('update-release-notes-entry')).toHaveCount(2)

            await page.getByTestId('update-later').click()
            await expect(page.getByTestId('update-dialog')).toBeHidden()
            await expect(page.getByTestId('settings-update-status')).toContainText('Version 99.0.0 is available.')
        })
    })
})
