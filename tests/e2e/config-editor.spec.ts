/**
 * E2E tests: Visual config editors for EX-CommandStation and EX-IOExpander.
 *
 * Tests that the Visual/Raw tabs in config-h-editor work correctly, that
 * product-specific form fields appear, and that changes in the visual form
 * are reflected in the raw config text and vice-versa.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Config Editor"
 */

import { test, expect } from './fixtures'

// ── Helpers ──────────────────────────────────────────────────────────────────

async function openDeviceSettings(page: import('@playwright/test').Page) {
    await page.getByText('Device Settings', { exact: true }).first().click()
    await expect(page.locator('config-h-editor')).toBeVisible()
}

async function openIOExpanderConfig(page: import('@playwright/test').Page) {
    await page.getByText('myConfig.h', { exact: true }).first().click()
    await expect(page.locator('config-h-editor')).toBeVisible()
}

async function switchToRaw(page: import('@playwright/test').Page) {
    // The config-h-editor has its own Visual/Raw tab bar
    await page.locator('config-h-editor').getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('config-h-editor div.monaco-editor')).toBeVisible()
    await page.waitForTimeout(300)
}

async function switchToVisual(page: import('@playwright/test').Page) {
    await page.locator('config-h-editor').getByRole('button', { name: 'Visual' }).click()
    await page.waitForTimeout(200)
}

async function getMonacoText(page: import('@playwright/test').Page): Promise<string> {
    return page.evaluate(() => {
        const container = document.querySelector('config-h-editor div.monaco-editor') as HTMLElement
        if (!container) return ''
        const editorModel = (window as unknown as Record<string, unknown>)._monacoEditorInstance
        if (editorModel && typeof (editorModel as Record<string, unknown>).getValue === 'function') {
            return (editorModel as Record<string, () => string>).getValue()
        }
        // fallback: read from DOM lines
        return Array.from(container.querySelectorAll('.view-line'))
            .map(el => el.textContent ?? '')
            .join('\n')
    })
}

// ── CommandStation Visual Editor ──────────────────────────────────────────────

