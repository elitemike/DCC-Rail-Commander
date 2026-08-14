/**
 * E2E tests: Turnout editor — bidirectional visual ↔ raw editing.
 *
 * Tests that data added/edited/removed from the visual editor is reflected in
 * raw mode and vice-versa, covering the @observable-based sync pipeline.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Turnout Editor"
 */

import { test, expect, MOCK_TURNOUTS_H } from './fixtures'

// ── Helpers ─────────────────────────────────────────────────────────────────

async function openTurnoutEditor(page: import('@playwright/test').Page) {
    await page.getByText('Turnouts', { exact: true }).first().click()
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
    await expect(page.locator('nav[aria-label="Turnouts"]')).toBeVisible()
}

async function openAutomationEditor(page: import('@playwright/test').Page) {
    await page.getByText('Automation', { exact: true }).first().click()
    // automation-editor defaults to its Visual (TrackManager) tab; the Raw
    // Monaco view only mounts after switching tabs.
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('file-editor-panel div.monaco-editor')).toBeVisible()
    await page.waitForTimeout(400)
}

async function getMonacoContent(page: import('@playwright/test').Page): Promise<string> {
    return page.evaluate(() => {
        const editorEl = document.querySelector('div.monaco-editor')
        if (!editorEl) return ''
        const lines = Array.from(editorEl.querySelectorAll('.view-line'))
        if (lines.length === 0) {
            const ta = editorEl.querySelector('textarea.inputarea') as HTMLTextAreaElement | null
            return ta?.value ?? ''
        }
        // Monaco uses non-breaking spaces (\u00a0) in view-line rendering;
        // normalize to regular spaces so string comparisons work as expected.
        return lines.map(l => (l.textContent ?? '').replace(/\u00a0/g, ' ')).join('\n')
    })
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

// Scoped to the visual entry list — a bare page.getByText() can match a
// leftover Monaco syntax-highlight token from the (hidden but still-mounted)
// Raw editor pane, which is a strict-mode violation that's timing-sensitive
// (Monaco doesn't unmount its last-rendered view-lines the instant it's
// hidden) and so flakier on some machines than others.
function turnoutEntry(page: import('@playwright/test').Page, text: string) {
    return page.locator('nav[aria-label="Turnouts"]').getByText(text)
}

async function getDetailTextInput(page: import('@playwright/test').Page, label: string, index = 0) {
    return page
        .locator(`div:has(> label:has-text("${label}")) input[type="text"]`)
        .nth(index)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Turnout Editor', () => {
    // ── Verify initial mock data loaded ─────────────────────────────────────

    test('shows mock turnout entries in visual tab', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)

        // Both turnouts from the mock data should be listed
        await expect(page.getByText('Main Line Junction')).toBeVisible()
        await expect(page.getByText('Yard Entry')).toBeVisible()
        await expect(page.getByText('2 entries')).toBeVisible()
    })

    test('raw tab shows correct SERVO_TURNOUT() macros for mock data', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        await expect(page.locator('div.monaco-editor')).toContainText('SERVO_TURNOUT(200')
        await expect(page.locator('div.monaco-editor')).toContainText('Main Line Junction')
        await expect(page.locator('div.monaco-editor')).toContainText('SERVO_TURNOUT(201')
        await expect(page.locator('div.monaco-editor')).toContainText('Yard Entry')
    })

    // ── Visual → Raw sync ─────────────────────────────────────────────────────

    test('adding entry via visual appears in raw tab', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)

        // Click + to add a new turnout — new entries are always SERVO, so the
        // calibration modal opens immediately; dismiss it to get to the form.
        await page.getByTitle('Add new turnout').click()
        await expect(page.getByRole('dialog').getByText('Calibrate Servo', { exact: true })).toBeVisible()
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

        // The new entry form should open — find and fill the description field
        const descInput = page.locator('label', { hasText: /Description/i })
            .locator('..').locator('input[type="text"]')
        await descInput.clear()
        await descInput.fill('Goods Yard Switch')
        await descInput.blur()

        // Entry should now appear in the list (uses description as display name)
        await expect(page.getByText('Goods Yard Switch')).toBeVisible()

        // Switch to raw — Goods Yard Switch must appear as a SERVO_TURNOUT()
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('Goods Yard Switch')
        await expect(page.locator('div.monaco-editor')).toContainText('SERVO_TURNOUT(')
    })

    test('setting default state to THROWN generates AUTOSTART THROW in myAutomation.h', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)

        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction' }).click()

        const defaultStateSelect = page.locator('#turnout-splitter').getByRole('combobox').nth(1)
        await defaultStateSelect.selectOption('THROWN')

        await openAutomationEditor(page)

        await expect(page.locator('file-editor-panel div.monaco-editor')).toContainText('AUTOSTART')
        await expect(page.locator('file-editor-panel div.monaco-editor')).toContainText('THROW(200)')
    })

    test('setting default state back to CLOSED removes THROW from myAutomation.h', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)

        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction' }).click()

        const defaultStateSelect = page.locator('#turnout-splitter').getByRole('combobox').nth(1)
        await defaultStateSelect.selectOption('THROWN')
        await defaultStateSelect.selectOption('CLOSED')

        await openAutomationEditor(page)

        await expect(page.locator('file-editor-panel div.monaco-editor')).not.toContainText('THROW(200)')
    })

    test('removing entry via visual disappears from raw tab', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)

        // Remove "Yard Entry" (second entry) via the × button
        const entryRow = page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Yard Entry' })
        await entryRow.hover()
        const removeBtn = entryRow.locator('button[title="Remove"]')
        await removeBtn.click()

        // Accept any confirmation dialog
        const deleteBtn = page.getByRole('button', { name: 'Delete' })
        if (await deleteBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await deleteBtn.click()
        }

        // Yard Entry should be gone from the turnout nav list
        const turnoutNav = page.locator('nav[aria-label="Turnouts"]')
        await expect(turnoutNav.getByText('Yard Entry')).not.toBeVisible({ timeout: 5_000 })

        // Switch to raw
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).not.toContainText('Yard Entry')
        await expect(page.locator('div.monaco-editor')).toContainText('Main Line Junction')
    })

    // ── Raw → Visual sync ─────────────────────────────────────────────────────

    test('new entry added in raw appears in visual after switching tab', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        const newContent =
            MOCK_TURNOUTS_H + '\nSERVO_TURNOUT(202, 27, 410, 205, Slow, "Coal Siding")'
        await setMonacoContent(page, newContent)

        await switchToVisual(page)

        await expect(turnoutEntry(page, 'Coal Siding')).toBeVisible({ timeout: 5_000 })
        await expect(page.getByText('3 entries')).toBeVisible()
    })

    test('entry edited in raw updates in visual after switching tab', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        // Change Yard Entry's description to "Engine Shed" and ID to 210
        const editedContent = [
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
            'SERVO_TURNOUT(210, 26, 410, 205, Fast, "Engine Shed")',
        ].join('\n')
        await setMonacoContent(page, editedContent)

        await switchToVisual(page)

        await expect(turnoutEntry(page, 'Engine Shed')).toBeVisible({ timeout: 5_000 })
        await expect(turnoutEntry(page, 'Yard Entry')).not.toBeVisible()
    })

    test('entry removed in raw disappears from visual after switching tab', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        // Keep only Main Line Junction
        const reducedContent = 'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")'
        await setMonacoContent(page, reducedContent)

        await switchToVisual(page)

        await expect(turnoutEntry(page, 'Main Line Junction')).toBeVisible({ timeout: 5_000 })
        await expect(turnoutEntry(page, 'Yard Entry')).not.toBeVisible()
        await expect(page.getByText('1 entries')).toBeVisible()
    })

    // ── Round-trip consistency ────────────────────────────────────────────────

    test('add entry in raw, edit in visual, verify raw again', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        // Add a new turnout in raw
        const withNew = MOCK_TURNOUTS_H + '\nSERVO_TURNOUT(202, 27, 390, 190, Medium, "Water Tower")'
        await setMonacoContent(page, withNew)
        await switchToVisual(page)

        // Water Tower should appear
        await expect(turnoutEntry(page, 'Water Tower')).toBeVisible({ timeout: 5_000 })

        // Click on it to edit, change description
        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Water Tower' }).click()
        const descInput = page.locator('label', { hasText: /Description/i })
            .locator('..').locator('input[type="text"]')
        await descInput.clear()
        await descInput.fill('Water Tower Siding')
        await descInput.blur()

        // Go back to raw and verify
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('Water Tower Siding')
    })

    test('alias from myAliases.h populates in the turnout visual editor', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await switchToRaw(page)

        await setMonacoContent(page, 'ALIAS(YARD_SWITCH, 200) // type: Turnout')

        await openTurnoutEditor(page)
        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction' }).click()

        const aliasInput = await getDetailTextInput(page, 'Alias')
        await expect(aliasInput).toHaveValue('YARD_SWITCH')
    })

    test('editing a turnout alias updates myAliases.h with type metadata', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction' }).click()

        const aliasInput = await getDetailTextInput(page, 'Alias')
        await aliasInput.fill('JUNCTION_MAIN')
        await aliasInput.blur()

        await openAliasesEditor(page)
        await switchToRaw(page)

        await expect(page.locator('div.monaco-editor')).toContainText('ALIAS(JUNCTION_MAIN, 200) // type: Turnout')
    })

    test('can create a cross-type turnout ID conflict used by alias validation', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction' }).click()

        const idInput = page
            .locator('div:has(> label:has-text("ID")) input[type="number"]')
            .first()
        await idInput.fill('3')
        await idInput.blur()

        await expect(page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction (3)' })).toBeVisible()
    })

    test('allows alias creation when target ID is shared across object types', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction' }).click()

        // Create ambiguity first: turnout ID 3 collides with roster ID 3.
        const idInput = page
            .locator('div:has(> label:has-text("ID")) input[type="number"]')
            .first()
        await idInput.fill('3')
        await idInput.blur()
        await expect(page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction (3)' })).toBeVisible()

        const aliasInput = await getDetailTextInput(page, 'Alias')
        await aliasInput.fill('AMBIG_ALIAS')
        await aliasInput.blur()

        // Shared IDs are now valid because alias usage is context-driven.
        await openAliasesEditor(page)
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('ALIAS(AMBIG_ALIAS, 3) // type: Turnout')
    })

    test('deleting a turnout alias in the aliases editor clears the alias field in the turnout editor', async ({ workspacePage: page }) => {
        // Set up alias for turnout 200 via the aliases editor raw view
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, 'ALIAS(YARD_SWITCH, 200) // type: Turnout')

        // Open turnout editor, select the turnout with the alias, verify it shows
        await openTurnoutEditor(page)
        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction' }).click()
        const aliasInput = await getDetailTextInput(page, 'Alias')
        await expect(aliasInput).toHaveValue('YARD_SWITCH')

        // Navigate to aliases editor, switch to visual and delete YARD_SWITCH
        await openAliasesEditor(page)
        await page.getByRole('button', { name: 'Visual' }).click()
        // Confirm the alias row is rendered (1 entry shown)
        await expect(page.locator('aliases-editor').getByText('1 entries')).toBeVisible()
        // Click Delete on the only alias row (we set exactly one)
        await page.locator('aliases-editor').getByRole('button', { name: 'Delete' }).first().click()
        await expect(page.getByText('No aliases')).toBeVisible({ timeout: 3_000 })

        // Return to turnout editor and select the same turnout
        await openTurnoutEditor(page)
        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction' }).click()

        // Alias field must now be empty — deletion propagated via IObserverLocator
        const refreshedAliasInput = await getDetailTextInput(page, 'Alias')
        await expect(refreshedAliasInput).toHaveValue('')
    })

    test('an existing alias is selectable from the alias dropdown, not just typeable', async ({ workspacePage: page }) => {
        // Give turnout 201 (Yard Entry) an alias so it shows up as an option
        // while editing turnout 200 (Main Line Junction).
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, 'ALIAS(YARD_ENTRY_SW, 201) // type: Turnout')

        await openTurnoutEditor(page)
        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction' }).click()

        const aliasInput = await getDetailTextInput(page, 'Alias')
        await aliasInput.click()
        // Open the ComboBox popup (the dropdown icon Syncfusion renders next to the input)
        // and pick the suggestion, rather than typing the alias name by hand.
        await aliasInput.locator('xpath=following-sibling::span[contains(@class, "e-ddl-icon")]').click()
        // Syncfusion's popup fades in — clicking an option before the open animation
        // settles is swallowed as a click-outside (closes the popup without selecting).
        await page.waitForTimeout(300)
        await page.getByRole('option', { name: 'YARD_ENTRY_SW', exact: true }).click()

        await expect(aliasInput).toHaveValue('YARD_ENTRY_SW')

        // Since alias names must stay unique, syncAliasForId reassigns the
        // existing ALIAS entry's value from 201 to 200 rather than duplicating it.
        await openAliasesEditor(page)
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('ALIAS(YARD_ENTRY_SW, 200) // type: Turnout')
    })

    test('rejects committing a turnout ID that collides with another turnout in the visual editor', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction' }).click()

        const idInput = page
            .locator('div:has(> label:has-text("ID")) input[type="number"]')
            .first()
        await idInput.fill('201')
        await idInput.blur()

        await expect(page.getByText('Turnout ID 201 is already used by "Yard Entry (201)"')).toBeVisible()
        // The ID field is not persisted — the sidebar entry keeps its original ID.
        await expect(page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction (200)' })).toBeVisible()
    })

    // ── Invalid lines: commenting + toast ────────────────────────────────────

    test('invalid SERVO_TURNOUT line is commented out when switching to visual', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        // Type a malformed SERVO_TURNOUT call (non-integer id)
        await setMonacoContent(page,
            'SERVO_TURNOUT(bad input here)\n' +
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
        )

        await switchToVisual(page)

        // Switch back to raw — the bad line must now be commented out
        await switchToRaw(page)
        const content = await getMonacoContent(page)
        expect(content).toContain('// [INVALID]')
        expect(content).toContain('SERVO_TURNOUT(bad input here)')
    })

    test('toast notification appears when invalid turnout line is commented out', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        await setMonacoContent(page,
            'SERVO_TURNOUT(bad input here)\n' +
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
        )

        await switchToVisual(page)

        const toast = page.locator('.e-toast-container .e-toast').first()
        await expect(toast).toBeVisible({ timeout: 5_000 })
        await expect(toast).toContainText('Invalid Lines Commented Out')
        await expect(toast).toContainText('commented out to prevent data loss')
    })

    test('commented-out invalid turnout line persists after multiple raw ↔ visual toggles', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        // First pass: introduce a bad line alongside a good one
        await setMonacoContent(page,
            'SERVO_TURNOUT(bad input here)\n' +
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
        )
        await switchToVisual(page)

        // Second toggle: raw → visual
        await switchToRaw(page)
        await switchToVisual(page)

        // Third toggle: verify [INVALID] is still present
        await switchToRaw(page)
        const content = await getMonacoContent(page)
        expect(content).toContain('// [INVALID]')
        expect(content).toContain('SERVO_TURNOUT(bad input here)')
    })

    test('toast does NOT fire a second time for turnouts when toggling again with no new invalid lines', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        await setMonacoContent(page,
            'SERVO_TURNOUT(bad input here)\n' +
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
        )
        await switchToVisual(page)

        const toast = page.locator('.e-toast-container .e-toast').first()
        await expect(toast).toBeVisible({ timeout: 5_000 })

        // Dismiss the toast
        await toast.locator('.e-toast-close-icon').click()
        await expect(toast).not.toBeVisible({ timeout: 3_000 })

        // Second toggle — no new invalid lines, toast must NOT reappear
        await switchToRaw(page)
        await switchToVisual(page)
        await page.waitForTimeout(500)
        await expect(page.locator('.e-toast-container .e-toast')).not.toBeVisible()
    })

    // ── DCC (TURNOUT) type ───────────────────────────────────────────────────

    test('valid TURNOUT (DCC) round-trips raw → visual → raw', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        const content = [
            MOCK_TURNOUTS_H,
            'TURNOUT(300, 10, 2, "DCC Switch 1")',
        ].join('\n')
        await setMonacoContent(page, content)
        await switchToVisual(page)

        await expect(turnoutEntry(page, 'DCC Switch 1')).toBeVisible({ timeout: 5_000 })
        await expect(page.getByText('3 entries')).toBeVisible()

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('TURNOUT(300')
        await expect(page.locator('div.monaco-editor')).toContainText('DCC Switch 1')
    })

    test('invalid TURNOUT (DCC) line is commented out when switching to visual', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        await setMonacoContent(page,
            'TURNOUT(bad, input)\n' +
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
        )
        await switchToVisual(page)

        await switchToRaw(page)
        const content = await getMonacoContent(page)
        expect(content).toContain('// [INVALID]')
        expect(content).toContain('TURNOUT(bad, input)')
    })

    test('toast fires for invalid TURNOUT (DCC) line', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        await setMonacoContent(page,
            'TURNOUT(bad, input)\n' +
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
        )
        await switchToVisual(page)

        const toast = page.locator('.e-toast-container .e-toast').first()
        await expect(toast).toBeVisible({ timeout: 5_000 })
        await expect(toast).toContainText('Invalid Lines Commented Out')
    })

    // ── PIN_TURNOUT type ─────────────────────────────────────────────────────

    test('valid PIN_TURNOUT round-trips raw → visual → raw', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        const content = [
            MOCK_TURNOUTS_H,
            'PIN_TURNOUT(400, 52, "Pin Switch A")',
        ].join('\n')
        await setMonacoContent(page, content)
        await switchToVisual(page)

        await expect(turnoutEntry(page, 'Pin Switch A')).toBeVisible({ timeout: 5_000 })
        await expect(page.getByText('3 entries')).toBeVisible()

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('PIN_TURNOUT(400')
        await expect(page.locator('div.monaco-editor')).toContainText('Pin Switch A')
    })

    test('invalid PIN_TURNOUT line is commented out when switching to visual', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        await setMonacoContent(page,
            'PIN_TURNOUT(bad input)\n' +
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
        )
        await switchToVisual(page)

        await switchToRaw(page)
        const content = await getMonacoContent(page)
        expect(content).toContain('// [INVALID]')
        expect(content).toContain('PIN_TURNOUT(bad input)')
    })

    test('toast fires for invalid PIN_TURNOUT line', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        await setMonacoContent(page,
            'PIN_TURNOUT(bad input)\n' +
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
        )
        await switchToVisual(page)

        const toast = page.locator('.e-toast-container .e-toast').first()
        await expect(toast).toBeVisible({ timeout: 5_000 })
        await expect(toast).toContainText('Invalid Lines Commented Out')
    })

    // ── Mixed types ──────────────────────────────────────────────────────────

    test('all three turnout types coexist and round-trip correctly', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)
        await switchToRaw(page)

        const content = [
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Servo Switch")',
            'TURNOUT(300, 10, 2, "DCC Switch")',
            'PIN_TURNOUT(400, 52, "Pin Switch")',
        ].join('\n')
        await setMonacoContent(page, content)
        await switchToVisual(page)

        await expect(turnoutEntry(page, 'Servo Switch')).toBeVisible({ timeout: 5_000 })
        await expect(turnoutEntry(page, 'DCC Switch')).toBeVisible()
        await expect(turnoutEntry(page, 'Pin Switch')).toBeVisible()
        await expect(page.getByText('3 entries')).toBeVisible()

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('SERVO_TURNOUT(200')
        await expect(page.locator('div.monaco-editor')).toContainText('TURNOUT(300')
        await expect(page.locator('div.monaco-editor')).toContainText('PIN_TURNOUT(400')
    })
})

