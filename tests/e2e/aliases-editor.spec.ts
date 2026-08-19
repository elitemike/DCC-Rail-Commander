/**
 * E2E tests: Aliases editor — grouping by inferred/declared alias type and
 * alphabetical sorting by alias name within each group, plus the new-alias
 * form's Type -> ID dropdown pair (the ID picker only ever offers real
 * object IDs, and drops an ID once it already has an alias of that type,
 * enforcing one alias per ID).
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Aliases Editor"
 */

import { test, expect } from './fixtures'

// ── Helpers ─────────────────────────────────────────────────────────────────

async function openAliasesEditor(page: import('@playwright/test').Page) {
    await page.getByText('Aliases', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function switchToRaw(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
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

function groupHeaders(page: import('@playwright/test').Page) {
    return page.locator('aliases-editor [data-testid="alias-group-header"]')
}

function aliasRows(page: import('@playwright/test').Page) {
    return page.locator('aliases-editor [data-testid="alias-row"]')
}

function nameInputs(page: import('@playwright/test').Page) {
    return aliasRows(page).locator('input[placeholder="NAME"]')
}

/** Opens an SF DropDownList by the data-testid on its underlying input, then picks an option by its visible text. Same pattern as pickFromDropdown() in throttle.spec.ts (including the settle waits — clicking the popup item too early on its open/close animation makes the click a no-op). */
async function selectSfDropdown(page: import('@playwright/test').Page, inputTestId: string, optionText: string) {
    await page.locator('.e-ddl', { has: page.getByTestId(inputTestId) }).click()
    await page.waitForTimeout(200)
    await page.locator('li.e-list-item', { hasText: optionText }).first().click()
    await page.waitForTimeout(200)
}

/** Fills and submits the aliases editor's new-alias mini form: Name text input, Type dropdown, ID dropdown (labelled by the target object's name/description), then Add Alias. */
async function addAlias(page: import('@playwright/test').Page, name: string, type: string, idLabel: string) {
    const form = page.locator('aliases-editor [data-testid="new-alias-form"]')
    await form.locator('input[placeholder="NAME"]').fill(name)
    await selectSfDropdown(page, 'new-alias-type', type)
    await selectSfDropdown(page, 'new-alias-id', idLabel)
    await form.getByRole('button', { name: 'Add Alias' }).click()
}

// workspacePage seeds two turnouts (ids 200/201) and roster locos 3/5 — used
// below as the "real" object IDs aliases must reference.

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Aliases Editor', () => {
    test('groups aliases by type and sorts within each group by name', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, [
            'ALIAS(ZEBRA_TURNOUT, 200) // type: Turnout',
            'ALIAS(APPLE_TURNOUT, 201) // type: Turnout',
            'ALIAS(LOCO_ALIAS, 3)',
        ].join('\n'))
        await switchToVisual(page)

        await expect(page.getByText('3 entries')).toBeVisible()

        // Alphabetical by group label: "Roster" sorts before "Turnout".
        const headers = groupHeaders(page)
        await expect(headers).toHaveCount(2)
        await expect(headers.nth(0)).toContainText('Roster')
        await expect(headers.nth(0)).toContainText('(1)')
        await expect(headers.nth(1)).toContainText('Turnout')
        await expect(headers.nth(1)).toContainText('(2)')

        // Within the Turnout group, entries are sorted alphabetically by name:
        // APPLE_TURNOUT before ZEBRA_TURNOUT.
        const names = nameInputs(page)
        await expect(names).toHaveCount(3)
        await expect(names.nth(0)).toHaveValue('LOCO_ALIAS')
        await expect(names.nth(1)).toHaveValue('APPLE_TURNOUT')
        await expect(names.nth(2)).toHaveValue('ZEBRA_TURNOUT')
    })

    test('editing an alias name to reorder it within its group re-sorts on the next visual render', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, [
            'ALIAS(MIDDLE, 200) // type: Turnout',
            'ALIAS(ALPHA, 201) // type: Turnout',
        ].join('\n'))
        await switchToVisual(page)

        let names = nameInputs(page)
        await expect(names.nth(0)).toHaveValue('ALPHA')
        await expect(names.nth(1)).toHaveValue('MIDDLE')

        // Rename ALPHA to ZULU so it should now sort after MIDDLE.
        await names.nth(0).fill('ZULU')
        await names.nth(0).blur()

        names = nameInputs(page)
        await expect(names.nth(0)).toHaveValue('MIDDLE')
        await expect(names.nth(1)).toHaveValue('ZULU')
    })

    test('aliases with no declared type are grouped by their inferred object type', async ({ workspacePage: page }) => {
        // No `// type:` comment, so the group label is inferred from which seeded
        // object (roster loco 3, turnout 200) the numeric value matches.
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, [
            'ALIAS(LOCO_ALIAS, 3)',
            'ALIAS(TURNOUT_ALIAS, 200)',
        ].join('\n'))
        await switchToVisual(page)

        const headers = groupHeaders(page)
        await expect(headers).toHaveCount(2)
        await expect(headers.nth(0)).toContainText('Roster')
        await expect(headers.nth(1)).toContainText('Turnout')
    })

    test('removing the last alias in a group removes that group heading', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, [
            'ALIAS(ONLY_TURNOUT, 200) // type: Turnout',
            'ALIAS(ONLY_ROSTER, 3)',
        ].join('\n'))
        await switchToVisual(page)

        await expect(groupHeaders(page)).toHaveCount(2)
        await expect(groupHeaders(page).first()).toContainText('Roster')

        // The Roster group sorts first, so its single row is the first alias row.
        await aliasRows(page).first().locator('button[title="Delete"]').click()

        await expect(groupHeaders(page)).toHaveCount(1)
        await expect(groupHeaders(page).first()).toContainText('Turnout')
    })

    // ── Type -> ID dropdown: only real object IDs are offered, one alias per ID ─

    test('the ID picker only offers real object IDs, labelled by name/description', async ({ workspacePage: page }) => {
        // workspacePage seeds turnouts 200 ("Main Line Junction") and 201 ("Yard Entry").
        await openAliasesEditor(page)
        await selectSfDropdown(page, 'new-alias-type', 'Turnout')
        await page.locator('.e-ddl', { has: page.getByTestId('new-alias-id') }).click()

        await expect(page.locator('li.e-list-item', { hasText: 'Main Line Junction' })).toBeVisible()
        await expect(page.locator('li.e-list-item', { hasText: 'Yard Entry' })).toBeVisible()
    })

    test('clicking Add Alias without selecting an ID is rejected with an error and not saved', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        const form = page.locator('aliases-editor [data-testid="new-alias-form"]')
        await form.locator('input[placeholder="NAME"]').fill('MY_ALIAS')
        await form.getByRole('button', { name: 'Add Alias' }).click()

        await expect(page.locator('aliases-editor').getByText(/Select a Roster ID/)).toBeVisible()
        await expect(page.getByText('0 entries')).toBeVisible()

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).not.toContainText('MY_ALIAS')
    })

    test('selecting a type and ID and adding saves the alias successfully', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await addAlias(page, 'GOOD_TARGET', 'Turnout', 'Main Line Junction')

        await expect(page.getByText('1 entries')).toBeVisible()

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('ALIAS(GOOD_TARGET, 200)')
    })

    test('an object ID that already has an alias is not offered again for the same type', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await addAlias(page, 'FIRST_JUNCTION', 'Turnout', 'Main Line Junction')
        await expect(page.getByText('1 entries')).toBeVisible()

        const form = page.locator('aliases-editor [data-testid="new-alias-form"]')
        await form.locator('input[placeholder="NAME"]').fill('SECOND_JUNCTION')
        await selectSfDropdown(page, 'new-alias-type', 'Turnout')
        await page.locator('.e-ddl', { has: page.getByTestId('new-alias-id') }).click()

        // "Main Line Junction" (turnout 200) is already aliased — only one alias per ID.
        await expect(page.locator('li.e-list-item', { hasText: 'Main Line Junction' })).toHaveCount(0)
        await expect(page.locator('li.e-list-item', { hasText: 'Yard Entry' })).toBeVisible()
    })
})