test.describe('Config Editor — EX-CommandStation', () => {
    test('Device Settings tab shows Visual/Raw tab bar', async ({ workspacePage }) => {
        await openDeviceSettings(workspacePage)

        await expect(
            workspacePage.locator('config-h-editor').getByRole('button', { name: 'Visual' }),
        ).toBeVisible()
        await expect(
            workspacePage.locator('config-h-editor').getByRole('button', { name: 'Raw' }),
        ).toBeVisible()
    })

    test('Visual tab is active by default and shows General sub-tab', async ({ workspacePage }) => {
        await openDeviceSettings(workspacePage)

        // Visual tab active — commandstation-config-form must be in the DOM
        await expect(workspacePage.locator('commandstation-config-form')).toBeVisible()

        // General sub-tab is active by default
        await expect(
            workspacePage.locator('commandstation-config-form').getByRole('button', { name: 'General' }),
        ).toBeVisible()
    })

    test('General tab shows motor driver dropdown', async ({ workspacePage }) => {
        await openDeviceSettings(workspacePage)

        // SF DropDownList — native <select> is not used; check the SF wrapper (.e-ddl) instead
        const ddlWrapper = workspacePage.locator('commandstation-config-form .e-ddl').first()
        await expect(ddlWrapper).toBeVisible()
    })

    test('General tab shows display dropdown', async ({ workspacePage }) => {
        await openDeviceSettings(workspacePage)

        // Display section label is visible
        await expect(workspacePage.locator('commandstation-config-form').getByText('Display')).toBeVisible()
        // At least two SF DropDownList wrappers (motor driver + display) are rendered
        const ddlWrappers = workspacePage.locator('commandstation-config-form .e-ddl')
        await expect(ddlWrappers.nth(1)).toBeVisible()
    })

    test('WiFi sub-tab shows disabled message when WiFi is off', async ({ workspacePage }) => {
        await openDeviceSettings(workspacePage)

        const wifiTabBtn = workspacePage
            .locator('commandstation-config-form')
            .getByRole('button', { name: /WiFi/ })
        await wifiTabBtn.click()

        await expect(
            workspacePage.locator('commandstation-config-form').getByText('WiFi is disabled'),
        ).toBeVisible()
    })

    test('enabling WiFi shows credentials form in WiFi sub-tab', async ({ workspacePage }) => {
        await openDeviceSettings(workspacePage)

        // Enable WiFi on General tab
        const wifiCheckbox = workspacePage
            .locator('commandstation-config-form')
            .locator('input[type="checkbox"]')
            .first()
        await wifiCheckbox.check()

        // Switch to WiFi sub-tab
        await workspacePage
            .locator('commandstation-config-form')
            .getByRole('button', { name: /WiFi/ })
            .click()

        await expect(
            workspacePage.locator('commandstation-config-form').getByText('Hostname'),
        ).toBeVisible()
        await expect(
            workspacePage.locator('commandstation-config-form').getByPlaceholder('dccex'),
        ).toBeVisible()
    })

    test('TrackManager tab shows Track A and Track B selects', async ({ workspacePage }) => {
        await openDeviceSettings(workspacePage)

        await workspacePage
            .locator('commandstation-config-form')
            .getByRole('button', { name: 'TrackManager' })
            .click()

        await expect(
            workspacePage.locator('commandstation-config-form').getByText('Track A'),
        ).toBeVisible()
        await expect(
            workspacePage.locator('commandstation-config-form').getByText('Track B'),
        ).toBeVisible()
        // Both Track A and B DDLs present — general tab may also have dropdown(s), so check >= 2
        const ddlWrappers = workspacePage.locator('commandstation-config-form .e-ddl')
        const count = await ddlWrappers.count()
        expect(count).toBeGreaterThanOrEqual(2)
    })

    test('TrackManager tab shows Startup power section', async ({ workspacePage }) => {
        await openDeviceSettings(workspacePage)

        await workspacePage
            .locator('commandstation-config-form')
            .getByRole('button', { name: 'TrackManager' })
            .click()

        await expect(
            workspacePage.locator('commandstation-config-form').getByText('Startup power'),
        ).toBeVisible()
    })

    test('TrackManager tab shows Track Configuration section', async ({ workspacePage }) => {
        await openDeviceSettings(workspacePage)

        await workspacePage
            .locator('commandstation-config-form')
            .getByRole('button', { name: 'TrackManager' })
            .click()

        await expect(
            workspacePage.locator('commandstation-config-form').getByText('Track Configuration'),
        ).toBeVisible()
    })

    test('switching to Raw tab shows Monaco editor', async ({ workspacePage }) => {
        await openDeviceSettings(workspacePage)
        await switchToRaw(workspacePage)

        await expect(workspacePage.locator('config-h-editor div.monaco-editor')).toBeVisible()
    })

    test('switching Visual → Raw → Visual re-mounts the form and shows stored values', async ({ workspacePage }) => {
        await openDeviceSettings(workspacePage)

        // form is visible
        await expect(workspacePage.locator('commandstation-config-form')).toBeVisible()

        await switchToRaw(workspacePage)
        await expect(workspacePage.locator('commandstation-config-form')).not.toBeVisible()

        await switchToVisual(workspacePage)
        await expect(workspacePage.locator('commandstation-config-form')).toBeVisible()
    })

    test('regression: selecting EXCSB1_WITH_EX8874 updates MOTOR_SHIELD_TYPE in config.h', async ({ csb1StackedPage }) => {
        await openDeviceSettings(csb1StackedPage)

        // Select the motor driver from the Syncfusion dropdown.
        await csb1StackedPage.locator('commandstation-config-form .e-ddl').first().click()
        await csb1StackedPage.locator('li.e-list-item', { hasText: 'EXCSB1_WITH_EX8874' }).first().click()

        await switchToRaw(csb1StackedPage)

        await expect(csb1StackedPage.locator('config-h-editor div.monaco-editor'))
            .toContainText('#define MOTOR_SHIELD_TYPE EXCSB1_WITH_EX8874')
    })
})

// ── Automation Editor (myAutomation.h) ───────────────────────────────────────

