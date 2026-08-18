/**
 * E2E tests: EXRAIL block canvas — the Blocks/Raw toggle inside the Routes editor.
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
        // Scoped to the whole-file Raw tab specifically — the per-row Raw editor (when a row
        // is in text mode) is a second, separate `<monaco-editor>` that can coexist in the DOM
        // (class-toggled hidden, not if.bind — see routes-editor.html), so an unscoped
        // `div.monaco-editor` query would be ambiguous whenever both are mounted.
        const editorEl = document.querySelector('[data-testid="file-body-monaco"] div.monaco-editor')
            ?? document.querySelector('div.monaco-editor')
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

        // The Blockly workspace mounts without throwing. The palette is our own nested-category
        // sidebar (see exrail-blockly-toolbox.ts) driving Blockly's always-visible, non-overlapping
        // flyout — Turnouts is selected by default with no click needed.
        await expect(page.locator('exrail-block-canvas')).toBeVisible()
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        await expect(page.locator('.blocklyFlyout').first()).toBeVisible({ timeout: 10_000 })
        const palette = page.locator('exrail-block-canvas nav')
        await expect(palette.getByRole('button', { name: 'Turnouts', exact: false })).toHaveClass(/bg-blue-600/)
        await expect(page.locator('.blocklyFlyout').getByText('Throw turnout', { exact: false })).toBeVisible()

        // The seeded body's two blocks are present, each ending on its own field's value.
        await expect(page.locator('[data-id="n1"]')).toContainText('Throw turnout')
        await expect(page.locator('[data-id="n2"]')).toContainText('Close turnout')
    })

    test('the palette groups blocks into nested categories without ever overlaying the workspace', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        // The flyout is a permanent, non-overlapping panel — always open, never popping over the
        // placed workspace blocks (see exrail-blockly-toolbox.ts's flyout-only-toolbox rationale).
        await expect(page.locator('.blocklyFlyout').first()).toBeVisible()
        await expect(page.locator('[data-id="n1"]')).toBeVisible()

        // MOCK_ROUTES_H's fixture defines turnouts but no sensors, so the turnout category
        // includes its conditions (IFCLOSED/IFTHROWN) alongside the actions — see
        // BLOCK_REGISTRY's isAvailable().
        await expect(page.locator('.blocklyFlyout').getByText('Throw turnout', { exact: false })).toBeVisible()
        await expect(page.locator('.blocklyFlyout').getByText('If turnout closed', { exact: false })).toBeVisible()

        // Locomotives is a parent category containing Driving/Functions subcategories, not blocks
        // of its own — clicking it expands the tree without selecting a leaf or touching the flyout.
        const palette = page.locator('exrail-block-canvas nav')
        const locomotivesCategory = palette.getByRole('button', { name: 'Locomotives', exact: false })
        await locomotivesCategory.click()
        const drivingCategory = palette.getByRole('button', { name: 'Driving', exact: false })
        const functionsCategory = palette.getByRole('button', { name: 'Functions', exact: false })
        await expect(drivingCategory).toBeVisible()
        await expect(functionsCategory).toBeVisible()
        // Still visible — expanding a parent category never hides the placed blocks either.
        await expect(page.locator('[data-id="n1"]')).toBeVisible()

        await drivingCategory.click()
        await expect(page.locator('.blocklyFlyout').getByText('Drive forward', { exact: false })).toBeVisible()
        await expect(page.locator('.blocklyFlyout').getByText('Set active loco', { exact: false })).toBeVisible()

        await functionsCategory.click()
        await expect(page.locator('.blocklyFlyout').getByText('Function on', { exact: true })).toBeVisible()

        await palette.getByRole('button', { name: 'Control', exact: false }).click()
        await expect(page.locator('.blocklyFlyout').getByText('Done', { exact: true })).toBeVisible()
        // The whole time, the workspace canvas (and its placed blocks) is never covered.
        await expect(page.locator('[data-id="n1"]')).toBeVisible()
    })

    test('falls back to Raw mode for a body Blocks mode cannot parse', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)

        const rawButton = page.getByTestId('row-tab-raw')
        await rawButton.click()
        const rowEditor = page.getByTestId('row-body-monaco')
        await expect(rowEditor).toBeVisible()
        const editor = rowEditor.locator('div.monaco-editor')
        await editor.click()
        await page.keyboard.press('Control+A')
        await page.keyboard.type('ROUTE(1, "Main Line")\nTHROW(200) // inline comment not supported yet')
        // Row commits happen via the Monaco 300ms debounce (see rowRawEditor.onTextChange in
        // routes-editor.ts), not blur — wait it out instead of blurring.
        await page.waitForTimeout(500)

        // Comments aren't supported by the block parser yet — Blocks must be disabled,
        // not silently mangle the hand-edited text.
        const blocksButton = page.getByRole('button', { name: 'Blocks' })
        await expect(blocksButton).toBeDisabled()
    })

    test('editing in Blocks mode updates the Raw myRoutes.h view', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        await page.getByTestId('editor-tab-raw').click()
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

        await page.getByTestId('editor-tab-raw').click()
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

        await page.getByTestId('editor-tab-raw').click()
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

        await page.getByTestId('editor-tab-raw').click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const rawText = await getMonacoContent(page)
        expect(rawText).toContain('CLOSE(mysidingpoint)')
        expect(rawText).not.toContain('CLOSE(201)')
    })

    test('resizes correctly after the file-level Visual/Raw tabs are toggled away and back', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        const sizeBefore = await page.locator('.blocklySvg').first().boundingBox()
        expect(sizeBefore?.width).toBeGreaterThan(100)

        // Leaving the file-level Visual tab keeps this component mounted but `display:none`
        // (see routes-editor.html) rather than tearing it down — a real trigger for Blockly's
        // classic "sized while hidden" staleness bug. exrail-block-canvas.ts's IntersectionObserver
        // exists specifically to correct this when the tab becomes visible again.
        await page.getByTestId('editor-tab-raw').click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        await page.getByRole('button', { name: 'Visual', exact: true }).click()
        await expect(page.locator('.blocklySvg').first()).toBeVisible()
        await page.waitForTimeout(300)

        const sizeAfter = await page.locator('.blocklySvg').first().boundingBox()
        expect(sizeAfter?.width).toBeGreaterThanOrEqual((sizeBefore?.width ?? 0) - 5)
        expect(sizeAfter?.height).toBeGreaterThanOrEqual((sizeBefore?.height ?? 0) - 5)
    })

    test('resizes correctly after switching between sequence rows', async ({ workspacePage: page }) => {
        await page.getByText('Sequences', { exact: true }).first().click()
        await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
        await page.getByTestId('editor-tab-raw').click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        await setMonacoContent(page, [
            'SEQUENCE(1)',
            'DELAY(500)',
            'DONE',
            '',
            'SEQUENCE(2)',
            'DELAY(1000)',
            'DONE',
        ].join('\n'))
        await page.getByRole('button', { name: 'Visual', exact: true }).click()

        const rows = page.locator('sequences-editor nav[aria-label="Sequences"] a')
        await rows.nth(0).click()
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        const sizeBefore = await page.locator('.blocklySvg').first().boundingBox()
        expect(sizeBefore?.width).toBeGreaterThan(100)

        // Switching rows reuses the same Blockly instance rather than re-injecting it (see
        // exrail-block-canvas.ts's reload()) — its own Blockly.svgResize() call guards against the
        // same metrics staleness the IntersectionObserver guards against on the hidden-tab path.
        await rows.nth(1).click()
        await page.waitForTimeout(300)

        const sizeAfter = await page.locator('.blocklySvg').first().boundingBox()
        expect(sizeAfter?.width).toBeGreaterThanOrEqual((sizeBefore?.width ?? 0) - 5)
        expect(sizeAfter?.height).toBeGreaterThanOrEqual((sizeBefore?.height ?? 0) - 5)
    })

    test('resizes correctly after navigating away to a different config file and back', async ({ workspacePage: page }) => {
        // Unlike the file-level Visual/Raw tab (kept mounted, just `display:none` — see
        // routes-editor.html/sequences-editor.html) and row switching (reload() reuses the same
        // Blockly instance), the left CONFIGURATION nav's `if.bind="currentView === '...'"`
        // (file-editor-panel.html) fully destroys <sequences-editor> — and its child
        // exrail-block-canvas — when leaving, and mounts a fresh instance on return. On a fresh
        // mount the detail column sits inside a Syncfusion Splitter pane, which overwrites that
        // column's own class attribute with its own (display:block) e-pane classes — silently
        // breaking any `flex-1` on its children, since flex-basis sizing only works against a
        // `display:flex` parent (see the h-full comments in sequences-editor.html's Detail panel).
        await page.getByText('Sequences', { exact: true }).first().click()
        await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
        await page.getByTestId('editor-tab-raw').click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        await setMonacoContent(page, ['SEQUENCE(1)', 'DELAY(500)', 'DONE'].join('\n'))
        await page.getByRole('button', { name: 'Visual', exact: true }).click()
        await page.locator('sequences-editor nav[aria-label="Sequences"] a').first().click()
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        await page.getByText('Signals', { exact: true }).first().click()
        await expect(page.locator('signals-editor')).toBeVisible()
        await page.getByText('Sequences', { exact: true }).first().click()
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        await page.waitForTimeout(300)

        // The injected SVG should fill its immediate viewport wrapper exactly, not just be
        // "reasonably large" — this is the direct signal of the reported bug (a small, stale-sized
        // SVG inside an otherwise correctly-sized wrapper).
        const viewportBox = await page.getByTestId('canvas-viewport').boundingBox()
        const svgBox = await page.locator('.blocklySvg').first().boundingBox()
        expect(svgBox?.width).toBeGreaterThanOrEqual((viewportBox?.width ?? 0) - 2)
        expect(svgBox?.height).toBeGreaterThanOrEqual((viewportBox?.height ?? 0) - 2)
        // And the wrapper itself should be tall — a regression here would otherwise pass trivially
        // by having both sides of the comparison collapse together.
        expect(viewportBox?.height).toBeGreaterThan(300)
    })
})
