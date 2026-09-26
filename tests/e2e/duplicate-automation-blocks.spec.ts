/**
 * E2E tests: Duplicate Automation Blocks dialog.
 *
 * CommandStation-EX's own compile-time check (EXRAILAsserts.h's `seqCount(id)==1` static_assert)
 * hard-fails the build the first time it sees the same ROUTE/AUTOMATION/SEQUENCE id declared
 * twice. workspace.ts's checkForDuplicateExrailBlocks() detects the same condition on every
 * workspace load and offers to remove the duplicates outright, rather than let the user discover
 * it only when a real Compile fails with a wall of cascading C++ errors.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 */

import { test, expect } from './fixtures'

async function getMonacoContent(page: import('@playwright/test').Page): Promise<string> {
    const lines = await page.locator('div.monaco-editor .view-line').allTextContents()
    return lines.map((l) => l.replace(/ /g, ' ')).join('\n')
}

test.describe('Duplicate Automation Blocks dialog', () => {
    test('appears on load naming the duplicated id', async ({ duplicateAutomationPage: page }) => {
        const dialogTitle = page.getByText('Duplicate Automation Blocks Found')
        await dialogTitle.waitFor({ state: 'visible', timeout: 5_000 })
        await expect(page.getByText('SEQUENCE(96)')).toBeVisible()
    })

    test('clicking Keep As Is leaves both copies in place', async ({ duplicateAutomationPage: page }) => {
        await page.getByText('Duplicate Automation Blocks Found').waitFor({ state: 'visible', timeout: 5_000 })
        await page.getByRole('button', { name: 'Keep As Is' }).click()
        await expect(page.getByText('Duplicate Automation Blocks Found')).not.toBeVisible()

        await page.getByTestId('nav-advanced').click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const content = await getMonacoContent(page)
        expect((content.match(/AUTOSTART SEQUENCE\(96\)/g) ?? []).length).toBe(2)
    })

    test('clicking Remove Duplicates keeps the first copy and deletes the rest', async ({ duplicateAutomationPage: page }) => {
        await page.getByText('Duplicate Automation Blocks Found').waitFor({ state: 'visible', timeout: 5_000 })
        await page.getByRole('button', { name: 'Remove Duplicates' }).click()
        await expect(page.getByText('Duplicate Automation Blocks Found')).not.toBeVisible()
        await expect(page.locator('.e-toast-success')).toContainText('Duplicates Removed', { timeout: 5_000 })

        await page.getByTestId('nav-advanced').click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const content = await getMonacoContent(page)
        expect((content.match(/AUTOSTART SEQUENCE\(96\)/g) ?? []).length).toBe(1)
        // The kept copy is the first one (SET(110)), not the second (SET(111)).
        expect(content).toContain('SET(110)')
        expect(content).not.toContain('SET(111)')

        // The removal is a pending change the user must Save to persist.
        await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
    })
})
