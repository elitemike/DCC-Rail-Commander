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

async function openAliasesEditor(page: import('@playwright/test').Page) {
    await page.getByText('Aliases', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function setMonacoContent(page: import('@playwright/test').Page, text: string) {
    const editor = page.locator('div.monaco-editor').first()
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
        await page.keyboard.type(lines[i])
        if (i < lines.length - 1) await page.keyboard.press('Enter')
    }
    await page.waitForTimeout(500)
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

    test('turnout-ref param is a restricted dropdown of known turnouts, never free text', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)
        await expect(page.locator('.e-diagram').first()).toBeVisible({ timeout: 10_000 })

        // Selecting the THROW node must show a <select> of known turnouts — not the free-text
        // input that used to let a stray value (or an unresolved alias) compile into a literal
        // NaN (see exrail-block-canvas.ts's optionsFor()/onRefParamPicked()).
        await page.getByText('Throw turnout (200)', { exact: true }).click({ force: true })
        const select = page.locator('exrail-block-canvas select')
        await expect(select).toBeVisible()
        await expect(page.locator('exrail-block-canvas input[type="text"]')).toHaveCount(0)

        const optionTexts = await select.locator('option').allTextContents()
        expect(optionTexts).toEqual(expect.arrayContaining(['Main Line Junction (200)', 'Yard Entry (201)']))

        // Picking a different known turnout compiles cleanly, never as NaN.
        await select.selectOption({ label: 'Yard Entry (201)' })
        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const rawText = await page.evaluate(() => {
            const editorEl = document.querySelector('div.monaco-editor')
            const lines = Array.from(editorEl?.querySelectorAll('.view-line') ?? [])
            return lines.map((l) => (l.textContent ?? '').replace(/ /g, ' ')).join('\n')
        })
        expect(rawText).toContain('THROW(201)')
        expect(rawText).not.toContain('NaN')
    })

    test('a turnout alias shows up in the turnout-ref dropdown and compiles by name, not NaN', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        await page.waitForTimeout(400)
        await setMonacoContent(page, 'ALIAS(mysidingpoint, 201) // type: Turnout')

        await openRoutesEditor(page)
        await expect(page.locator('.e-diagram').first()).toBeVisible({ timeout: 10_000 })

        await page.getByText('Throw turnout (200)', { exact: true }).click({ force: true })
        const select = page.locator('exrail-block-canvas select')
        await expect(select).toBeVisible()
        await expect(select.locator('option', { hasText: 'mysidingpoint (201)' })).toHaveCount(1)
        // Turnout 201 now has an alias — it must be listed only by that alias, not also
        // by id/description (the dropdown would otherwise show two entries for the same target).
        await expect(select.locator('option', { hasText: 'Yard Entry (201)' })).toHaveCount(0)

        await select.selectOption({ label: 'mysidingpoint (201)' })
        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const rawText = await page.evaluate(() => {
            const editorEl = document.querySelector('div.monaco-editor')
            const lines = Array.from(editorEl?.querySelectorAll('.view-line') ?? [])
            return lines.map((l) => (l.textContent ?? '').replace(/ /g, ' ')).join('\n')
        })
        expect(rawText).toContain('THROW(mysidingpoint)')
        expect(rawText).not.toContain('NaN')
    })

    test('a node already referencing a turnout by raw id shows its alias selected, not "(not found)"', async ({ workspacePage: page }) => {
        // MOCK_ROUTES_H's CLOSE(201) was written before this alias existed. Once the alias
        // is added, turnout 201 is only ever listed in the dropdown by that alias (see the
        // dedupe in optionsFor()) — the stored raw "201" must be migrated to the alias name
        // so the <select> still resolves to a real option instead of falling back to
        // "201 (not found)".
        await openAliasesEditor(page)
        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        await page.waitForTimeout(400)
        await setMonacoContent(page, 'ALIAS(mysidingpoint, 201) // type: Turnout')

        await openRoutesEditor(page)
        await expect(page.locator('.e-diagram').first()).toBeVisible({ timeout: 10_000 })

        await page.getByText('Close turnout (mysidingpoint)', { exact: true }).click({ force: true })
        const select = page.locator('exrail-block-canvas select')
        await expect(select).toBeVisible()
        await expect(select).toHaveValue('mysidingpoint')
        await expect(select.locator('option:checked')).toHaveText('mysidingpoint (201)')
        await expect(page.getByText('not found')).toHaveCount(0)

        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const rawText = await page.evaluate(() => {
            const editorEl = document.querySelector('div.monaco-editor')
            const lines = Array.from(editorEl?.querySelectorAll('.view-line') ?? [])
            return lines.map((l) => (l.textContent ?? '').replace(/ /g, ' ')).join('\n')
        })
        expect(rawText).toContain('CLOSE(mysidingpoint)')
        expect(rawText).not.toContain('CLOSE(201)')
    })
})
