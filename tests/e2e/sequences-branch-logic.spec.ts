/**
 * E2E tests: EXRAIL branch logic (IF/IFNOT/IFCLOSED/IFTHROWN ... ELSE ... ENDIF)
 * inside the Sequences editor's block canvas.
 *
 * Sequences and Routes share the same exrail-block-compiler.ts / exrail-block-canvas.ts
 * machinery (see exrail-block-canvas.spec.ts, which only exercises it through the Routes
 * editor) — these tests drive it through the Sequences editor instead, and specifically
 * target the branch constructs that no other spec touches: parsing a branch's then/else
 * legs, nested branches, a DONE cap block nested inside a leg, editing a branch's
 * condition, and the parser's rejection of a dangling ELSE / unclosed IF (falls back to
 * Raw mode rather than corrupting the body).
 *
 * The canvas is Google Blockly (see exrail-block-canvas.ts). Blocks loaded from a parsed
 * body get deterministic ids matching their ParsedGraph node ids, assigned depth-first —
 * a branch block gets the next id, then its whole THEN chain, then its whole ELSE chain
 * (see exrail-block-compiler.ts's emitChain()) — so each test's seeded body has a fixed,
 * predictable id per block, called out at each test.
 *
 * Bodies are seeded via the Raw (Monaco) tab rather than palette drag-and-drop — dragging
 * from Blockly's toolbox flyout isn't exercised anywhere else in this test suite, so
 * seeding raw EXRAIL text and letting it parse into Blocks mode is the established,
 * reliable pattern (see exrail-block-canvas.spec.ts).
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Sequences branch logic"
 */

import { test, expect } from './fixtures'

// ── Helpers ─────────────────────────────────────────────────────────────────

