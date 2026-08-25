/**
 * E2E tests: Sensors editor — bidirectional visual ↔ raw editing, plus
 * myAliases.h alias support (each row's alias-picker custom element).
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Sensors Editor"
 */

import { test, expect } from './fixtures'

// ── Helpers ─────────────────────────────────────────────────────────────────

async function openSensorsEditor(page: import('@playwright/test').Page) {
    await page.getByText('Sensors', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function openAliasesEditor(page: import('@playwright/test').Page) {
    await page.getByText('Aliases', { exact: true }).first().click()
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
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
        await page.keyboard.type(lines[i])
        if (i < lines.length - 1) await page.keyboard.press('Enter')
    }
    await page.waitForTimeout(500)
}

function sensorRows(page: import('@playwright/test').Page) {
    return page.locator('sensors-editor .flex.items-end.gap-3')
}

async function addSensor(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Add Sensor' }).click()
}

// Sensor rows render description as an `<input value.two-way>`, not static
// text, so `getByText` never matches it — assert against the field's value.
async function expectRowDescription(row: import('@playwright/test').Locator, description: string) {
    await expect(row.locator('input[placeholder="Description"]')).toHaveValue(description, { timeout: 5_000 })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Sensors Editor', () => {
    test('starts empty with a placeholder message', async ({ workspacePage: page }) => {
        await openSensorsEditor(page)
        await expect(page.getByText('No sensors yet')).toBeVisible()
        await expect(page.getByText('0 entries')).toBeVisible()
    })

    // ── Visual → Raw sync ─────────────────────────────────────────────────────

    test('adding a sensor via visual appears in raw tab', async ({ workspacePage: page }) => {
        await openSensorsEditor(page)
        await addSensor(page)

        const row = sensorRows(page).first()

        // Strict aliases is on by default — a freshly-added sensor has no alias yet,
        // so give it one before any other field edit can commit.
        const aliasInput = row.locator('alias-picker input')
        await aliasInput.fill('BLOCK_DETECTOR_1')
        await aliasInput.blur()

        const descInput = row.locator('input[placeholder="Description"]')
        await descInput.fill('Block Detector 1')
        await descInput.blur()

        await expect(page.getByText('1 entries')).toBeVisible()

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('SENSOR(')
        await expect(page.locator('div.monaco-editor')).toContainText('Block Detector 1')
    })

    test('editing a sensor ID/pin/description updates raw', async ({ workspacePage: page }) => {
        await openSensorsEditor(page)
        await addSensor(page)

        const row = sensorRows(page).first()

        // Strict aliases is on by default — a freshly-added sensor has no alias yet,
        // so give it one before any other field edit can commit.
        const aliasInput = row.locator('alias-picker input')
        await aliasInput.fill('PLATFORM_OCCUPANCY')
        await aliasInput.blur()

        const idInput = row.locator('input[type="number"]').first()
        await idInput.fill('7')
        await idInput.blur()

        const descInput = row.locator('input[placeholder="Description"]')
        await descInput.fill('Platform Occupancy')
        await descInput.blur()

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('SENSOR(7')
        await expect(page.locator('div.monaco-editor')).toContainText('Platform Occupancy')
    })

    test('removing a sensor removes it from raw', async ({ workspacePage: page }) => {
        await openSensorsEditor(page)
        await addSensor(page)

        const row = sensorRows(page).first()
        const descInput = row.locator('input[placeholder="Description"]')
        await descInput.fill('Removable Sensor')
        await descInput.blur()

        await row.locator('button[title="Remove sensor"]').click()

        await expect(page.getByText('No sensors yet')).toBeVisible()
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).not.toContainText('Removable Sensor')
    })

    // ── Raw → Visual sync ─────────────────────────────────────────────────────

    test('sensors typed in raw appear in visual after switching tab', async ({ workspacePage: page }) => {
        await openSensorsEditor(page)
        await switchToRaw(page)

        await setMonacoContent(page, [
            'SENSOR(1, 30, "Occupancy A")',
            'SENSOR(2, 31, "Occupancy B")',
        ].join('\n'))

        await switchToVisual(page)

        await expect(page.getByText('2 entries')).toBeVisible()
        const rows = sensorRows(page)
        await expectRowDescription(rows.nth(0), 'Occupancy A')
        await expectRowDescription(rows.nth(1), 'Occupancy B')
    })

    // ── Alias support ────────────────────────────────────────────────────────

    test('setting an alias on a sensor writes ALIAS(...) with type: Sensor to myAliases.h', async ({ workspacePage: page }) => {
        await openSensorsEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, 'SENSOR(1, 30, "Occupancy A")')
        await switchToVisual(page)
        await expectRowDescription(sensorRows(page).first(), 'Occupancy A')

        const row = sensorRows(page).first()
        const aliasInput = row.locator('alias-picker input')
        await aliasInput.fill('BLOCK_1')
        await aliasInput.blur()

        await openAliasesEditor(page)
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('ALIAS(BLOCK_1, 1) // type: Sensor')
    })

    test('an alias already defined in myAliases.h populates in the sensor visual editor', async ({ workspacePage: page }) => {
        await openSensorsEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, 'SENSOR(1, 30, "Occupancy A")')
        await switchToVisual(page)
        await expectRowDescription(sensorRows(page).first(), 'Occupancy A')

        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, 'ALIAS(BLOCK_A, 1) // type: Sensor')

        await openSensorsEditor(page)
        const row = sensorRows(page).first()
        await expect(row.locator('alias-picker input')).toHaveValue('BLOCK_A')
    })

    test('renaming a sensor ID carries its alias to the new ID', async ({ workspacePage: page }) => {
        await openSensorsEditor(page)
        await addSensor(page)

        const row = sensorRows(page).first()
        const aliasInput = row.locator('alias-picker input')
        await aliasInput.fill('BLOCK_1')
        await aliasInput.blur()
        await expect(aliasInput).toHaveValue('BLOCK_1')

        const idInput = row.locator('input[type="number"]').first()
        await idInput.focus()
        await idInput.fill('42')
        await idInput.blur()

        await expect(row.locator('alias-picker input')).toHaveValue('BLOCK_1')

        await openAliasesEditor(page)
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('ALIAS(BLOCK_1, 42) // type: Sensor')
        await expect(page.locator('div.monaco-editor')).not.toContainText('ALIAS(BLOCK_1, 1)')
    })

    test('deleting a sensor alias in the aliases editor clears the alias field in the sensors editor', async ({ workspacePage: page }) => {
        await openSensorsEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, 'SENSOR(1, 30, "Occupancy A")')
        await switchToVisual(page)
        await expectRowDescription(sensorRows(page).first(), 'Occupancy A')

        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, 'ALIAS(BLOCK_A, 1) // type: Sensor')

        await openSensorsEditor(page)
        const row = sensorRows(page).first()
        await expect(row.locator('alias-picker input')).toHaveValue('BLOCK_A')

        await openAliasesEditor(page)
        await switchToVisual(page)
        await expect(page.locator('aliases-editor').getByText('1 entries')).toBeVisible()
        await page.locator('aliases-editor').getByRole('button', { name: 'Delete' }).first().click()
        await expect(page.getByText('No aliases')).toBeVisible({ timeout: 3_000 })

        await openSensorsEditor(page)
        await expect(sensorRows(page).first().locator('alias-picker input')).toHaveValue('')
    })

    test('typing an alias name already used by another sensor reassigns it, since the field is freeform not a dropdown', async ({ workspacePage: page }) => {
        await openSensorsEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, [
            'SENSOR(1, 30, "Occupancy A")',
            'SENSOR(2, 31, "Occupancy B")',
        ].join('\n'))
        await switchToVisual(page)
        await expectRowDescription(sensorRows(page).first(), 'Occupancy A')

        // Give sensor 2 an alias.
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, 'ALIAS(OCC_B, 2) // type: Sensor')

        await openSensorsEditor(page)
        const firstRow = sensorRows(page).first()
        const aliasInput = firstRow.locator('alias-picker input')
        await aliasInput.click()
        await aliasInput.fill('OCC_B')
        await aliasInput.blur()

        await expect(aliasInput).toHaveValue('OCC_B')

        // Alias names are unique, so typing an existing name here reassigns it from sensor 2 to sensor 1.
        await openAliasesEditor(page)
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('ALIAS(OCC_B, 1) // type: Sensor')
    })

    test('assigning an alias name already used by a different-typed object shows an error toast', async ({ workspacePage: page }) => {
        // A same-type (Sensor ↔ Sensor) name reuse is a legitimate reassignment
        // (see the dropdown-selection test above) — a real conflict only occurs
        // when the name is already scoped to a *different* alias type, since
        // ConfigEditorState.syncAliasForId keeps aliases type-scoped. Use the
        // workspacePage fixture's seeded turnout (id 200, "Main Line Junction")
        // for that other type.
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, 'ALIAS(SHARED_NAME, 200) // type: Turnout')

        await openSensorsEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, 'SENSOR(1, 30, "Occupancy A")')
        await switchToVisual(page)
        await expectRowDescription(sensorRows(page).first(), 'Occupancy A')

        const aliasInput = sensorRows(page).first().locator('alias-picker input')
        await aliasInput.click()
        await aliasInput.fill('SHARED_NAME')
        await aliasInput.blur()

        const toast = page.locator('.e-toast-container .e-toast').first()
        await expect(toast).toBeVisible({ timeout: 5_000 })
        await expect(toast).toContainText('Alias Error')
        await expect(toast).toContainText('SHARED_NAME')

        // The original (Turnout) alias must be untouched, and no Sensor alias created.
        await openAliasesEditor(page)
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('ALIAS(SHARED_NAME, 200) // type: Turnout')
        await expect(page.locator('div.monaco-editor')).not.toContainText('type: Sensor')
    })
})
