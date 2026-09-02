/**
 * E2E tests: Automations editor — AUTOMATION(id, "description") as a first-class
 * structured type (myAutomations.h), mirroring the Sequences editor's own tests
 * (sequences-editor.spec.ts) since AUTOMATION shares ROUTE's exact header shape
 * (numeric id + quoted description) and the same Blocks-canvas mechanics.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Automations Editor"
 */

import { test, expect } from './fixtures'

async function openAutomationsEditor(page: import('@playwright/test').Page) {
    await page.getByText('Automations', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function openAliasesEditor(page: import('@playwright/test').Page) {
    await page.getByText('Aliases', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function switchToRaw(page: import('@playwright/test').Page) {
    await page.getByTestId('editor-tab-raw').click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
    await page.waitForTimeout(400)
}

function automationListItems(page: import('@playwright/test').Page) {
    return page.locator('automations-editor nav[aria-label="Automations"] a')
}

function descriptionInput(page: import('@playwright/test').Page) {
    return page.locator('automations-editor input[aria-label="Automation description"]')
}

async function addAutomation(page: import('@playwright/test').Page) {
    await page.locator('automations-editor button[title="Add new automation"]').click()
}

function hatAliasField(page: import('@playwright/test').Page) {
    return page.getByRole('button', { name: /^Edit text:/ })
}

async function setHatAlias(page: import('@playwright/test').Page, value: string) {
    await hatAliasField(page).click()
    await page.keyboard.press('Control+A')
    if (value) await page.keyboard.type(value)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
}

async function hatIdFieldValue(page: import('@playwright/test').Page): Promise<number> {
    const label = await page.getByRole('button', { name: /^Edit number:/ }).getAttribute('aria-label')
    return Number((label ?? '').replace(/^Edit number:\s*/, ''))
}

test.describe('Automations Editor', () => {
    test('starts empty with a placeholder message', async ({ workspacePage: page }) => {
        await openAutomationsEditor(page)
        await expect(page.getByText('No automations.').first()).toBeVisible()
        await expect(page.getByText('0 entries')).toBeVisible()
    })

    test('adding an automation renders a hat block in the Blocks canvas', async ({ workspacePage: page }) => {
        await openAutomationsEditor(page)
        await addAutomation(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
    })

    test('Strict aliases (on by default): a freshly-added automation shows a warning dot in the list, which clears once aliased', async ({ workspacePage: page }) => {
        await openAutomationsEditor(page)
        await addAutomation(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        const row = automationListItems(page).first()
        await expect(row.getByTestId('alias-warning-dot')).toBeVisible()

        await setHatAlias(page, 'NEW_AUTOMATION')

        await expect(row.getByTestId('alias-warning-dot')).toHaveCount(0)
    })

    test('editing an automation description updates the sidebar label and raw', async ({ workspacePage: page }) => {
        await openAutomationsEditor(page)
        await addAutomation(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        const id = await hatIdFieldValue(page)

        // Strict aliases is on by default — a freshly-added automation has no alias yet.
        await setHatAlias(page, 'PLATFORM_SHUNT')

        const descInput = descriptionInput(page)
        await descInput.fill('Platform shunt')
        await descInput.blur()
        await expect(automationListItems(page).first()).toContainText(`Platform shunt (${id})`)

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText(`AUTOMATION(${id}, "Platform shunt")`)
    })

    test('removing an automation removes it from raw', async ({ workspacePage: page }) => {
        await openAutomationsEditor(page)
        await addAutomation(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        await setHatAlias(page, 'REMOVABLE_AUTOMATION')
        const descInput = descriptionInput(page)
        await descInput.fill('Removable automation')
        await descInput.blur()

        await automationListItems(page).first().locator('button[title="Remove"]').click()

        await expect(page.getByText('No automations.').first()).toBeVisible()
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).not.toContainText('Removable automation')
    })

    test('setting an alias on an automation writes ALIAS(...) with type: Automation to myAliases.h', async ({ workspacePage: page }) => {
        await openAutomationsEditor(page)
        await addAutomation(page)
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        const id = await hatIdFieldValue(page)

        await setHatAlias(page, 'YARD_SHUNT_AUTO')

        await openAliasesEditor(page)
        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText(`ALIAS(YARD_SHUNT_AUTO, ${id}) // type: Automation`)
    })
})
