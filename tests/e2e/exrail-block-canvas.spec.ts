/**
 * E2E tests: EXRAIL block canvas — the Blocks/Text toggle inside the Routes editor.
 *
 * The workspacePage fixture seeds myRoutes.h with a route body that references
 * turnouts 200/201 (both present in myTurnouts.h), so it should parse into
 * Blocks mode automatically.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "EXRAIL block canvas"
 */

import { test, expect } from './fixtures'

async function openRoutesEditor(page: import('@playwright/test').Page) {
    await page.getByText('Routes', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

test.describe('EXRAIL block canvas', () => {
    test('renders the Blocks tab for a route whose body parses cleanly', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)

        // MOCK_ROUTES_H's single route (THROW(200)/CLOSE(201)) references turnouts
        // that exist, so Blocks should be selected by default and not disabled.
        const blocksButton = page.getByRole('button', { name: 'Blocks' })
        await expect(blocksButton).toBeVisible()
        await expect(blocksButton).toBeEnabled()

        // The Diagram canvas and palette should mount without throwing.
        await expect(page.locator('exrail-block-canvas')).toBeVisible()
        await expect(page.locator('.e-diagram').first()).toBeVisible({ timeout: 10_000 })
        await expect(page.locator('.e-symbolpalette').first()).toBeVisible({ timeout: 10_000 })
    })

    test('falls back to Text mode for a body Blocks mode cannot parse', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)

        const textButton = page.getByRole('button', { name: 'Text', exact: true })
        await textButton.click()
        const textarea = page.locator('textarea[placeholder="Route body"]')
        await expect(textarea).toBeVisible()
        await textarea.fill('THROW(200) // inline comment not supported yet')
        await textarea.blur()

        // Comments aren't supported by the block parser yet — Blocks must be disabled,
        // not silently mangle the hand-edited text.
        const blocksButton = page.getByRole('button', { name: 'Blocks' })
        await expect(blocksButton).toBeDisabled()
    })

    test('shows a trailing Done node for the file\'s auto-appended DONE, even though the route body has none', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)

        // MOCK_ROUTES_H's body is just THROW(200)/CLOSE(201) — parseRoutesFromFile strips the
        // file's own terminating DONE before this ever reaches the canvas, so the "Done" node
        // seen here can only be the synthetic marker representing that auto-appended DONE.
        await expect(page.locator('.e-diagram').first()).toBeVisible({ timeout: 10_000 })
        await expect(page.locator('.e-diagram').getByText('Done', { exact: true })).toBeVisible()
    })

    test('editing in Blocks mode updates the Raw myRoutes.h view', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)
        await expect(page.locator('.e-diagram').first()).toBeVisible({ timeout: 10_000 })

        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const rawText = await page.evaluate(() => {
            const editorEl = document.querySelector('div.monaco-editor')
            const lines = Array.from(editorEl?.querySelectorAll('.view-line') ?? [])
            return lines.map((l) => (l.textContent ?? '').replace(/ /g, ' ')).join('\n')
        })
        expect(rawText).toContain('THROW(200)')
        expect(rawText).toContain('CLOSE(201)')
    })

    test('does not corrupt a turnout-ref param to NaN when the param panel loses focus mid-edit', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)
        await expect(page.locator('.e-diagram').first()).toBeVisible({ timeout: 10_000 })

        // The param panel is a plain <input type="text"> with change.trigger (fires on blur —
        // see exrail-block-canvas.html). Select the THROW node, replace its value with
        // something that fails Number(), then blur by navigating away entirely (as a user
        // would by clicking another nav item mid-edit) rather than committing a real value.
        await page.getByText('Throw turnout (200)', { exact: true }).click({ force: true })
        const input = page.locator('exrail-block-canvas input[type="text"]').first()
        await expect(input).toBeVisible()
        await input.fill('-')
        await page.getByText('Turnouts', { exact: true }).first().click()

        await openRoutesEditor(page)
        await expect(page.locator('.e-diagram').first()).toBeVisible({ timeout: 10_000 })
        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const rawText = await page.evaluate(() => {
            const editorEl = document.querySelector('div.monaco-editor')
            const lines = Array.from(editorEl?.querySelectorAll('.view-line') ?? [])
            return lines.map((l) => (l.textContent ?? '').replace(/ /g, ' ')).join('\n')
        })
        expect(rawText).toContain('THROW(200)')
        expect(rawText).not.toContain('NaN')
    })
})
