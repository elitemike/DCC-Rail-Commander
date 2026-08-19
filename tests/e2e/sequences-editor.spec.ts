/**
 * E2E tests: Sequences editor — friendly name/description on SEQUENCE() entries,
 * plus myAliases.h alias support (edited directly on the Blocks tab's hat block —
 * see exrail-blockly-blocks.ts's ExrailAliasField/ExrailIdField — not a sidebar
 * control).
 *
 * SEQUENCE(id) has no description argument in EXRAIL itself, so the friendly
 * name is stored as a trailing `// comment` on the SEQUENCE(id) line (same
 * convention as roster's `defineFriendlyName` and aliases' `// type: X`) —
 * see parseSequencesFromFile/serializeSequencesToFile in myAutomationParser.ts.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Sequences Editor"
 */

import { test, expect } from './fixtures'

// ── Helpers ─────────────────────────────────────────────────────────────────

async function openSequencesEditor(page: import('@playwright/test').Page) {
    await page.getByText('Sequences', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function openAliasesEditor(page: import('@playwright/test').Page) {
    await page.getByText('Aliases', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function switchToRaw(page: import('@playwright/test').Page) {
    await page.getByTestId('editor-tab-raw').click()
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
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
        await page.keyboard.type(lines[i])
        if (i < lines.length - 1) await page.keyboard.press('Enter')
    }
    await page.waitForTimeout(500)
}

function sequenceListItems(page: import('@playwright/test').Page) {
    return page.locator('sequences-editor nav[aria-label="Sequences"] a')
}

function descriptionInput(page: import('@playwright/test').Page) {
    return page.locator('sequences-editor input[aria-label="Sequence description"]')
}

async function addSequence(page: import('@playwright/test').Page) {
    await page.locator('sequences-editor button[title="Add new sequence"]').click()
}

/**
 * The hat block's ALIAS field (see exrail-blockly-blocks.ts's ExrailAliasField) —
 * a Blockly field, not a plain `<input>`, so it's targeted by its accessible role/
 * label the same way exrail-block-canvas.spec.ts's pickDropdownOption() targets
 * ref-kind dropdowns. Blockly renders its own inline `<input>` as a floating
 * widget only while the field is being edited, so reading the current value (via
 * `hatAliasFieldValue`) reads the field's aria-label instead of that transient
 * widget, and setting a new value opens the widget, types, then commits with
 * Enter (blur/Tab were tried and don't commit it — Enter does).
 */
function hatAliasField(page: import('@playwright/test').Page) {
    return page.getByRole('button', { name: /^Edit text:/ })
}

async function hatAliasFieldValue(page: import('@playwright/test').Page): Promise<string> {
    const label = await hatAliasField(page).getAttribute('aria-label')
    const value = (label ?? '').replace(/^Edit text:\s*/, '')
    return value === 'empty' ? '' : value
}

/** The hat block's ID field, alongside ALIAS above — read only, never driven, since these tests
 *  don't exercise id-editing. myRoutes.h's seeded Route(1) already occupies id 1 in the shared
 *  ROUTE/AUTOMATION/SEQUENCE namespace, so a freshly added sequence gets id 2, not 1 — read the
 *  actual assigned id here rather than assuming 1. */
async function hatIdFieldValue(page: import('@playwright/test').Page): Promise<number> {
    const label = await page.getByRole('button', { name: /^Edit number:/ }).getAttribute('aria-label')
    return Number((label ?? '').replace(/^Edit number:\s*/, ''))
}

async function setHatAlias(page: import('@playwright/test').Page, value: string) {
    await hatAliasField(page).click()
    await page.keyboard.press('Control+A')
    if (value) await page.keyboard.type(value)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Sequences Editor', () => {
    test('starts empty with a placeholder message', async ({ workspacePage: page }) => {
        await openSequencesEditor(page)
        await expect(page.getByText('No sequences.').first()).toBeVisible()
        await expect(page.getByText('0 entries')).toBeVisible()
    })

    // ── Visual → Raw sync ─────────────────────────────────────────────────────

    test('setting a description on a new sequence appears in raw as a trailing comment', async ({ workspacePage: page }) => {
        await openSequencesEditor(page)
        await addSequence(page)

        const descInput = descriptionInput(page)
        await descInput.fill('Yard shunt')
        await descInput.blur()

        await expect(sequenceListItems(page).first()).toContainText('Yard shunt')

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('SEQUENCE(1) // Yard shunt')
    })

    test('editing a sequence description updates the sidebar label and raw', async ({ workspacePage: page }) => {
        await openSequencesEditor(page)
        await addSequence(page)

        const descInput = descriptionInput(page)
        await descInput.fill('Loop A')
        await descInput.blur()
        await expect(sequenceListItems(page).first()).toContainText('Loop A (1)')

        await descInput.fill('Loop A Renamed')
        await descInput.blur()
        await expect(sequenceListItems(page).first()).toContainText('Loop A Renamed (1)')

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('SEQUENCE(1) // Loop A Renamed')
        await expect(page.locator('div.monaco-editor')).not.toContainText('Loop A (1)')
    })

    test('a sequence with no description falls back to "Sequence id" and omits the comment', async ({ workspacePage: page }) => {
        await openSequencesEditor(page)
        await addSequence(page)

        // addSequence() defaults to a placeholder description — clear it to
        // exercise the true no-description fallback.
        const descInput = descriptionInput(page)
        await descInput.fill('')
        await descInput.blur()

        await expect(sequenceListItems(page).first()).toContainText('Sequence 1')

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('SEQUENCE(1)')
        await expect(page.locator('div.monaco-editor')).not.toContainText('SEQUENCE(1) //')
    })

    test('removing a sequence with a description removes it from raw', async ({ workspacePage: page }) => {
        await openSequencesEditor(page)
        await addSequence(page)

        const descInput = descriptionInput(page)
        await descInput.fill('Removable Sequence')
        await descInput.blur()

        await sequenceListItems(page).first().locator('button[title="Remove"]').click()

        await expect(page.getByText('No sequences.').first()).toBeVisible()
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).not.toContainText('Removable Sequence')
    })

    // ── Raw → Visual sync ─────────────────────────────────────────────────────

    test('sequences with a trailing comment in raw show the description in visual', async ({ workspacePage: page }) => {
        await openSequencesEditor(page)
        await switchToRaw(page)

        await setMonacoContent(page, [
            'SEQUENCE(1) // Platform release',
            'DONE',
            '',
            'SEQUENCE(2)',
            'DONE',
        ].join('\n'))

        await switchToVisual(page)

        await expect(page.getByText('2 entries')).toBeVisible()
        const items = sequenceListItems(page)
        await expect(items.nth(0)).toContainText('Platform release (1)')
        await expect(items.nth(1)).toContainText('Sequence 2')

        await items.nth(0).click()
        await expect(descriptionInput(page)).toHaveValue('Platform release')
    })

    // ── Alias support ────────────────────────────────────────────────────────

    test('setting an alias on a sequence writes ALIAS(...) with type: Sequence to myAliases.h', async ({ workspacePage: page }) => {
        await openSequencesEditor(page)
        await addSequence(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        // The workspacePage fixture's myRoutes.h already occupies id 1 in the shared
        // ROUTE/AUTOMATION/SEQUENCE namespace, so this freshly added sequence gets id 2.
        const id = await hatIdFieldValue(page)

        await setHatAlias(page, 'YARD_SHUNT')

        await openAliasesEditor(page)
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText(`ALIAS(YARD_SHUNT, ${id}) // type: Sequence`)
    })

    test('an alias already defined in myAliases.h populates in the sequence visual editor', async ({ workspacePage: page }) => {
        await openSequencesEditor(page)
        await addSequence(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        const id = await hatIdFieldValue(page)

        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, `ALIAS(LOOP_A, ${id}) // type: Sequence`)

        await openSequencesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        expect(await hatAliasFieldValue(page)).toBe('LOOP_A')
    })

    test('deleting a sequence alias in the aliases editor clears the alias field in the sequences editor', async ({ workspacePage: page }) => {
        await openSequencesEditor(page)
        await addSequence(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        const id = await hatIdFieldValue(page)

        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, `ALIAS(LOOP_A, ${id}) // type: Sequence`)

        await openSequencesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        expect(await hatAliasFieldValue(page)).toBe('LOOP_A')

        await openAliasesEditor(page)
        await switchToVisual(page)
        await expect(page.locator('aliases-editor').getByText('1 entries')).toBeVisible()
        await page.locator('aliases-editor').getByRole('button', { name: 'Delete' }).first().click()
        await expect(page.getByText('No aliases')).toBeVisible({ timeout: 3_000 })

        await openSequencesEditor(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        expect(await hatAliasFieldValue(page)).toBe('')
    })

    test('assigning a sequence alias name already used by a different-typed object shows an error toast', async ({ workspacePage: page }) => {
        // A same-type (Sequence ↔ Sequence) name reuse is a legitimate reassignment
        // — a real conflict only occurs when the name is already scoped to a
        // *different* alias type, since ConfigEditorState.syncAliasForId keeps
        // aliases type-scoped. Use the workspacePage fixture's seeded turnout
        // (id 200, "Main Line Junction") for that other type.
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, 'ALIAS(SHARED_NAME, 200) // type: Turnout')

        await openSequencesEditor(page)
        await addSequence(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        await setHatAlias(page, 'SHARED_NAME')

        const toast = page.locator('.e-toast-container .e-toast').first()
        await expect(toast).toBeVisible({ timeout: 5_000 })
        await expect(toast).toContainText('Alias Error')
        await expect(toast).toContainText('SHARED_NAME')

        // The original (Turnout) alias must be untouched, and no Sequence alias created.
        await openAliasesEditor(page)
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('ALIAS(SHARED_NAME, 200) // type: Turnout')
        await expect(page.locator('div.monaco-editor')).not.toContainText('type: Sequence')
    })
})