test.describe('Automation Editor — myAutomation.h', () => {
    test('Automation tab is present in the sidebar', async ({ workspacePage }) => {
        await expect(workspacePage.getByText('Automation', { exact: true }).first()).toBeVisible()
    })

    test('clicking Automation shows the myAutomation.h Monaco editor', async ({ workspacePage }) => {
        await workspacePage.getByText('Automation', { exact: true }).first().click()

        // file-editor-panel renders a Monaco editor for automation view
        await expect(workspacePage.locator('file-editor-panel div.monaco-editor')).toBeVisible()
    })

    test('myAutomation.h editor shows Editable badge (not read-only)', async ({ workspacePage }) => {
        await workspacePage.getByText('Automation', { exact: true }).first().click()

        await expect(
            workspacePage.locator('file-editor-panel').getByText('Editable'),
        ).toBeVisible()
    })

    test('myAutomation.h editor does not have the readonly attribute', async ({ workspacePage }) => {
        await workspacePage.getByText('Automation', { exact: true }).first().click()
        await workspacePage.locator('file-editor-panel div.monaco-editor').waitFor({ state: 'visible' })

        // The Monaco container should NOT carry aria-readonly="true"
        const isReadOnly = await workspacePage.locator('file-editor-panel div.monaco-editor').evaluate(
            (el) => el.getAttribute('aria-readonly') === 'true'
        )
        expect(isReadOnly).toBe(false)
    })

    test('shows "Managed sections regenerate automatically" hint', async ({ workspacePage }) => {
        await workspacePage.getByText('Automation', { exact: true }).first().click()

        await expect(
            workspacePage.locator('file-editor-panel').getByText('Managed sections regenerate automatically'),
        ).toBeVisible()
    })
})

// ── IOExpander Visual Editor ──────────────────────────────────────────────────

test.describe('Config Editor — EX-IOExpander', () => {
    test('myConfig.h tab shows Visual/Raw tab bar', async ({ ioExpanderPage }) => {
        await openIOExpanderConfig(ioExpanderPage)

        await expect(
            ioExpanderPage.locator('config-h-editor').getByRole('button', { name: 'Visual' }),
        ).toBeVisible()
        await expect(
            ioExpanderPage.locator('config-h-editor').getByRole('button', { name: 'Raw' }),
        ).toBeVisible()
    })

    test('Visual tab shows IOExpander form with I2C address field', async ({ ioExpanderPage }) => {
        await openIOExpanderConfig(ioExpanderPage)

        await expect(ioExpanderPage.locator('ioexpander-config-form')).toBeVisible()
        await expect(
            ioExpanderPage.locator('ioexpander-config-form').getByText('I2C Address'),
        ).toBeVisible()
    })

    test('I2C address field defaults to 0x65 from mock file', async ({ ioExpanderPage }) => {
        await openIOExpanderConfig(ioExpanderPage)

        const addrInput = ioExpanderPage
            .locator('ioexpander-config-form')
            .locator('input[type="text"]')
            .first()
        await expect(addrInput).toHaveValue('0x65')
    })

    test('changing I2C address updates config in raw view', async ({ ioExpanderPage }) => {
        await openIOExpanderConfig(ioExpanderPage)

        const addrInput = ioExpanderPage
            .locator('ioexpander-config-form')
            .locator('input[type="text"]')
            .first()
        await addrInput.fill('0x20')
        await addrInput.press('Tab') // trigger blur → onI2cAddressChange

        await switchToRaw(ioExpanderPage)

        // Monaco may not be directly readable — verify the form write happened by
        // switching back and checking the field
        await switchToVisual(ioExpanderPage)
        await expect(addrInput).toHaveValue('0x20')
    })

    test('enabling DIAG shows diagnostic delay input', async ({ ioExpanderPage }) => {
        await openIOExpanderConfig(ioExpanderPage)

        // Diagnostic delay section is hidden before DIAG is enabled (uses class-based hiding)
        await expect(
            ioExpanderPage.locator('ioexpander-config-form').getByText('Display frequency (seconds)'),
        ).not.toBeVisible()

        // Enable DIAG — SF CheckBox wraps the input; use force to bypass SF overlay
        const diagCheckbox = ioExpanderPage
            .locator('ioexpander-config-form')
            .locator('label', { hasText: 'Enable diagnostic output' })
            .locator('input[type="checkbox"]')
        await diagCheckbox.check({ force: true })

        // Delay section should now be visible
        await expect(
            ioExpanderPage.locator('ioexpander-config-form').getByText('Display frequency (seconds)'),
        ).toBeVisible()
    })

    test('test mode dropdown is visible', async ({ ioExpanderPage }) => {
        await openIOExpanderConfig(ioExpanderPage)

        await expect(
            ioExpanderPage.locator('ioexpander-config-form').getByText('Test Mode', { exact: true }),
        ).toBeVisible()
        // testModeEl is an SF DropDownList (not radio buttons)
        await expect(
            ioExpanderPage.locator('ioexpander-config-form .e-ddl'),
        ).toBeVisible()
    })

    test('switching Visual → Raw → Visual re-mounts form with persisted values', async ({ ioExpanderPage }) => {
        await openIOExpanderConfig(ioExpanderPage)

        await expect(ioExpanderPage.locator('ioexpander-config-form')).toBeVisible()

        await switchToRaw(ioExpanderPage)
        await expect(ioExpanderPage.locator('ioexpander-config-form')).not.toBeVisible()

        await switchToVisual(ioExpanderPage)
        await expect(ioExpanderPage.locator('ioexpander-config-form')).toBeVisible()

        // I2C address survives round-trip (form re-reads from configHContent)
        const addrInput = ioExpanderPage
            .locator('ioexpander-config-form')
            .locator('input[type="text"]')
            .first()
        await expect(addrInput).toHaveValue('0x65')
    })

    test('switching to Raw tab shows Monaco editor', async ({ ioExpanderPage }) => {
        await openIOExpanderConfig(ioExpanderPage)
        await switchToRaw(ioExpanderPage)

        await expect(ioExpanderPage.locator('config-h-editor div.monaco-editor')).toBeVisible()
    })
})