// ── Regression: switching sections after a Raw/Visual toggle must fully unmount ──

test('switching to another Configuration section after toggling Raw/Visual leaves no stale turnout-editor mounted', async ({ workspacePage: page }) => {
    // turnout-editor.html previously gated its Visual-tab pane (which hosts a
    // Syncfusion Splitter widget) behind if.bind on the Raw/Visual toggle —
    // CLAUDE.md documents that SF-widget-containing tabs must use CSS-class
    // toggling instead, because if.bind destroys/recreates the element out from
    // under the widget instance. That could corrupt the widget and, if its
    // destroy() then threw during a later section switch, abort Aurelia's
    // teardown of turnout-editor entirely — leaving it stuck in the DOM
    // underneath whatever section was switched to.
    const consoleErrors: string[] = []
    page.on('pageerror', (err) => consoleErrors.push(err.message))

    await openTurnoutEditor(page)
    await page.getByText('Main Line Junction', { exact: false }).click()
    await switchToRaw(page)
    await switchToVisual(page)
    await switchToRaw(page)
    await switchToVisual(page)

    await page.getByText('Roster', { exact: true }).first().click()
    await expect(page.locator('roster-editor')).toBeVisible()

    await expect(page.locator('turnout-editor')).toHaveCount(0)
    expect(consoleErrors).toEqual([])
})

test('the Splitter layout still renders after leaving Turnouts and coming back', async ({ workspacePage: page }) => {
    // Aurelia's if.bind caches and reuses the turnout-editor component instance
    // across hide/show cycles by default (cache: true), so attached() runs again
    // on the SAME instance rather than a fresh one — any guard flag set by
    // detaching() that isn't reset in attached() stays set forever after the
    // first visit, silently skipping the deferred Splitter (re)creation on every
    // later visit and leaving the turnout list/detail panes stacked instead of
    // in their proper resizable side-by-side layout.
    await openTurnoutEditor(page)
    await expect(page.locator('#turnout-splitter.e-splitter')).toBeVisible()

    await page.getByText('Roster', { exact: true }).first().click()
    await expect(page.locator('roster-editor')).toBeVisible()

    await openTurnoutEditor(page)
    await expect(page.locator('#turnout-splitter.e-splitter')).toBeVisible()
})
