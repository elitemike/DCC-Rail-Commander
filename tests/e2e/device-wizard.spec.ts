/**
 * "Setup New Device" wizard — this app version only supports EX-CommandStation,
 * so the wizard has no product-selection step (see device-wizard.ts/.html).
 */

import { test, expect } from './fixtures'

/**
 * Drives the CSB1 wizard from an already-open "Select Device" step through
 * Finish, picking whatever `nickname` and roster choice are given. Accepts
 * defaults for everything else (WiFi AP mode, suggested OLED, "all tracks
 * on" power).
 */
async function finishCsb1Wizard(
    page: import('@playwright/test').Page,
    { nickname, addRosterEntry }: { nickname: string; addRosterEntry: boolean },
) {
    await expect(page.getByText('Select Device', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    const boardButton = page.locator('button', { hasText: 'EX-CSB1' })
    await expect(boardButton.first()).toBeVisible({ timeout: 15_000 })
    await boardButton.first().click()
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByText('Select Version', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('dialog').getByRole('combobox').first()).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByText('Review your selections')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('wizard-device-nickname').fill(nickname)
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByText('Set up WiFi for this EX-CSB1.')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByText('Suggested OLED display settings')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByText('Choose how track power behaves on startup.')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByText('Would you like to add your first roster entry now?')).toBeVisible()
    await page.getByText(addRosterEntry ? 'Add my first roster entry' : 'Skip for now').click()
    await page.getByRole('button', { name: 'Finish' }).click()
}

/** Get the current raw text in the Monaco editor (view-line based, no clipboard). */
async function getMonacoContent(page: import('@playwright/test').Page): Promise<string> {
    const lines = await page.locator('div.monaco-editor .view-line').allTextContents()
    // Monaco uses non-breaking spaces ( ) in view-line rendering.
    return lines.map((l) => l.replace(/\u00a0/g, ' ')).join('\n')
}

test('new device wizard: no product step, recommends latest Prod tag, confirm step needs no scroll', async ({ onboardingPage: page }) => {
    await page.getByText('New Device', { exact: true }).click()

    // ── Step: Select Device ─────────────────────────────────────────────────
    await expect(page.getByText('Select Device', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    const boardButton = page.locator('button', { hasText: 'EX-CSB1' })
    await expect(boardButton.first()).toBeVisible({ timeout: 15_000 })
    await boardButton.first().click()
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Select Version — no "Select Product" step in between ─────────
    await expect(page.getByText('Select Version', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Select Product', { exact: true })).toHaveCount(0)

    const versionSelect = page.locator('select')
    await expect(versionSelect).toBeVisible({ timeout: 60_000 })
    const recommendedOption = versionSelect.locator('option', { hasText: '(Recommended)' })
    await expect(recommendedOption).toHaveCount(1)
    // The recommended (latest Prod) tag is preselected by default.
    const selectedText = await versionSelect.evaluate((el: HTMLSelectElement) => el.options[el.selectedIndex].text)
    expect(selectedText).toContain('(Recommended)')

    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Confirm ────────────────────────────────────────────────────────
    await expect(page.getByText('Review your selections')).toBeVisible({ timeout: 10_000 })
    const shieldLabel = page.getByText('This EX-CSB1 has a stacked motor shield')
    await expect(shieldLabel).toBeVisible()

    // Device Name defaults to "CSB1" and is focused as soon as the step shows,
    // so the user can just start typing to replace it.
    const nicknameInput = page.getByTestId('wizard-device-nickname')
    await expect(nicknameInput).toHaveValue('CSB1')
    await expect(nicknameInput).toBeFocused()

    // The stacked-motor-shield option must be visible without scrolling the
    // step container (the whole point of the dialog height bump).
    const container = page.locator('div.overflow-y-auto').first()
    const containerBox = await container.boundingBox()
    const labelBox = await shieldLabel.boundingBox()
    expect(containerBox).not.toBeNull()
    expect(labelBox).not.toBeNull()
    expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(containerBox!.y + containerBox!.height + 1)
})

test('new device wizard: EX-CSB1 continues past Confirm into WiFi/OLED/Track Power/Roster steps', async ({ onboardingPage: page }) => {
    await page.getByText('New Device', { exact: true }).click()

    // ── Step: Select Device ─────────────────────────────────────────────────
    await expect(page.getByText('Select Device', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    const boardButton = page.locator('button', { hasText: 'EX-CSB1' })
    await expect(boardButton.first()).toBeVisible({ timeout: 15_000 })
    await boardButton.first().click()
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Select Version ────────────────────────────────────────────────
    await expect(page.getByText('Select Version', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    const versionSelect = page.locator('select')
    await expect(versionSelect).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Confirm — Next provisions the device but, for EX-CSB1, does
    // NOT close the dialog: it continues on to WiFi instead ────────────────
    await expect(page.getByText('Review your selections')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('wizard-device-nickname').fill('My CSB1 Layout')
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: WiFi ───────────────────────────────────────────────────────────
    await expect(page.getByText('Set up WiFi for this EX-CSB1.')).toBeVisible({ timeout: 30_000 })
    await page.getByLabel('Station (join existing network)').check()
    await page.getByTestId('wizard-wifi-ssid').fill('MyHomeNetwork')
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: OLED Display — suggested 132x64 default, with the fallback note ──
    await expect(page.getByText('Suggested OLED display settings')).toBeVisible()
    await expect(page.getByText("If your screen doesn't display correctly, try a different display type")).toBeVisible()
    await expect(page.getByTestId('wizard-oled-display')).toHaveValue('OLED_132x64')
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Track Power — accept the "all tracks on" default ─────────────
    await expect(page.getByText('Choose how track power behaves on startup.')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Roster — accept "add my first entry" and finish ──────────────
    await expect(page.getByText('Would you like to add your first roster entry now?')).toBeVisible()
    await page.getByText('Add my first roster entry').click()
    await expect(page.getByRole('button', { name: 'Finish' })).toBeVisible()
    await page.getByRole('button', { name: 'Finish' }).click()

    // ── Landed in the workspace ─────────────────────────────────────────────
    await expect(page.getByTestId('nav-general-wifi')).toBeVisible({ timeout: 15_000 })

    // config.h picked up the WiFi + OLED answers.
    await page.getByTestId('nav-general-wifi').click()
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
    await page.waitForTimeout(400)
    const configHContent = await getMonacoContent(page)
    expect(configHContent).toContain('WIFI_SSID "MyHomeNetwork"')
    expect(configHContent).toContain('ENABLE_WIFI true')
    expect(configHContent).toContain('OLED_DRIVER 132,64')

    // The first roster entry was added via ConfigEditorState (not written raw).
    await page.getByText('Roster', { exact: true }).first().click()
    await expect(page.getByText('New Loco 1')).toBeVisible({ timeout: 10_000 })
})

test('new device wizard: a second device never inherits an earlier device\'s roster/config', async ({ onboardingPage: page }) => {
    // Device A: create it with a roster entry.
    await page.getByText('New Device', { exact: true }).click()
    await finishCsb1Wizard(page, { nickname: 'Device A', addRosterEntry: true })
    await expect(page.getByTestId('nav-general-wifi')).toBeVisible({ timeout: 15_000 })
    await page.getByText('Roster', { exact: true }).first().click()
    await expect(page.getByText('New Loco 1')).toBeVisible({ timeout: 10_000 })

    // Device B: same (mock) board, skip the roster prompt this time — it must
    // start with none of Device A's roster/config, even though --mock-device
    // only simulates one physical EX-CSB1 (same FQBN/serial as Device A).
    await page.getByRole('button', { name: /Device A/ }).click()
    await page.getByText('Add New Device', { exact: true }).click()
    await finishCsb1Wizard(page, { nickname: 'Device B', addRosterEntry: false })
    await expect(page.getByTestId('nav-general-wifi')).toBeVisible({ timeout: 15_000 })

    await page.getByText('Roster', { exact: true }).first().click()
    await expect(page.getByText('New Loco 1')).toHaveCount(0)

    // Device A's own roster is untouched by Device B's setup.
    await page.getByRole('button', { name: /Device B/ }).click()
    await page.getByText('Device A', { exact: true }).click()
    await page.getByText('Roster', { exact: true }).first().click()
    await expect(page.getByText('New Loco 1')).toBeVisible({ timeout: 10_000 })
})
