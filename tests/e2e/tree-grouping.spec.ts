/**
 * E2E tests: folder grouping in the tree-nav list editors (signals, routes, sequences, automations).
 * Folders are logical only — stored as `// @tree:` comments above the entry, never altering the
 * EXRAIL macro lines. Sensors are covered in sensors-editor.spec.ts; the shared panel is
 * folder-tree-panel.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Tree grouping"
 */

import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

async function openEditor(page: Page, label: string) {
    await page.getByText(label, { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function createFolder(page: Page, name: string) {
    await page.getByTestId('new-folder').click()
    const dialog = page.locator('[data-testid="text-input-dialog"]')
    await dialog.waitFor({ state: 'visible', timeout: 5_000 })
    await dialog.getByLabel('Folder name').fill(name)
    await dialog.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByTestId('folder-row').filter({ hasText: name })).toBeVisible()
}

async function rawText(page: Page): Promise<string> {
    await page.getByRole('button', { name: 'Raw' }).first().click()
    await expect(page.locator('div.monaco-editor').first()).toBeVisible()
    await page.waitForTimeout(400)
    return (await page.locator('div.monaco-editor').first().innerText()).replace(/ /g, ' ')
}

const cases = [
    { label: 'Routes', add: 'routes-editor button[title="Add new route"]', macro: 'ROUTE(' },
    { label: 'Sequences', add: 'sequences-editor button[title="Add new sequence"]', macro: 'SEQUENCE(' },
    { label: 'Automations', add: 'automations-editor button[title="Add new automation"]', macro: 'AUTOMATION(' },
]

test.describe('Tree grouping', () => {
    for (const c of cases) {
        test(`${c.label}: a folder holds new entries as tree leaves and writes a // @tree comment above the untouched macro`, async ({ workspacePage: page }) => {
            await openEditor(page, c.label)
            await createFolder(page, 'Yard')

            // Some fixtures seed entries already — count relative to what's there.
            const before = await page.getByTestId('tree-item').count()
            await page.locator(c.add).click()
            const folder = page.getByTestId('folder-row').filter({ hasText: 'Yard' })
            await expect(folder).toContainText('1')
            await expect(page.getByTestId('tree-item')).toHaveCount(before + 1)

            const raw = await rawText(page)
            expect(raw).toContain('// @tree: Yard')
            expect(raw).toContain(c.macro)
        })
    }

    test('Signals: tree is the nav, the right pane shows the one selected signal, and the folder is written to the raw file', async ({ workspacePage: page }) => {
        await openEditor(page, 'Signals')
        await createFolder(page, 'Yard')

        await page.getByRole('button', { name: 'Add Signal' }).click()
        await expect(page.getByTestId('tree-item')).toHaveCount(1)
        await expect(page.getByTestId('folder-row')).toContainText('1')
        await expect(page.getByTestId('signal-row')).toHaveCount(1)

        await page.getByRole('button', { name: 'Add Signal' }).click()
        await expect(page.getByTestId('tree-item')).toHaveCount(2)
        await expect(page.getByTestId('signal-row')).toHaveCount(1)

        const raw = await rawText(page)
        expect(raw).toContain('// @tree: Yard')
        expect(raw).toContain('SIGNAL(')
    })
    test('Event handlers: a folder holds new handlers, and each gets a unique // @id: comment', async ({ workspacePage: page }) => {
        await openEditor(page, 'Event Handlers')
        await createFolder(page, 'Safety')

        await page.getByTestId('add-handler-select').selectOption('ONRAILSYNCON')
        await page.getByTestId('add-handler-button').click()
        await page.getByTestId('add-handler-button').click()
        await expect(page.getByTestId('folder-row').filter({ hasText: 'Safety' })).toContainText('2')

        const raw = await rawText(page)
        expect(raw).toContain('// @tree: Safety')
        expect(raw).toContain('ONRAILSYNCON')
        const ids = [...raw.matchAll(/\/\/ @id: (\S+)/g)].map(m => m[1])
        expect(ids).toHaveLength(2)
        expect(new Set(ids).size).toBe(2)
    })
})
