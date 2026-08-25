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

/** Reads the always-visible readonly output pane (exrail-block-canvas.ts's outputText, rendered
 *  into a plain `<pre>` — no Monaco view-line juggling needed, unlike getMonacoContent above). */
async function getOutputPaneText(page: import('@playwright/test').Page): Promise<string> {
    return (await page.getByTestId('exrail-output-text').textContent()) ?? ''
}

async function getMonacoContent(page: import('@playwright/test').Page): Promise<string> {
    // Monaco paints `.view-line` nodes asynchronously (next frame) after a model swap —
    // right after clicking the Raw tab the editor container can exist with zero rendered
    // lines yet, which would read back as "". Poll until at least one line has painted.
    await page.waitForFunction(() => {
        const editorEl = document.querySelector('[data-testid="file-body-monaco"] div.monaco-editor')
            ?? document.querySelector('div.monaco-editor')
        return (editorEl?.querySelectorAll('.view-line').length ?? 0) > 0
    })
    return page.evaluate(() => {
        // Scoped to the whole-file Raw tab specifically — the per-row Raw editor (when a row
        // is in text mode) is a second, separate `<monaco-editor>` that can coexist in the DOM
        // (class-toggled hidden, not if.bind — see routes-editor.html), so an unscoped
        // `div.monaco-editor` query would be ambiguous whenever both are mounted.
        const editorEl = document.querySelector('[data-testid="file-body-monaco"] div.monaco-editor')
            ?? document.querySelector('div.monaco-editor')
        const lines = Array.from(editorEl?.querySelectorAll('.view-line') ?? [])
        // Monaco renders spaces in .view-line as U+00A0 (non-breaking space) — normalize to a
        // regular space so string comparisons against literal source text work as expected. (Was
        // previously a no-op — regular-space-to-regular-space — until this test file's own
        // STEALTH coverage below became the first assertion here to compare a substring
        // containing spaces.)
        return lines.map((l) => (l.textContent ?? '').replace(/ /g, ' ')).join('\n')
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

/**
 * Sets the hat block's ALIAS field (see exrail-blockly-blocks.ts's ExrailAliasField) — a Blockly
 * field, not a plain `<input>`. Mirrors sequences-editor.spec.ts's setHatAlias(); needed here
 * because strict aliases is on by default, and MOCK_ROUTES_H's seeded route has none, so any
 * genuine body edit (dropdown pick, alias-driven field normalization) is blocked until one exists.
 */
async function setHatAlias(page: import('@playwright/test').Page, value: string) {
    // Targeted by the field's current (blank) value rather than `[data-id="hat"]` — Blockly nests
    // a connected next block's whole SVG group *inside* its predecessor's (mirroring the logical
    // stack, per pickDropdownOption's own comment above), so `[data-id="hat"] ...` still matches
    // any block connected below it too (e.g. STEALTH's code field) once one exists on the canvas.
    // Every caller here only ever uses this to set a hat alias starting from blank.
    await page.getByRole('button', { name: 'Edit text: empty' }).click()
    await page.keyboard.press('Control+A')
    if (value) await page.keyboard.type(value)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
}

/**
 * Generates a random EXRAIL-command-shaped word Blocks mode has never heard of — a made-up
 * ALL_CAPS identifier, optionally called with garbage arguments. Blocks mode must never crash
 * on this (see exrail-block-compiler.ts's parseBody() doc comment: any unrecognized line
 * returns `{ ok: false, reason }` instead of throwing or partially compiling), only ever
 * degrade to "can't be edited visually — switch to Raw".
 */
function randomUnknownCommand(): string {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let word = ''
    const len = 6 + Math.floor(Math.random() * 10)
    for (let i = 0; i < len; i++) word += letters[Math.floor(Math.random() * letters.length)]
    const argCount = Math.floor(Math.random() * 3)
    const args = Array.from({ length: argCount }, () => Math.floor(Math.random() * 999)).join(', ')
    return argCount > 0 ? `${word}(${args})` : word
}

test.describe('EXRAIL block canvas', () => {
    test('Strict aliases (on by default): the un-aliased seeded route shows a warning dot in the routes list, which clears once aliased', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)
        const row = page.locator('routes-editor nav[aria-label="Routes"] a').first()
        await expect(row.getByTestId('alias-warning-dot')).toBeVisible()

        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        await setHatAlias(page, 'MAIN_ROUTE')

        await expect(row.getByTestId('alias-warning-dot')).toHaveCount(0)
    })

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

    test('shows an always-visible readonly output pane matching the seeded route body', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        // The pane sits beside the canvas (not behind a Raw toggle) and starts populated from the
        // initial load, not just after the first edit.
        await expect(page.getByTestId('exrail-output-pane')).toBeVisible()
        const outputText = await getOutputPaneText(page)
        expect(outputText).toContain('THROW(200)')
        expect(outputText).toContain('CLOSE(201)')
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

        // Strict aliases is on by default — the seeded route has none yet.
        await setHatAlias(page, 'MAIN_ROUTE')

        // Picking a different known turnout compiles cleanly, never as NaN — the field is a
        // restricted dropdown, not the free-text input a stray/unresolved value could corrupt.
        await pickDropdownOption(page, 'Main Line Junction (200)', 'Yard Entry (201)')

        await page.getByTestId('editor-tab-raw').click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const rawText = await getMonacoContent(page)
        expect(rawText).toContain('THROW(201)')
        expect(rawText).not.toContain('NaN')
    })

    test('output pane updates live when a block field changes, without switching to Raw', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        await expect(page.locator('[data-id="n1"]')).toContainText('Main Line Junction (200)')
        await expect(page.getByTestId('exrail-output-text')).toContainText('THROW(200)')

        // Picking a different turnout is a structural workspace change (BLOCK_CHANGE) — the output
        // pane must recompile from the same _commitNow() path that feeds onBodyChange, without the
        // test ever visiting the Raw tab.
        await pickDropdownOption(page, 'Main Line Junction (200)', 'Yard Entry (201)')

        await expect(page.getByTestId('exrail-output-text')).toContainText('THROW(201)')
        await expect(page.getByTestId('exrail-output-text')).not.toContainText('THROW(200)')
    })

    test('a turnout alias shows up in the turnout-ref dropdown and compiles by name, not NaN', async ({ workspacePage: page }) => {
        // Strict aliases is on by default — give the seeded route one first, before the turnout
        // alias below triggers an auto-normalization pass on this route's body (see
        // _normalizeExistingBlocks() in exrail-block-canvas.ts).
        await openRoutesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        await setHatAlias(page, 'MAIN_ROUTE')

        await openAliasesEditor(page)
        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        await page.waitForTimeout(400)
        await setMonacoContent(page, 'ALIAS(mysidingpoint, 201) // type: Turnout\nALIAS(MAIN_ROUTE, 1) // type: Route')

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
        // Strict aliases is on by default — give the seeded route one first, before the turnout
        // alias below triggers an auto-normalization pass on this route's body (see
        // _normalizeExistingBlocks() in exrail-block-canvas.ts).
        await openRoutesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        await setHatAlias(page, 'MAIN_ROUTE')

        await openAliasesEditor(page)
        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        await page.waitForTimeout(400)
        await setMonacoContent(page, 'ALIAS(mysidingpoint, 201) // type: Turnout\nALIAS(MAIN_ROUTE, 1) // type: Route')

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

    test('output pane reflects the newly selected row after switching sequences', async ({ workspacePage: page }) => {
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
        await expect(page.getByTestId('exrail-output-text')).toContainText('DELAY(500)')

        // reload() reuses the same Blockly instance across row switches (see exrail-block-canvas.ts)
        // rather than a fresh attached()/detaching() cycle — the output pane must be re-derived from
        // that reload too, not just from the initial mount.
        await rows.nth(1).click()
        await expect(page.getByTestId('exrail-output-text')).toContainText('DELAY(1000)')
        await expect(page.getByTestId('exrail-output-text')).not.toContainText('DELAY(500)')
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

    test('a random unknown EXRAIL word disables Blocks mode instead of crashing the canvas', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)

        const unknownWord = randomUnknownCommand()
        const rawButton = page.getByTestId('row-tab-raw')
        await rawButton.click()
        const rowEditor = page.getByTestId('row-body-monaco')
        await expect(rowEditor).toBeVisible()
        const editor = rowEditor.locator('div.monaco-editor')
        await editor.click()
        await page.keyboard.press('Control+A')
        await page.keyboard.type(`ROUTE(1, "Main Line")\n${unknownWord}\nDONE`)
        await page.waitForTimeout(500)

        // Blocks becomes unselectable rather than the app throwing/blank-screening on a word it
        // has no block definition for.
        const blocksButton = page.getByRole('button', { name: 'Blocks' })
        await expect(blocksButton).toBeDisabled()
        await expect(blocksButton).toHaveAttribute('title', /can't be edited visually/)

        // The app itself stays alive and interactive — not just the button's disabled state.
        // Typed text survives untouched (nothing silently discarded it) and normal navigation
        // still works.
        await expect(editor).toContainText(unknownWord)
        await openAliasesEditor(page)
        await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
    })

    test('random unknown words in many shapes never crash Blocks mode, across several routes', async ({ workspacePage: page }) => {
        await openRoutesEditor(page)

        // A spread of shapes a hand-edited file could plausibly contain: a bare unknown word, an
        // unknown word called with args, one nested inside a branch, and one mixed in with real
        // commands — every one of these must degrade to "Raw only", never break the page.
        const bareWord = randomUnknownCommand().replace(/\(.*/, '')
        const shapes = [
            bareWord,
            randomUnknownCommand(),
            `IF(200)\n  ${randomUnknownCommand()}\nENDIF`,
            `THROW(200)\n${randomUnknownCommand()}\nCLOSE(201)`,
        ]

        for (let i = 0; i < shapes.length; i++) {
            const rawButton = page.getByTestId('row-tab-raw')
            // The row may already be showing Raw from a prior iteration (Blocks got disabled) —
            // click it defensively either way.
            if (await rawButton.isVisible()) await rawButton.click()
            const rowEditor = page.getByTestId('row-body-monaco')
            await expect(rowEditor).toBeVisible()
            const editor = rowEditor.locator('div.monaco-editor')
            await editor.click()
            await page.keyboard.press('Control+A')
            await page.keyboard.type(`ROUTE(1, "Main Line")\n${shapes[i]}`)
            await page.waitForTimeout(500)

            const blocksButton = page.getByRole('button', { name: 'Blocks' })
            await expect(blocksButton).toBeDisabled()
            // The page never crashed partway through — the routes list is still there and clickable.
            await expect(page.locator('routes-editor nav[aria-label="Routes"] a').first()).toBeVisible()
        }
    })

    test('an unknown word introduced via the whole-file Raw tab does not corrupt an already-open Blocks canvas', async ({ workspacePage: page }) => {
        // MOCK_ROUTES_H's route parses cleanly, so Blocks mode is open and mounted by default.
        // Editing the same route's body to include a made-up word through the file-level Raw tab
        // (rather than the per-row Raw editor) exercises a different code path — the block canvas
        // stays mounted underneath while the underlying body text changes from outside it.
        await openRoutesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        const unknownWord = randomUnknownCommand()
        await page.getByTestId('editor-tab-raw').click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        await setMonacoContent(page, ['ROUTE(1, "Main Route")', unknownWord, 'DONE'].join('\n'))

        // Switching back to the Visual tab (and reselecting the route, the normal way a user
        // would look at it again) must never crash — either the canvas reflects the new body via
        // its parseError fallback, or it disables Blocks for that row. Either way, no exception.
        await page.getByRole('button', { name: 'Visual', exact: true }).click()
        await page.locator('routes-editor nav[aria-label="Routes"] a').first().click()
        await page.waitForTimeout(300)

        // The app is still responsive: some sane state is showing (either the canvas or the
        // disabled-Blocks Raw fallback), never a blank/broken panel.
        const blocksButton = page.getByRole('button', { name: 'Blocks' })
        await expect(blocksButton).toBeVisible()
        const canvasVisible = await page.locator('.blocklySvg').first().isVisible().catch(() => false)
        const rawVisible = await page.getByTestId('row-body-monaco').isVisible().catch(() => false)
        expect(canvasVisible || rawVisible).toBe(true)
    })

    test('regression: a newly added route does not warn about colliding with its own assigned id', async ({ workspacePage: page }) => {
        // defined.routes (exrail-blockly-blocks.ts's ExrailIdField) is the project's live route
        // list, which includes this very route — so a naive "does anything in there have this
        // id" check always matches the entry's own id. MOCK_ROUTES_H's sole route already sits at
        // id 1, which happens to equal ExrailIdField's own JSON-default value, so
        // _applyHeaderFields() never calls setFieldValue for it and never exercises the bug —
        // a freshly added route (assigned id 2) is required to actually trigger it.
        await openRoutesEditor(page)
        await page.locator('routes-editor button[title="Add new route"]').click()
        await page.locator('routes-editor nav[aria-label="Routes"] a', { hasText: 'New Route' }).click()
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        // The hat block's ID field reactively picks up the new route's real id (2) — wait for
        // that catch-up to actually land before asserting no warning icon appeared, since a
        // check made too early would trivially "pass" whether or not the bug is present.
        await expect(page.locator('.blocklyEditableField[aria-label="Edit number: 2"]')).toBeVisible({ timeout: 10_000 })
        await expect(page.locator('.blocklyWarningIcon')).toHaveCount(0)
    })

    // ── STEALTH/STEALTH_GLOBAL's code field — Monaco popup, not Blockly's inline text box ──

    test.describe('STEALTH code field (Monaco popup editor)', () => {
        async function openStealthEditor(page: import('@playwright/test').Page) {
            await openRoutesEditor(page)
            await page.getByTestId('editor-tab-raw').click()
            await expect(page.locator('div.monaco-editor')).toBeVisible()
            await setMonacoContent(page, ['ROUTE(1, "Main Route")', 'STEALTH(digitalWrite(30, HIGH);)', 'DONE'].join('\n'))

            await page.getByRole('button', { name: 'Visual', exact: true }).click()
            await page.locator('routes-editor nav[aria-label="Routes"] a').first().click()
            await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

            // Strict aliases is on by default — the seeded route has none yet, which would
            // silently block the STEALTH body edits below (see updateRoute()'s strict-aliases
            // gate in routes-editor.ts) while the always-visible output pane (unaffected by that
            // gate) kept showing the edit as if it landed, masking the block.
            await setHatAlias(page, 'MAIN_ROUTE')
        }

        test('the block face shows a one-line collapsed preview, not the raw text box', async ({ workspacePage: page }) => {
            await openStealthEditor(page)
            await expect(page.locator('[data-id="n1"]')).toContainText('digitalWrite(30, HIGH);')
        })

        test('clicking the code field opens a Monaco editor with C++ highlighting, seeded with the current code', async ({ workspacePage: page }) => {
            await openStealthEditor(page)

            await page.locator('[data-id="n1"]').getByRole('button', { name: /^Edit text:/ }).click()
            const popup = page.locator('.blocklyDropDownDiv')
            await expect(popup.locator('div.monaco-editor')).toBeVisible()
            await expect(popup).toContainText('digitalWrite(30, HIGH);')
        })

        test('editing the code and closing the popup updates the compiled STEALTH(...) line', async ({ workspacePage: page }) => {
            await openStealthEditor(page)

            await page.locator('[data-id="n1"]').getByRole('button', { name: /^Edit text:/ }).click()
            const popup = page.locator('.blocklyDropDownDiv')
            const monacoEditor = popup.locator('div.monaco-editor')
            await expect(monacoEditor).toBeVisible()

            await monacoEditor.click()
            await page.keyboard.press('Control+A')
            await page.keyboard.type('digitalWrite(30, LOW); digitalWrite(31, HIGH);')

            // Escape must close the popup (committing the edit) rather than being swallowed by
            // the popup's own keydown handler, which stops every other key from reaching
            // Blockly's block-deletion shortcuts while typing C++. DropDownDiv is a persistent
            // singleton Blockly appends once and reuses (shown/hidden, never removed) — its own
            // Monaco instance disposing (removed from the DOM) is the real signal the popup closed.
            await page.keyboard.press('Escape')
            await expect(popup.locator('div.monaco-editor')).toHaveCount(0)

            await expect(page.locator('[data-id="n1"]')).toContainText('digitalWrite(30, LOW); digitalWrite(31, HIGH);')

            // The block-face text updates synchronously with setValue(), but the workspace
            // change event that recompiles the body (and pushes it out to ConfigEditorState) is
            // fired on a later task (confirmed elsewhere in this codebase — see the big comment
            // on hatCallbacksByWorkspace in exrail-blockly-blocks.ts) — give it a moment to land
            // before reading the raw file, or this reads the pre-commit body.
            await page.waitForTimeout(300)

            await page.getByTestId('editor-tab-raw').click()
            const rawText = await getMonacoContent(page)
            expect(rawText).toContain('STEALTH(digitalWrite(30, LOW); digitalWrite(31, HIGH);)')
        })

        test('is also used by STEALTH_GLOBAL', async ({ workspacePage: page }) => {
            await openRoutesEditor(page)
            await page.getByTestId('editor-tab-raw').click()
            await expect(page.locator('div.monaco-editor')).toBeVisible()
            await setMonacoContent(page, ['ROUTE(1, "Main Route")', 'STEALTH_GLOBAL(int counter = 0;)', 'DONE'].join('\n'))

            await page.getByRole('button', { name: 'Visual', exact: true }).click()
            await page.locator('routes-editor nav[aria-label="Routes"] a').first().click()
            await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

            await expect(page.locator('[data-id="n1"]')).toContainText('int counter = 0;')
            await page.locator('[data-id="n1"]').getByRole('button', { name: /^Edit text:/ }).click()
            await expect(page.locator('.blocklyDropDownDiv div.monaco-editor')).toBeVisible()
        })
    })
})
