/**
 * E2E tests: EXRAIL branch logic (IF/IFNOT/IFCLOSED/IFTHROWN ... ELSE ... ENDIF)
 * inside the Sequences editor's block canvas.
 *
 * Sequences and Routes share the same exrail-block-compiler.ts / exrail-block-canvas.ts
 * machinery (see exrail-block-canvas.spec.ts, which only exercises it through the Routes
 * editor) — these tests drive it through the Sequences editor instead, and specifically
 * target the branch (Diamond-shaped IF/IFNOT/IFCLOSED/IFTHROWN) constructs that no
 * existing spec touches: parsing a branch's then/else legs, nested branches, a DONE cap
 * block nested inside a leg, editing a branch's condition, and the parser's rejection of
 * a dangling ELSE / unclosed IF (falls back to Text mode rather than corrupting the body).
 *
 * Bodies are seeded via the Raw (Monaco) tab rather than palette drag-and-drop — dragging
 * onto the Syncfusion Diagram's SVG canvas isn't exercised anywhere else in this test
 * suite, so seeding raw EXRAIL text and letting it parse into Blocks mode is the
 * established, reliable pattern (see exrail-block-canvas.spec.ts).
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
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
    // Allow rawText binding to propagate to Monaco after visual processing
    await page.waitForTimeout(400)
}

async function switchToVisual(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Visual' }).click()
}

async function setMonacoContent(page: import('@playwright/test').Page, text: string) {
    const editor = page.locator('div.monaco-editor').first()
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
        const editorEl = document.querySelector('div.monaco-editor')
        const lines = Array.from(editorEl?.querySelectorAll('.view-line') ?? [])
        return lines.map((l) => (l.textContent ?? '').replace(/ /g, ' ')).join('\n')
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

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Sequences branch logic', () => {
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

        await expect(page.locator('.e-diagram').first()).toBeVisible({ timeout: 10_000 })
        await expect(page.getByText('If turnout closed (200)', { exact: true })).toBeVisible()
        await expect(page.getByText('Throw turnout (201)', { exact: true })).toBeVisible()
        await expect(page.getByText('Close turnout (201)', { exact: true })).toBeVisible()

        // The file's own auto-appended trailing DONE is represented by the synthetic
        // terminal marker trailing the branch node (a branch is never itself a cap block).
        await expect(page.locator('.e-diagram').getByText('Done', { exact: true })).toBeVisible()
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
        await expect(page.locator('.e-diagram').first()).toBeVisible({ timeout: 10_000 })

        await page.getByText('If turnout closed (200)', { exact: true }).click({ force: true })
        const select = page.locator('exrail-block-canvas select')
        await expect(select).toBeVisible()
        await select.selectOption({ label: 'Yard Entry (201)' })

        await switchToRaw(page)
        const raw = await getMonacoContent(page)
        expect(raw).toContain('IFCLOSED(201)')
        expect(raw).not.toContain('IFCLOSED(200)')
        expect(raw).toContain('THROW(201)')
        expect(raw).toContain('ELSE')
        expect(raw).toContain('CLOSE(201)')
        expect(raw).toContain('ENDIF')
    })

    test('a DONE cap block nested inside a branch leg parses and renders alongside the synthetic trailing Done', async ({ workspacePage: page }) => {
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
        await expect(page.locator('.e-diagram').first()).toBeVisible({ timeout: 10_000 })
        await expect(page.getByText('If turnout thrown (200)', { exact: true })).toBeVisible()
        await expect(page.getByText('Throw turnout (200)', { exact: true })).toBeVisible()
        await expect(page.getByText('Close turnout (200)', { exact: true })).toBeVisible()

        // Two "Done" nodes: the real cap block ending the then-leg, plus the synthetic
        // marker trailing the branch itself (top-level tail — a branch is never a cap block).
        await expect(page.locator('.e-diagram').getByText('Done', { exact: true })).toHaveCount(2)

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
        await expect(page.locator('.e-diagram').first()).toBeVisible({ timeout: 10_000 })
        await expect(page.getByText('If turnout closed (200)', { exact: true })).toBeVisible()
        await expect(page.getByText('If turnout thrown (201)', { exact: true })).toBeVisible()
        await expect(page.getByText('Throw turnout (200)', { exact: true })).toBeVisible()
        await expect(page.getByText('Close turnout (200)', { exact: true })).toBeVisible()

        await switchToRaw(page)
        const raw = await getMonacoContent(page)
        expect(raw).toContain('IFCLOSED(200)')
        expect(raw).toContain('IFTHROWN(201)')
        expect(raw).toContain('THROW(200)')
        expect(raw).toContain('CLOSE(200)')
        // One ENDIF closes the nested IFTHROWN, a second closes the outer IFCLOSED.
        expect((raw.match(/ENDIF/g) ?? []).length).toBe(2)
    })

    test('a dangling ELSE with no matching IF falls back to Text mode instead of corrupting the body', async ({ workspacePage: page }) => {
        await seedAndSelectSequence(page, [
            'SEQUENCE(1) // Dangling Else',
            'ELSE',
            'THROW(200)',
            'DONE',
        ].join('\n'))

        const blocksButton = page.getByRole('button', { name: 'Blocks' })
        await expect(blocksButton).toBeDisabled()
        await expect(blocksButton).toHaveAttribute('title', "This body can't be edited visually yet — switch to Text.")

        const textarea = page.locator('textarea[placeholder="Sequence body"]')
        await expect(textarea).toBeVisible()
        await expect(textarea).toHaveValue(/ELSE/)
    })

    test('an unclosed IF (missing ENDIF) also falls back to Text mode', async ({ workspacePage: page }) => {
        await seedAndSelectSequence(page, [
            'SEQUENCE(1) // Missing Endif',
            'IF(1)',
            'THROW(200)',
            'DONE',
        ].join('\n'))

        await expect(page.getByRole('button', { name: 'Blocks' })).toBeDisabled()
        const textarea = page.locator('textarea[placeholder="Sequence body"]')
        await expect(textarea).toBeVisible()
        await expect(textarea).toHaveValue(/IF\(1\)/)
    })
})