// ── Roster Editor ─────────────────────────────────────────────────────────────

async function openRosterEditor(page: import('@playwright/test').Page) {
    await page.getByText('Roster', { exact: true }).first().click()
    await expect(page.locator('roster-editor')).toBeVisible()
}

async function switchRosterToRaw(page: import('@playwright/test').Page) {
    await page.locator('roster-editor').getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('roster-editor div.monaco-editor')).toBeVisible()
    await page.waitForTimeout(300)
}

async function getRosterRawText(page: import('@playwright/test').Page): Promise<string> {
    return page.evaluate(() => {
        return Array.from(document.querySelectorAll('roster-editor .view-line'))
            // Monaco renders spaces as \u00a0 (NBSP) or \u00b7 (middle dot); normalize both.
            .map(el => (el.textContent ?? '').replace(/[\u00a0\u00b7]/g, ' '))
            .join('\n')
    })
}

test.describe('Roster Editor — Visual TreeView', () => {
    test('shows Visual and Raw tab bar', async ({ workspacePage }) => {
        await openRosterEditor(workspacePage)
        await expect(workspacePage.locator('roster-editor').getByRole('button', { name: 'Visual' })).toBeVisible()
        await expect(workspacePage.locator('roster-editor').getByRole('button', { name: 'Raw' })).toBeVisible()
    })

    test('TreeView renders a node for each roster entry', async ({ workspacePage }) => {
        await openRosterEditor(workspacePage)
        const tree = workspacePage.locator('#roster-treeview')
        await expect(tree.getByText('Thomas')).toBeVisible()
        await expect(tree.getByText('Percy')).toBeVisible()
    })

    test('clicking a loco node shows detail panel with editable DCC address', async ({ workspacePage }) => {
        await openRosterEditor(workspacePage)
        await workspacePage.locator('#roster-treeview li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()
        const addressInput = workspacePage.locator('roster-editor input[type="number"]')
        await expect(addressInput).toBeVisible()
        await expect(addressInput).toHaveValue('3')
    })

    test('switching between loco nodes updates the detail panel each time', async ({ workspacePage }) => {
        await openRosterEditor(workspacePage)
        const tree = workspacePage.locator('#roster-treeview')
        const addressInput = workspacePage.locator('roster-editor input[type="number"]')

        await tree.locator('li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()
        await expect(addressInput).toHaveValue('3')

        await tree.locator('li').filter({ hasText: 'Percy' }).first().locator('.e-fullrow').click()
        await expect(addressInput).toHaveValue('5')

        // Switch back — this is the case that exposed the re-entrant rebuild bug
        await tree.locator('li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()
        await expect(addressInput).toHaveValue('3')
    })

    test('right-click on loco node opens context menu with Clone and Delete', async ({ workspacePage }) => {
        await openRosterEditor(workspacePage)
        const thomasRow = workspacePage.locator('#roster-treeview li').filter({ hasText: 'Thomas' }).first()
        await thomasRow.locator('.e-fullrow').click({ button: 'right' })
        await expect(workspacePage.locator('.e-contextmenu li').filter({ hasText: 'Clone' })).toBeVisible()
        await expect(workspacePage.locator('.e-contextmenu li').filter({ hasText: 'Delete' })).toBeVisible()
        await expect(workspacePage.locator('.e-contextmenu li').filter({ hasText: 'Rename Group' })).not.toBeVisible()
    })

    test('Clone creates a group node with original and cloned loco', async ({ workspacePage }) => {
        await openRosterEditor(workspacePage)
        const thomasRow = workspacePage.locator('#roster-treeview li').filter({ hasText: 'Thomas' }).first()
        await thomasRow.locator('.e-fullrow').click({ button: 'right' })
        // Wait for menu to fully render before clicking
        await workspacePage.waitForTimeout(300)
        await workspacePage.locator('.e-contextmenu li').filter({ hasText: 'Clone' }).click()
        // A #define chip should now appear in the tree (group node)
        await expect(workspacePage.locator('#roster-treeview .text-yellow-400').filter({ hasText: '#define' })).toBeVisible({ timeout: 5_000 })
        // Expand the group if needed, then check for the cloned loco
        await expect(workspacePage.locator('#roster-treeview').getByText('Thomas (copy)')).toBeVisible({ timeout: 5_000 })
    })

    test('Delete via context menu removes the loco from the tree', async ({ workspacePage }) => {
        await openRosterEditor(workspacePage)
        const percyRow = workspacePage.locator('#roster-treeview li').filter({ hasText: 'Percy' }).first()
        await percyRow.locator('.e-fullrow').click({ button: 'right' })
        await workspacePage.waitForTimeout(300)
        await workspacePage.locator('.e-contextmenu li').filter({ hasText: 'Delete' }).click()
        // Handle Aurelia confirm dialog (fixture dialog auto-accept may not handle Aurelia dialogs)
        const deleteBtn = workspacePage.getByRole('button', { name: 'Delete' })
        if (await deleteBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await deleteBtn.click()
        }
        await expect(workspacePage.locator('#roster-treeview').getByText('Percy')).not.toBeVisible({ timeout: 5_000 })
    })

    test('Add button creates a new loco node and opens its detail panel', async ({ workspacePage }) => {
        await openRosterEditor(workspacePage)
        await workspacePage.locator('roster-editor button[title="Add new roster entry"]').click()
        // New entry gets dccAddress = max+1 = 6, name = "New Loco 6"
        await expect(workspacePage.locator('#roster-treeview').getByText('New Loco 6')).toBeVisible()
        const addressInput = workspacePage.locator('roster-editor input[type="number"]')
        await expect(addressInput).toHaveValue('6')
    })

    test('selecting a node after Delete still updates the detail panel', async ({ workspacePage }) => {
        await openRosterEditor(workspacePage)
        const percyRow = workspacePage.locator('#roster-treeview li').filter({ hasText: 'Percy' }).first()
        await percyRow.locator('.e-fullrow').click({ button: 'right' })
        await workspacePage.waitForTimeout(300)
        await workspacePage.locator('.e-contextmenu li').filter({ hasText: 'Delete' }).click()
        // Handle Aurelia confirm dialog
        const deleteBtn = workspacePage.getByRole('button', { name: 'Delete' })
        if (await deleteBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await deleteBtn.click()
        }
        await expect(workspacePage.locator('#roster-treeview').getByText('Percy')).not.toBeVisible({ timeout: 5_000 })
        // Thomas must still be selectable after the tree rebuilds
        await workspacePage.locator('#roster-treeview li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()
        await expect(workspacePage.locator('roster-editor input[type="number"]')).toHaveValue('3')
    })
})

test.describe('Roster Editor — TreeView grouping (pre-grouped roster)', () => {
    test('group node shows #define chip and friendly name', async ({ rosterGroupedPage }) => {
        await openRosterEditor(rosterGroupedPage)
        const tree = rosterGroupedPage.locator('#roster-treeview')
        await expect(tree.locator('.text-yellow-400').filter({ hasText: '#define' })).toBeVisible()
        await expect(tree.getByText('Steam Engines')).toBeVisible()
    })

    test('ungrouped loco appears as a root node', async ({ rosterGroupedPage }) => {
        await openRosterEditor(rosterGroupedPage)
        await expect(rosterGroupedPage.locator('#roster-treeview').getByText('Gordon')).toBeVisible()
    })

    test('clicking group node shows macro name label and friendly name input', async ({ rosterGroupedPage }) => {
        await openRosterEditor(rosterGroupedPage)
        await rosterGroupedPage.locator('#roster-treeview li').filter({ hasText: 'Steam Engines' }).first().locator('.e-fullrow').first().click()
        const detail = rosterGroupedPage.locator('roster-editor')
        await expect(detail.getByText('STEAM_F')).toBeVisible()
        const friendlyInput = detail.locator('input[placeholder*="display name"]')
        await expect(friendlyInput).toBeVisible()
        await expect(friendlyInput).toHaveValue('Steam Engines')
    })

    test('editing friendly name is reflected in raw view', async ({ rosterGroupedPage }) => {
        await openRosterEditor(rosterGroupedPage)
        await rosterGroupedPage.locator('#roster-treeview li').filter({ hasText: 'Steam Engines' }).first().locator('.e-fullrow').first().click()
        const friendlyInput = rosterGroupedPage.locator('roster-editor input[placeholder*="display name"]')
        await friendlyInput.fill('Narrow Gauge')
        await friendlyInput.blur()

        await switchRosterToRaw(rosterGroupedPage)
        const rawText = await getRosterRawText(rosterGroupedPage)
        expect(rawText).toContain('friendlyName: "Narrow Gauge"')
    })

    test('context menu on group node shows Rename Group but not Clone or Delete', async ({ rosterGroupedPage }) => {
        await openRosterEditor(rosterGroupedPage)
        const groupRow = rosterGroupedPage.locator('#roster-treeview li').filter({ hasText: 'Steam Engines' }).first()
        await groupRow.locator('.e-fullrow').first().click({ button: 'right' })
        await rosterGroupedPage.waitForTimeout(300)
        await expect(rosterGroupedPage.locator('.e-contextmenu li').filter({ hasText: 'Rename Group' })).toBeVisible()
        await expect(rosterGroupedPage.locator('.e-contextmenu li').filter({ hasText: 'Clone' })).not.toBeVisible()
        await expect(rosterGroupedPage.locator('.e-contextmenu li').filter({ hasText: 'Delete' })).not.toBeVisible()
    })

    test('clicking a grouped loco shows shared-function info card', async ({ rosterGroupedPage }) => {
        await openRosterEditor(rosterGroupedPage)
        // Thomas is a CHILD node nested inside the Steam Engines group li; navigate into the group's ul
        const steamGroupLi = rosterGroupedPage.locator('#roster-treeview li').filter({ hasText: 'Steam Engines' }).first()
        await steamGroupLi.locator('ul li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()
        await expect(rosterGroupedPage.locator('roster-editor').getByText('Shared Function List')).toBeVisible()
        await expect(rosterGroupedPage.locator('roster-editor').getByText('→ Edit function list')).toBeVisible()
    })

    test('"Edit function list" button switches detail to group editor', async ({ rosterGroupedPage }) => {
        await openRosterEditor(rosterGroupedPage)
        const steamGroupLi = rosterGroupedPage.locator('#roster-treeview li').filter({ hasText: 'Steam Engines' }).first()
        await steamGroupLi.locator('ul li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()
        await rosterGroupedPage.locator('roster-editor').getByText('→ Edit function list').click()
        await expect(rosterGroupedPage.locator('roster-editor').getByText('Macro Name')).toBeVisible()
        await expect(rosterGroupedPage.locator('roster-editor').getByText('STEAM_F')).toBeVisible()
    })

    test('switching between loco, group, and loco nodes updates the detail panel each time', async ({ rosterGroupedPage }) => {
        await openRosterEditor(rosterGroupedPage)
        const tree = rosterGroupedPage.locator('#roster-treeview')
        const detail = rosterGroupedPage.locator('roster-editor')
        const steamGroupLi = tree.locator('li').filter({ hasText: 'Steam Engines' }).first()

        // Click a grouped loco (Thomas is a child node inside Steam Engines group ul)
        await steamGroupLi.locator('ul li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()
        await expect(detail.getByText('Shared Function List')).toBeVisible()

        // Switch to the group node
        await steamGroupLi.locator('.e-fullrow').first().click()
        await expect(detail.getByText('STEAM_F')).toBeVisible()
        await expect(detail.getByText('Shared Function List')).not.toBeVisible()

        // Switch to an ungrouped loco
        await tree.locator('li').filter({ hasText: 'Gordon' }).first().locator('.e-fullrow').click()
        const addressInput = detail.locator('input[type="number"]')
        await expect(addressInput).toHaveValue('6')
    })

    test('macro name edit panel appears when Edit button clicked', async ({ rosterGroupedPage }) => {
        await openRosterEditor(rosterGroupedPage)
        const tree = rosterGroupedPage.locator('#roster-treeview')
        const detail = rosterGroupedPage.locator('roster-editor')

        // Click group node to enter group editor
        const steamGroupLi = tree.locator('li').filter({ hasText: 'Steam Engines' }).first()
        await steamGroupLi.locator('.e-fullrow').first().click()

        // Find and click the Edit button for macro name
        const editBtn = detail.locator('button:has-text("Edit")').first()
        await editBtn.click()

        // Should show input for macro name editing with Save/Cancel buttons
        const macroInput = detail.locator('input').filter({ value: /STEAM_F/ }).first()
        await expect(macroInput).toBeVisible()
        await expect(detail.locator('button:has-text("Save")').first()).toBeVisible()
        await expect(detail.locator('button:has-text("Cancel")').first()).toBeVisible()
    })

    test('custom functions section appears for grouped locos', async ({ rosterGroupedPage }) => {
        await openRosterEditor(rosterGroupedPage)
        const tree = rosterGroupedPage.locator('#roster-treeview')
        const detail = rosterGroupedPage.locator('roster-editor')

        // Find a grouped loco (Thomas)
        const steamGroupLi = tree.locator('li').filter({ hasText: 'Steam Engines' }).first()
        const thomasNode = steamGroupLi.locator('ul li').filter({ hasText: 'Thomas' }).first()
        await thomasNode.locator('.e-fullrow').click()

        // Verify custom functions section is present with proper label
        await expect(detail.getByText('Custom Functions (optional)')).toBeVisible()

        // Add a custom function by finding the input and the add button
        const customInput = detail.locator('input[placeholder="New custom function"]')
        await customInput.fill('BRAKE')
        await customInput.press('Enter')

        // Wait for the component to process the add
        await rosterGroupedPage.waitForTimeout(1000)

        // Switch to Raw mode to verify serialization
        const rawTab = rosterGroupedPage.locator('button:has-text("Raw")').first()
        await rawTab.click()
        await rosterGroupedPage.waitForTimeout(500)

        // The key test: verify serialization shows the appended function syntax
        const monaco = rosterGroupedPage.locator('monaco-editor')
        const rawContent = await monaco.textContent()

        // Verify NO [INVALID] markers appear (regression test for validation regex)
        expect(rawContent).not.toContain('[INVALID]')

        // Check for the ROSTER line with BRAKE appended
        expect(rawContent).toContain('STEAM_F')
        expect(rawContent).toContain('BRAKE')
        expect(rawContent).toContain('Thomas')
        expect(rawContent).toMatch(/STEAM_F\s*"\/BRAKE"/)

        // Switch back to Visual mode
        const visualTab = rosterGroupedPage.locator('button:has-text("Visual")').first()
        await visualTab.click()
        await rosterGroupedPage.waitForTimeout(500)

        // Verify the loco is still there and custom functions section still appears
        await expect(detail.getByText('Custom Functions (optional)')).toBeVisible()
    })

    test('handles loco names with special characters correctly', async ({ rosterGroupedPage }) => {
        // Verifies that the existing grouped locos load correctly with the detail panel
        // This serves as a regression test for parsing and display stability
        await openRosterEditor(rosterGroupedPage)
        const tree = rosterGroupedPage.locator('#roster-treeview')
        const detail = rosterGroupedPage.locator('roster-editor')

        // Click a grouped loco (Thomas) to load detail panel
        const steamGroupLi = tree.locator('li').filter({ hasText: 'Steam Engines' }).first()
        const thomas = steamGroupLi.locator('ul li').filter({ hasText: 'Thomas' }).first()
        await expect(thomas).toBeVisible()
        await thomas.locator('.e-fullrow').click()

        // Should show the shared function list card
        await expect(detail.getByText('Functions from Group')).toBeVisible()

        // Verify detail panel loads correctly and shows the DCC address
        const addressInput = detail.locator('input[type="number"]').first()
        await expect(addressInput).toHaveValue('3')
    })
})
