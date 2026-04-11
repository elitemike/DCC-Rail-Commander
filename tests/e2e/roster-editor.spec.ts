/**
 * E2E tests: Roster editor — bidirectional visual ↔ raw editing.
 *
 * Tests that data added/edited/removed from the visual editor is reflected in
 * raw mode and vice-versa, covering the @observable-based sync pipeline.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Roster Editor"
 */

import { test, expect, MOCK_ROSTER_H } from './fixtures'

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Open the Roster editor in the workspace by clicking the "Roster" sidebar tab.
 */
async function openRosterEditor(page: import('@playwright/test').Page) {
    await page.getByText('Roster', { exact: true }).first().click()
    // Wait for the Visual/Raw tab strip to appear
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function openAliasesEditor(page: import('@playwright/test').Page) {
    await page.getByText('Aliases', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

/**
 * Switch to the Raw tab inside the roster editor.
 */
async function switchToRaw(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
    // Allow rawText binding to propagate to Monaco after visual processing
    await page.waitForTimeout(400)
}

/**
 * Switch to the Visual tab inside the roster editor.
 */
async function switchToVisual(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Visual' }).click()
    // Wait for the TreeView to appear (replaced the old nav list after the TreeView migration)
    await expect(page.locator('#roster-treeview')).toBeVisible()
}

/**
 * Replace the full content of the Monaco editor with `text`.
 * Uses Ctrl+A then type to overwrite.
 */
async function setMonacoContent(page: import('@playwright/test').Page, text: string) {
    const editor = page.locator('div.monaco-editor').first()
    await editor.click()
    // Select all and delete existing content
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    // Type new content line by line (handle newlines as Enter)
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
        await page.keyboard.type(lines[i])
        if (i < lines.length - 1) await page.keyboard.press('Enter')
    }
    // Wait for Monaco's debounce to fire (300ms) + a little buffer
    await page.waitForTimeout(500)
}

/**
 * Get the current raw text in the Monaco editor.
 */
async function getMonacoContent(page: import('@playwright/test').Page): Promise<string> {
    return page.evaluate(() => {
        const editorEl = document.querySelector('div.monaco-editor')
        if (!editorEl) return ''
        // Read each view line text
        const lines = Array.from(editorEl.querySelectorAll('.view-line'))
        if (lines.length === 0) {
            // Fallback: try the textarea
            const ta = editorEl.querySelector('textarea.inputarea') as HTMLTextAreaElement | null
            return ta?.value ?? ''
        }
        // Monaco uses non-breaking spaces (\u00a0) in view-line rendering;
        // normalize to regular spaces so string comparisons work as expected.
        return lines.map(l => (l.textContent ?? '').replace(/\u00a0/g, ' ')).join('\n')
    })
}

async function getDetailTextInput(page: import('@playwright/test').Page, label: string, index = 0) {
    return page
        .locator(`div:has(> label:has-text("${label}")) input[type="text"]`)
        .nth(index)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Roster Editor', () => {
    // ── Verify initial mock data loaded ─────────────────────────────────────

    test('shows mock roster entries in visual tab', async ({ workspacePage: page }) => {
        await openRosterEditor(page)

        // Thomas and Percy were in the mock myRoster.h
        await expect(page.getByText('Thomas')).toBeVisible()
        await expect(page.getByText('Percy')).toBeVisible()
        await expect(page.getByText('2 entries')).toBeVisible()
    })

    test('raw tab shows correct ROSTER() macros for mock data', async ({ workspacePage: page }) => {
        await openRosterEditor(page)
        await switchToRaw(page)

        // Both initial entries should appear in the raw text
        await expect(page.locator('div.monaco-editor')).toContainText('ROSTER(3')
        await expect(page.locator('div.monaco-editor')).toContainText('Thomas')
        await expect(page.locator('div.monaco-editor')).toContainText('ROSTER(5')
        await expect(page.locator('div.monaco-editor')).toContainText('Percy')
    })

    // ── Visual → Raw sync ─────────────────────────────────────────────────────

    test('adding entry via visual appears in raw tab', async ({ workspacePage: page }) => {
        await openRosterEditor(page)

        // Click + to add a new entry
        await page.getByTitle('Add new roster entry').click()

        // Wait for the detail panel to open (DCC Address spinbutton appears)
        await expect(page.locator('input[type="number"]').first()).toBeVisible({ timeout: 5_000 })

        // Edit the name field — label text is "Name", input is the sibling text input
        const nameInput = page.locator('label:has-text("Name") ~ input[type="text"], label:has-text("Name") + input[type="text"]')
            .or(page.locator('div:has(> label:has-text("Name")) input[type="text"]'))
        await nameInput.first().clear()
        await nameInput.first().fill('Gordon')
        await nameInput.first().blur()

        // Edit the DCC address
        const addrInput = page.locator('input[type="number"]').first()
        await addrInput.fill('7')
        await addrInput.blur()

        // Entry should now appear in the tree
        await expect(page.locator('#roster-treeview').getByText('Gordon')).toBeVisible()

        // Switch to raw — Gordon must appear as a ROSTER() macro
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('Gordon')
        await expect(page.locator('div.monaco-editor')).toContainText('ROSTER(7')
    })

    test('removing entry via visual disappears from raw tab', async ({ workspacePage: page }) => {
        await openRosterEditor(page)

        // Remove Thomas (first entry) via context menu → Delete
        const thomasRow = page.locator('#roster-treeview li').filter({ hasText: 'Thomas' }).first()
        await thomasRow.locator('.e-fullrow').click({ button: 'right' })
        await page.locator('.e-contextmenu li').filter({ hasText: 'Delete' }).click()

        // ConfirmDialog appears as an Aurelia dialog overlay — click "Delete".
        // The dialog handler on the page fixture auto-accepts window.confirm() fallback.
        const deleteBtn = page.getByRole('button', { name: 'Delete' })
        if (await deleteBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await deleteBtn.click()
        }

        // Thomas should be gone from the tree
        await expect(page.locator('#roster-treeview').getByText('Thomas')).not.toBeVisible({ timeout: 5_000 })
        await expect(page.locator('#roster-treeview').getByText('Percy')).toBeVisible()

        // Switch to raw — Thomas must be gone
        await switchToRaw(page)
        const content = await getMonacoContent(page)
        expect(content).not.toContain('Thomas')
        expect(content).toContain('Percy')
    })

    // ── Raw → Visual sync ─────────────────────────────────────────────────────

    test('new entry added in raw appears in visual after switching tab', async ({ workspacePage: page }) => {
        await openRosterEditor(page)
        await switchToRaw(page)

        // Append a new ROSTER entry to the raw content
        const newContent = MOCK_ROSTER_H + '\nROSTER(10, "Gordon", "LIGHT/HORN")'
        await setMonacoContent(page, newContent)

        // Switch back to visual
        await switchToVisual(page)

        // Gordon should now appear in the visual entry list
        await expect(page.locator('#roster-treeview').getByText('Gordon')).toBeVisible({ timeout: 5_000 })
        await expect(page.getByText('3 entries')).toBeVisible()
    })

    test('entry edited in raw updates in visual after switching tab', async ({ workspacePage: page }) => {
        await openRosterEditor(page)
        await switchToRaw(page)

        // Change Percy's name to "Bertie" and DCC address to 15
        const editedContent = [
            'ROSTER(3, "Thomas", "LIGHT/HORN/*WHISTLE/BELL")',
            'ROSTER(15, "Bertie", "LIGHT/HORN")',
        ].join('\n')
        await setMonacoContent(page, editedContent)

        // Switch back to visual
        await switchToVisual(page)

        // Bertie should be present, Percy should be gone
        await expect(page.locator('#roster-treeview').getByText('Bertie')).toBeVisible({ timeout: 5_000 })
        await expect(page.locator('#roster-treeview').getByText('Percy')).not.toBeVisible()
        await expect(page.locator('#roster-treeview').getByText('15')).toBeVisible()
    })

    test('entry removed in raw disappears from visual after switching tab', async ({ workspacePage: page }) => {
        await openRosterEditor(page)
        await switchToRaw(page)

        // Keep only Thomas, remove Percy
        const reducedContent = 'ROSTER(3, "Thomas", "LIGHT/HORN/*WHISTLE/BELL")'
        await setMonacoContent(page, reducedContent)

        // Switch back to visual
        await switchToVisual(page)

        // Only Thomas should remain
        await expect(page.locator('#roster-treeview').getByText('Thomas')).toBeVisible({ timeout: 5_000 })
        await expect(page.locator('#roster-treeview').getByText('Percy')).not.toBeVisible()
        await expect(page.getByText('1 entries')).toBeVisible()
    })

    // ── Round-trip consistency ────────────────────────────────────────────────

    test('add entry in raw, edit in visual, verify raw again', async ({ workspacePage: page }) => {
        await openRosterEditor(page)
        await switchToRaw(page)

        // Add Gordon in raw
        const withGordon = MOCK_ROSTER_H + '\nROSTER(10, "Gordon", "")'
        await setMonacoContent(page, withGordon)
        await switchToVisual(page)

        // Gordon should be in visual
        await expect(page.locator('#roster-treeview').getByText('Gordon')).toBeVisible({ timeout: 5_000 })

        // Edit Gordon's name to "Gordon the Big Engine" via visual
        await page.locator('#roster-treeview li').filter({ hasText: 'Gordon' }).first().locator('.e-fullrow').click()
        const nameInput = page.locator('label', { hasText: 'Name' }).locator('..').locator('input[type="text"]')
        await nameInput.clear()
        await nameInput.fill('Gordon the Big Engine')
        await nameInput.blur()

        // Switch to raw and verify the change
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('Gordon the Big Engine')
    })

    test('preserves empty function tokens across visual round-trip', async ({ workspacePage: page }) => {
        await openRosterEditor(page)
        await switchToRaw(page)

        const line = 'ROSTER(611, "N&W #611", "Headlight/Bell/Whistle/*Short Whistle/Steam Release///Dimmer/Mute")'
        await setMonacoContent(page, line)

        // Switch to visual (parses) then back to raw (serializes) and ensure
        // the empty tokens (///) and trailing 'Mute' are preserved.
        await switchToVisual(page)
        await switchToRaw(page)
        const content = await getMonacoContent(page)
        expect(content).toContain('Steam Release///Dimmer/Mute')
        expect(content).toContain('Mute')
    })

    test('alias from myAliases.h populates in the roster visual editor', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await switchToRaw(page)

        await setMonacoContent(page, '#define THOMAS_ALIAS "3" // type: Roster')

        await openRosterEditor(page)
        await page.locator('#roster-treeview li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()

        const aliasInput = await getDetailTextInput(page, 'Alias')
        await expect(aliasInput).toHaveValue('THOMAS_ALIAS')
    })

    test('editing a roster alias updates myAliases.h with type metadata', async ({ workspacePage: page }) => {
        await openRosterEditor(page)
        await page.locator('#roster-treeview li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()

        const aliasInput = await getDetailTextInput(page, 'Alias')
        await aliasInput.fill('BLUE_ENGINE')
        await aliasInput.blur()

        await openAliasesEditor(page)
        await switchToRaw(page)

        await expect(page.locator('div.monaco-editor')).toContainText('#define BLUE_ENGINE "3" // type: Roster')
    })

    test('shows a warning when roster ID is reused by another object type', async ({ workspacePage: page }) => {
        await openRosterEditor(page)
        await page.locator('#roster-treeview li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()

        const dccInput = page
            .locator('div:has(> label:has-text("DCC Address")) input[type="number"]')
            .first()
        await dccInput.fill('200')
        await dccInput.blur()

        await expect(page.getByText('ID 200 is also used by Turnout objects.')).toBeVisible()
    })

    // ── Invalid lines: commenting + toast ────────────────────────────────────

    test('invalid ROSTER line is commented out when switching to visual', async ({ workspacePage: page }) => {
        await openRosterEditor(page)
        await switchToRaw(page)

        // Type a malformed ROSTER call (missing quotes around name)
        await setMonacoContent(page, 'ROSTER(bad input here)\nROSTER(3, "Thomas", "LIGHT")')

        await switchToVisual(page)

        // Switch back to raw — the bad line must now be commented out
        await switchToRaw(page)
        const content = await getMonacoContent(page)
        expect(content).toContain('// [INVALID]')
        expect(content).toContain('ROSTER(bad input here)')
    })

    test('toast notification appears when invalid line is commented out', async ({ workspacePage: page }) => {
        await openRosterEditor(page)
        await switchToRaw(page)

        await setMonacoContent(page, 'ROSTER(bad input here)\nROSTER(3, "Thomas", "LIGHT")')

        await switchToVisual(page)

        // Syncfusion renders toasts inside .e-toast-container; wait for one to appear.
        const toast = page.locator('.e-toast-container .e-toast').first()
        await expect(toast).toBeVisible({ timeout: 5_000 })
        await expect(toast).toContainText('Invalid Lines Commented Out')
        await expect(toast).toContainText('commented out to prevent data loss')
    })

    test('commented-out invalid line persists after multiple raw ↔ visual toggles', async ({ workspacePage: page }) => {
        await openRosterEditor(page)
        await switchToRaw(page)

        // First pass: introduce a bad line alongside a good one
        await setMonacoContent(page, 'ROSTER(bad input here)\nROSTER(3, "Thomas", "LIGHT")')
        await switchToVisual(page)

        // Second toggle: go back to raw and straight back to visual
        await switchToRaw(page)
        await switchToVisual(page)

        // Third toggle: verify the [INVALID] comment is still present in raw
        await switchToRaw(page)
        const content = await getMonacoContent(page)
        expect(content).toContain('// [INVALID]')
        expect(content).toContain('ROSTER(bad input here)')
    })

    test('toast does NOT fire a second time when toggling again with no new invalid lines', async ({ workspacePage: page }) => {
        await openRosterEditor(page)
        await switchToRaw(page)

        // First pass: creates the toast
        await setMonacoContent(page, 'ROSTER(bad input here)\nROSTER(3, "Thomas", "LIGHT")')
        await switchToVisual(page)

        // Wait for any toast to finish rendering before we dismiss / check again
        const toast = page.locator('.e-toast-container .e-toast').first()
        await expect(toast).toBeVisible({ timeout: 5_000 })

        // Dismiss the toast by clicking its close button
        await toast.locator('.e-toast-close-icon').click()
        await expect(toast).not.toBeVisible({ timeout: 3_000 })

        // Second toggle — no new invalid lines, so toast must NOT reappear
        await switchToRaw(page)
        await switchToVisual(page)
        await page.waitForTimeout(500)
        await expect(page.locator('.e-toast-container .e-toast')).not.toBeVisible()
    })
})
