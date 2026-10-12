/**
 * E2E tests: "+" button -> Create New dialog -> multi-turnout crossover wizard.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "New item wizard"
 */

import { test, expect } from './fixtures'

test.describe('New item wizard', () => {
    test('crossover wizard creates a virtual turnout, handlers, and hides members', async ({ workspacePage: page }) => {
        await page.getByTestId('new-item-button').click()
        await page.getByTestId('new-item-choice-crossover').click()

        await page.getByTestId('crossover-member-200').check()
        await page.getByTestId('crossover-member-201').check()
        await page.getByTestId('crossover-name').fill('Crossover Test')
        await page.getByTestId('crossover-alias').fill('XOVER_TEST')
        await expect(page.getByTestId('crossover-hide-members')).toBeChecked()
        await page.getByTestId('crossover-create').click()
        await expect(page.getByTestId('new-item-dialog')).toBeHidden()

        // Event handlers file now holds the ONTHROW/ONCLOSE pair.
        await page.getByText('Event Handlers', { exact: true }).first().click()
        await page.getByTestId('editor-tab-raw').click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        await page.waitForTimeout(500)
        const content = await page.evaluate(() =>
            Array.from(document.querySelectorAll('div.monaco-editor .view-line'))
                .map(l => (l.textContent ?? '').replace(/ /g, ' '))
                .join('\n'),
        )
        expect(content).toContain('ONTHROW(XOVER_TEST)')
        expect(content).toContain('ONCLOSE(XOVER_TEST)')

        // Turnouts file: new virtual turnout, and both members hidden.
        await page.getByText('Turnouts', { exact: true }).first().click()
        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        await page.waitForTimeout(500)
        const turnouts = await page.evaluate(() =>
            Array.from(document.querySelectorAll('div.monaco-editor .view-line'))
                .map(l => (l.textContent ?? '').replace(/ /g, ' '))
                .join('\n'),
        )
        expect(turnouts).toContain('VIRTUAL_TURNOUT(202, "Crossover Test")')
        expect(turnouts).toMatch(/SERVO_TURNOUT\(200,.*HIDDEN\)/)
        expect(turnouts).toMatch(/SERVO_TURNOUT\(201,.*HIDDEN\)/)
    })

    test('raw file choice falls through to the inline file name input', async ({ workspacePage: page }) => {
        await page.getByTestId('new-item-button').click()
        await page.getByTestId('new-item-choice-raw').click()
        await expect(page.getByPlaceholder('filename.h')).toBeVisible()
    })
})
