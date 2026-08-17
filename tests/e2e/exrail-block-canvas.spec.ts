/**
 * E2E tests: EXRAIL block canvas — the Blocks/Text toggle inside the Routes editor.
 *
 * The workspacePage fixture seeds myRoutes.h with a route body that references
 * turnouts 200/201 (both present in myTurnouts.h), so it should parse into
 * Blocks mode automatically.
 *
 * The canvas is Google Blockly (see exrail-block-canvas.ts). Blocks loaded from
 * a parsed body get deterministic ids matching their ParsedGraph node ids — for
 * MOCK_ROUTES_H's body `THROW(200)\nCLOSE(201)`, the THROW block is `n1` and the
 * CLOSE block is `n2` (see exrail-block-compiler.ts's parseBody/emitChain
 * numbering) — so blocks are targeted via Blockly's `[data-id="..."]` attribute
 * rather than by matching a single concatenated label string the way the old
 * EJ2 Diagram's custom annotation used to render (Blockly renders a block's
 * static label and its field's current value as separate text nodes, so
 * assertions here check the block's combined textContent instead of one exact
 * string).
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "EXRAIL block canvas"
 */

import { test, expect } from './fixtures'

async function openRoutesEditor(page: import('@playwright/test').Page) {
    await page.getByText('Routes', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
    // Auto-select-first-route (routes-editor.ts's attached()) can race with
    // ConfigEditorState.routes loading from disk — click explicitly rather than
    // relying on it, same as sequences-branch-logic.spec.ts's sequenceListItems().
    const firstRoute = page.locator('routes-editor nav[aria-label="Routes"] a').first()
    if (await firstRoute.count() > 0) await firstRoute.click()
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

async function getMonacoContent(page: import('@playwright/test').Page): Promise<string> {
    return page.evaluate(() => {
        const editorEl = document.querySelector('div.monaco-editor')
        const lines = Array.from(editorEl?.querySelectorAll('.view-line') ?? [])
        return lines.map((l) => (l.textContent ?? '').replace(/ /g, ' ')).join('\n')
    })
}

/**
 * Opens a ref-kind dropdown field currently showing `currentLabel` and picks the option with
 * `newLabel`. Blockly nests a connected next-block's SVG group inside its predecessor's group
 * (mirroring the logical stack), so a `[data-id="..."] .blocklyDropdownText` selector also
 * matches any block connected below — targeting via Blockly's own accessible role/label
 * (`dropdown: <current value>`) avoids that ambiguity entirely.
 */
async function pickDropdownOption(page: import('@playwright/test').Page, currentLabel: string, newLabel: string) {
    await page.getByRole('button', { name: `dropdown: ${currentLabel}`, exact: false }).click()
    const menuItem = page.locator('.blocklyMenu .blocklyMenuItem', { hasText: newLabel })
    await expect(menuItem).toBeVisible()
    await menuItem.click()
}

test.describe('EXRAIL block canvas', () => {
    test('renders the Blocks tab for a route whose body parses cleanly', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)

        // MOCK_ROUTES_H's single route (THROW(200)/CLOSE(201)) references turnouts
        // that exist, so Blocks should be selected by default and not disabled.
        const blocksButton = page.getByRole('button', { name: 'Blocks' })
        await expect(blocksButton).toBeVisible()
        await expect(blocksButton).toBeEnabled()

        // The Blockly workspace mounts without throwing, and the Actions palette is visible
        // by default (a flat, always-open flyout — not a category popup the user has to click
        // open, see exrail-blockly-toolbox.ts) without needing to click anything first.
        await expect(page.locator('exrail-block-canvas')).toBeVisible()
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        await expect(page.locator('.blocklyFlyout').first()).toBeVisible({ timeout: 10_000 })
        await expect(page.getByRole('button', { name: 'Actions' })).toHaveClass(/bg-blue-600/)
        await expect(page.locator('.blocklyFlyout').getByText('Throw turnout', { exact: false })).toBeVisible()

        // The seeded body's two blocks are present, each ending on its own field's value.
        await expect(page.locator('[data-id="n1"]')).toContainText('Throw turnout')
        await expect(page.locator('[data-id="n2"]')).toContainText('Close turnout')
    })

    test('the palette is always visible and switches groups via tabs, without popping over the workspace', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        // Actions is the default tab — its flyout is already open with no click needed.
        await expect(page.locator('.blocklyFlyout').getByText('Throw turnout', { exact: false })).toBeVisible()
        // The placed workspace blocks (loaded from the seeded body) stay visible at the same time —
        // the flyout is a permanent, non-overlapping panel, not a popup that hides them.
        await expect(page.locator('[data-id="n1"]')).toBeVisible()

        await page.getByRole('button', { name: 'Conditions' }).click()
        await expect(page.getByRole('button', { name: 'Conditions' })).toHaveClass(/bg-blue-600/)
        // MOCK_ROUTES_H's fixture defines turnouts but no sensors, so only the turnout-based
        // conditions (IFCLOSED/IFTHROWN) are available — see BLOCK_REGISTRY's isAvailable().
        await expect(page.locator('.blocklyFlyout').getByText('If turnout closed', { exact: false })).toBeVisible()
        await expect(page.locator('.blocklyFlyout').getByText('Throw turnout', { exact: false })).toHaveCount(0)
        // Still visible — switching tabs never hides the placed blocks either.
        await expect(page.locator('[data-id="n1"]')).toBeVisible()

        await page.getByRole('button', { name: 'Ends' }).click()
        await expect(page.locator('.blocklyFlyout').getByText('Done', { exact: true })).toBeVisible()
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

    test('editing in Blocks mode updates the Raw myRoutes.h view', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const rawText = await getMonacoContent(page)
        expect(rawText).toContain('THROW(200)')
        expect(rawText).toContain('CLOSE(201)')
    })

    test('turnout-ref param is a restricted dropdown of known turnouts, never free text', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        await expect(page.locator('[data-id="n1"]')).toContainText('Main Line Junction (200)')

        // Picking a different known turnout compiles cleanly, never as NaN — the field is a
        // restricted dropdown, not the free-text input a stray/unresolved value could corrupt.
        await pickDropdownOption(page, 'Main Line Junction (200)', 'Yard Entry (201)')

        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const rawText = await getMonacoContent(page)
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
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        await expect(page.locator('[data-id="n1"]')).toContainText('Main Line Junction (200)')

        await page.getByRole('button', { name: 'dropdown: Main Line Junction (200)', exact: false }).click()
        await expect(page.locator('.blocklyMenu .blocklyMenuItem', { hasText: 'mysidingpoint (201)' })).toHaveCount(1)
        // Turnout 201 now has an alias — it must be listed only by that alias, not also
        // by id/description (the dropdown would otherwise show two entries for the same target).
        await expect(page.locator('.blocklyMenu .blocklyMenuItem', { hasText: 'Yard Entry (201)' })).toHaveCount(0)
        await page.locator('.blocklyMenu .blocklyMenuItem', { hasText: 'mysidingpoint (201)' }).click()

        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const rawText = await getMonacoContent(page)
        expect(rawText).toContain('THROW(mysidingpoint)')
        expect(rawText).not.toContain('NaN')
    })

    test('a node already referencing a turnout by raw id shows its alias selected, not "(not found)"', async ({ workspacePage: page }) => {
        // MOCK_ROUTES_H's CLOSE(201) was written before this alias existed. Once the alias
        // is added, turnout 201 is only ever listed by that alias (see optionsForRefKind's
        // dedupe) — the stored raw "201" must be migrated to the alias name (see
        // exrail-block-canvas.ts's _normalizeExistingBlocks()) so the field still resolves
        // to a real option instead of falling back to "201 (not found)".
        await openAliasesEditor(page)
        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        await page.waitForTimeout(400)
        await setMonacoContent(page, 'ALIAS(mysidingpoint, 201) // type: Turnout')

        await openRoutesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        await expect(page.locator('[data-id="n2"]')).toContainText('mysidingpoint (201)')
        await expect(page.locator('[data-id="n2"]')).not.toContainText('not found')

        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const rawText = await getMonacoContent(page)
        expect(rawText).toContain('CLOSE(mysidingpoint)')
        expect(rawText).not.toContain('CLOSE(201)')
    })
})