async function openSequencesEditor(page: import('@playwright/test').Page) {
    await page.getByText('Sequences', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function switchToRaw(page: import('@playwright/test').Page) {
    await page.getByTestId('editor-tab-raw').click()
    await expect(page.getByTestId('file-body-monaco').locator('div.monaco-editor')).toBeVisible()
    // Allow rawText binding to propagate to Monaco after visual processing
    await page.waitForTimeout(400)
}

async function switchToVisual(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Visual' }).click()
}

async function setMonacoContent(page: import('@playwright/test').Page, text: string) {
    const editor = page.getByTestId('file-body-monaco').locator('div.monaco-editor')
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    // Typing line-by-line with individual Enter keypresses (the pattern every other
    // e2e spec uses) silently glues lines together when the line just typed is an
    // EXRAIL keyword like ELSE/ENDIF that Monaco's IntelliSense (see
    // exrail-completions.ts) offers as a suggestion — Enter accepts the suggestion
    // instead of inserting a newline. insertText delivers the whole string as one
    // paste-like operation, which bypasses per-keystroke suggestion handling entirely.
    await page.keyboard.insertText(text)
    await page.waitForTimeout(500)
}

async function getMonacoContent(page: import('@playwright/test').Page): Promise<string> {
    return page.evaluate(() => {
        const editorEl = document.querySelector('[data-testid="file-body-monaco"] div.monaco-editor')
        const lines = Array.from(editorEl?.querySelectorAll('.view-line') ?? [])
        return lines.map((l) => (l.textContent ?? '').replace(/ /g, ' ')).join('\n')
    })
}

/**
 * Reads the per-row Raw Monaco editor's content specifically — needed once a row falls back
 * to Raw mode, because the whole-file Raw tab's `<monaco-editor>` stays mounted (class-toggled
 * hidden, not if.bind — see sequences-editor.html) even while on the Visual tab, so an
 * unscoped `div.monaco-editor` locator would be ambiguous between the two live instances.
 */
async function getRowMonacoContent(page: import('@playwright/test').Page): Promise<string> {
    return page.evaluate(() => {
        const editorEl = document.querySelector('[data-testid="row-body-monaco"] div.monaco-editor')
        const lines = Array.from(editorEl?.querySelectorAll('.view-line') ?? [])
        return lines.map((l) => (l.textContent ?? '').replace(/ /g, ' ')).join('\n')
    })
}

function sequenceListItems(page: import('@playwright/test').Page) {
    return page.locator('sequences-editor nav[aria-label="Sequences"] a')
}

/** Seeds mySequences.h (a full file, including the SEQUENCE(...)/DONE wrapper) via the Raw tab, then opens that sequence's detail pane in Visual mode. */
async function seedAndSelectSequence(page: import('@playwright/test').Page, fileText: string) {
    await openSequencesEditor(page)
    await switchToRaw(page)
    await setMonacoContent(page, fileText)
    await switchToVisual(page)
    await sequenceListItems(page).first().click()
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
 * field, not a plain `<input>`. Needed because strict aliases is on by default: these tests seed
 * a sequence directly via raw text (no alias), so any genuine Blocks-mode structural edit is
 * blocked until one exists.
 */
async function setHatAlias(page: import('@playwright/test').Page, value: string) {
    await page.getByRole('button', { name: /^Edit text:/ }).click()
    await page.keyboard.press('Control+A')
    if (value) await page.keyboard.type(value)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Sequences branch logic', () => {
    test('a plain sequence\'s trailing DONE renders as a real block and disappears when deleted', async ({ workspacePage: page }) => {
        await seedAndSelectSequence(page, [
            'SEQUENCE(1)',
            'THROW(200)',
            'DELAY(60000)',
            'CLOSE(201)',
            'DONE',
        ].join('\n'))

        const blocksButton = page.getByRole('button', { name: 'Blocks' })
        await expect(blocksButton).toBeEnabled()
        await blocksButton.click()
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        // Strict aliases is on by default — this sequence was seeded via raw text, no alias yet.
        await setHatAlias(page, 'PLAIN_SEQUENCE')

        // DONE is real body content now (parseRoutesFromFile/parseSequencesFromFile keep it
        // instead of stripping it) — it gets an ordinary node id (n4) in the same depth-first
        // numbering as every other block, not a synthetic/fixed marker.
        await expect(page.locator('[data-id="n1"]')).toContainText('Throw turnout')
        await expect(page.locator('[data-id="n2"]')).toContainText('Delay')
        await expect(page.locator('[data-id="n3"]')).toContainText('Close turnout')
        await expect(page.locator('[data-id="n4"]')).toContainText('Done')

        // A real, ordinary block: deleting it removes it from the compiled body, same as
        // deleting THROW/DELAY/CLOSE would — no special-casing keeps it around.
        await page.locator('[data-id="n4"]').click()
        await page.keyboard.press('Delete')
        await expect(page.locator('[data-id="n4"]')).toHaveCount(0)
        await expect(page.locator('[data-id="n1"]')).toContainText('Throw turnout')
        await expect(page.locator('[data-id="n3"]')).toContainText('Close turnout')

        await switchToRaw(page)
        const raw = await getMonacoContent(page)
        expect(raw).toContain('THROW(200)')
        expect(raw).toContain('CLOSE(201)')
        expect(raw.split('\n').filter((l) => l.trim() === 'DONE')).toHaveLength(0)
    })

    test('an IF/ELSE/ENDIF body loads into Blocks mode with a branch node and both legs', async ({ workspacePage: page }) => {
        await seedAndSelectSequence(page, [
            'SEQUENCE(1) // Branch Test',
            'IFCLOSED(200)',
            'THROW(201)',
            'ELSE',
            'CLOSE(201)',
            'ENDIF',
            'DONE',
        ].join('\n'))

        const blocksButton = page.getByRole('button', { name: 'Blocks' })
        await expect(blocksButton).toBeEnabled()
        await blocksButton.click()

        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        // n1 = IFCLOSED(200), n2 = THROW(201) [THEN leg], n3 = CLOSE(201) [ELSE leg] —
        // ids assigned depth-first: the branch itself, then its whole THEN chain, then ELSE.
        await expect(page.locator('[data-id="n1"]')).toContainText('If turnout closed')
        await expect(page.locator('[data-id="n1"]')).toContainText('Main Line Junction (200)')
        await expect(page.locator('[data-id="n2"]')).toContainText('Throw turnout')
        await expect(page.locator('[data-id="n2"]')).toContainText('Yard Entry (201)')
        await expect(page.locator('[data-id="n3"]')).toContainText('Close turnout')
        await expect(page.locator('[data-id="n3"]')).toContainText('Yard Entry (201)')
    })

    test('editing the branch condition\'s turnout recompiles IF(...) while leaving both legs intact', async ({ workspacePage: page }) => {
        await seedAndSelectSequence(page, [
            'SEQUENCE(1) // Branch Test',
            'IFCLOSED(200)',
            'THROW(201)',
            'ELSE',
            'CLOSE(201)',
            'ENDIF',
            'DONE',
        ].join('\n'))

        await expect(page.getByRole('button', { name: 'Blocks' })).toBeEnabled()
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        // Strict aliases is on by default — this sequence was seeded via raw text, no alias yet.
        await setHatAlias(page, 'BRANCH_TEST')

        // n1 = IFCLOSED(200), the branch's own condition field.
        await pickDropdownOption(page, 'Main Line Junction (200)', 'Yard Entry (201)')

        await switchToRaw(page)
        const raw = await getMonacoContent(page)
        expect(raw).toContain('IFCLOSED(201)')
        expect(raw).not.toContain('IFCLOSED(200)')
        expect(raw).toContain('THROW(201)')
        expect(raw).toContain('ELSE')
        expect(raw).toContain('CLOSE(201)')
        expect(raw).toContain('ENDIF')
    })

    test('a DONE cap block nested inside a branch leg parses and renders alongside the branch', async ({ workspacePage: page }) => {
        await seedAndSelectSequence(page, [
            'SEQUENCE(1) // Nested Done',
            'IFTHROWN(200)',
            // Indented, like compileBody's own output: parseSequencesFromFile's
            // DONE-terminator scan only matches a line that is *exactly* "DONE"
            // (no leading whitespace) — an unindented nested DONE would be mistaken
            // for the file's own terminator and truncate the body early.
            '  THROW(200)',
            '  DONE',
            'ELSE',
            '  CLOSE(200)',
            'ENDIF',
            'DONE',
        ].join('\n'))

        await expect(page.getByRole('button', { name: 'Blocks' })).toBeEnabled()
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        // n1 = IFTHROWN(200), n2 = THROW(200) [THEN], n3 = DONE (chained after n2, still
        // inside THEN), n4 = CLOSE(200) [ELSE].
        await expect(page.locator('[data-id="n1"]')).toContainText('If turnout thrown')
        await expect(page.locator('[data-id="n2"]')).toContainText('Throw turnout')
        await expect(page.locator('[data-id="n3"]')).toContainText('Done')
        await expect(page.locator('[data-id="n4"]')).toContainText('Close turnout')

        await switchToRaw(page)
        const raw = await getMonacoContent(page)
        expect(raw).toContain('IFTHROWN(200)')
        expect(raw).toContain('THROW(200)')
        expect(raw).toContain('ELSE')
        expect(raw).toContain('CLOSE(200)')
        expect(raw).toContain('ENDIF')
    })

    test('a nested IF inside a THEN leg (branch within a branch) parses and renders all four nodes', async ({ workspacePage: page }) => {
        await seedAndSelectSequence(page, [
            'SEQUENCE(1) // Nested Branch',
            'IFCLOSED(200)',
            'IFTHROWN(201)',
            'THROW(200)',
            'ENDIF',
            'ELSE',
            'CLOSE(200)',
            'ENDIF',
            'DONE',
        ].join('\n'))

        await expect(page.getByRole('button', { name: 'Blocks' })).toBeEnabled()
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        // n1 = IFCLOSED(200), n2 = IFTHROWN(201) [THEN of n1], n3 = THROW(200) [THEN of n2],
        // n4 = CLOSE(200) [ELSE of n1].
        await expect(page.locator('[data-id="n1"]')).toContainText('If turnout closed')
        await expect(page.locator('[data-id="n2"]')).toContainText('If turnout thrown')
        await expect(page.locator('[data-id="n3"]')).toContainText('Throw turnout')
        await expect(page.locator('[data-id="n4"]')).toContainText('Close turnout')

        await switchToRaw(page)
        const raw = await getMonacoContent(page)
        expect(raw).toContain('IFCLOSED(200)')
        expect(raw).toContain('IFTHROWN(201)')
        expect(raw).toContain('THROW(200)')
        expect(raw).toContain('CLOSE(200)')
        // One ENDIF closes the nested IFTHROWN, a second closes the outer IFCLOSED.
        expect((raw.match(/ENDIF/g) ?? []).length).toBe(2)
    })

    test('a dangling ELSE with no matching IF falls back to Raw mode instead of corrupting the body', async ({ workspacePage: page }) => {
        await seedAndSelectSequence(page, [
            'SEQUENCE(1) // Dangling Else',
            'ELSE',
            'THROW(200)',
            'DONE',
        ].join('\n'))

        const blocksButton = page.getByRole('button', { name: 'Blocks' })
        await expect(blocksButton).toBeDisabled()
        await expect(blocksButton).toHaveAttribute('title', "This body can't be edited visually yet — switch to Raw.")

        const rowEditor = page.getByTestId('row-body-monaco')
        await expect(rowEditor).toBeVisible()
        await expect.poll(() => getRowMonacoContent(page)).toMatch(/ELSE/)
    })

    test('an unclosed IF (missing ENDIF) also falls back to Raw mode', async ({ workspacePage: page }) => {
        await seedAndSelectSequence(page, [
            'SEQUENCE(1) // Missing Endif',
            'IF(1)',
            'THROW(200)',
            'DONE',
        ].join('\n'))

        await expect(page.getByRole('button', { name: 'Blocks' })).toBeDisabled()
        const rowEditor = page.getByTestId('row-body-monaco')
        await expect(rowEditor).toBeVisible()
        await expect.poll(() => getRowMonacoContent(page)).toMatch(/IF\(1\)/)
    })
})
