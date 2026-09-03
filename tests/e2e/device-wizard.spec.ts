/**
 * "Setup New Device" wizard — this app version only supports EX-CommandStation,
 * so the wizard has no product-selection step (see device-wizard.ts/.html).
 *
 * Step order: Select Device -> Select Version -> [WiFi -> Display -> Track
 * Power, EX-CSB1 only] -> Confirm. Confirm is always the last step: it's
 * where the device gets its name and a review of every choice made earlier.
 */

import { test, expect } from './fixtures'

/**
 * Drives the CSB1 wizard from an already-open "Select Device" step through
 * Finish, picking whatever `nickname` is given. Accepts defaults for
 * everything else (WiFi AP mode, suggested display, "all tracks on" power).
 */
async function finishCsb1Wizard(
    page: import('@playwright/test').Page,
    { nickname }: { nickname: string },
) {
    await expect(page.getByText('Select Device', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    const boardButton = page.locator('button', { hasText: 'EX-CSB1' })
    await expect(boardButton.first()).toBeVisible({ timeout: 15_000 })
    await boardButton.first().click()
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByText('Select Version', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    // The wizard is opened with DialogDomRendererClassic (a plain
    // <au-dialog-container> div, not a native <dialog>) so <track-manager-form>'s
    // Syncfusion popups render correctly — see home.ts/workspace.ts. Scope
    // through that tag instead of getByRole('dialog'), which only native
    // <dialog> elements get for free.
    await expect(page.locator('au-dialog-container').getByRole('combobox').first()).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByText('Set up WiFi for this EX-CSB1.')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByText('Hardware settings for this EX-CSB1')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByText('Configure track power for this EX-CSB1.')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByText('Review your selections')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('wizard-device-nickname').fill(nickname)
    await page.getByRole('button', { name: 'Finish' }).click()
}

/** Get the current raw text in the Monaco editor (view-line based, no clipboard). */
async function getMonacoContent(page: import('@playwright/test').Page): Promise<string> {
    const lines = await page.locator('div.monaco-editor .view-line').allTextContents()
    // Monaco uses non-breaking spaces ( ) in view-line rendering.
    return lines.map((l) => l.replace(/\u00a0/g, ' ')).join('\n')
}

test('new device wizard: no product step, recommends latest Prod tag, Confirm step needs no scroll', async ({ onboardingPage: page }) => {
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

    // ── Step: WiFi ───────────────────────────────────────────────────────────
    await expect(page.getByText('Set up WiFi for this EX-CSB1.')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Display — OLED + stacked motor shield share one pane ─────────
    await expect(page.getByText('Hardware settings for this EX-CSB1')).toBeVisible()
    const shieldLabel = page.getByText('This EX-CSB1 has a stacked motor shield')
    await expect(shieldLabel).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Track Power ───────────────────────────────────────────────────
    await expect(page.getByText('Configure track power for this EX-CSB1.')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Confirm — device name defaults to "CSB1" and is focused, and
    // reviews everything configured in the earlier steps ────────────────────
    await expect(page.getByText('Review your selections')).toBeVisible({ timeout: 10_000 })
    const nicknameInput = page.getByTestId('wizard-device-nickname')
    await expect(nicknameInput).toHaveValue('CSB1')
    await expect(nicknameInput).toBeFocused()
    await expect(page.getByText('Access Point')).toBeVisible()
    await expect(page.getByText('OLED 132×64 (EX-CSB1)')).toBeVisible()
    await expect(page.getByText('Standard (EXCSB1)')).toBeVisible()
    // Track Power was never touched — the review falls back to the wizard's default
    // (all tracks off — see device-wizard.ts's TRACK_POWER_SUMMARY).
    await expect(page.getByText('All tracks off at startup', { exact: false })).toBeVisible()

    // The whole review must be visible without scrolling the step container.
    const container = page.locator('div.overflow-y-auto').first()
    const containerBox = await container.boundingBox()
    const nameLabelBox = await page.getByText('Device Name').boundingBox()
    expect(containerBox).not.toBeNull()
    expect(nameLabelBox).not.toBeNull()
    expect(nameLabelBox!.y + nameLabelBox!.height).toBeLessThanOrEqual(containerBox!.y + containerBox!.height + 1)
})

test('new device wizard: non-CSB1 boards skip WiFi/Display/Track Power straight to Confirm', async ({ onboardingPage: page }) => {
    await page.getByText('New Device', { exact: true }).click()

    // ── Step: Select Device — pick the mock Arduino Mega, not an EX-CSB1 ───
    await expect(page.getByText('Select Device', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    const boardButton = page.locator('button', { hasText: 'Mega' })
    await expect(boardButton.first()).toBeVisible({ timeout: 15_000 })
    await boardButton.first().click()
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Select Version ────────────────────────────────────────────────
    await expect(page.getByText('Select Version', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    const versionSelect = page.locator('select')
    await expect(versionSelect).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Confirm — WiFi/Display/Track Power never shown for this board ─
    await expect(page.getByText('Review your selections')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('This EX-CSB1 has a stacked motor shield')).toHaveCount(0)

    // Going back from Confirm returns to Version, not Track Power.
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByText('Select Version', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
})

test('new device wizard: EX-CSB1 flow through WiFi/Display/Track Power lands on Roster, no roster prompt', async ({ onboardingPage: page }) => {
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

    // ── Step: WiFi ───────────────────────────────────────────────────────────
    await expect(page.getByText('Set up WiFi for this EX-CSB1.')).toBeVisible({ timeout: 30_000 })
    // AP mode's SSID/password help text is the tallest content this step
    // shows — the step container must fit it without scrolling.
    const wifiContainer = page.locator('div.overflow-y-auto').first()
    await expect
        .poll(() => wifiContainer.evaluate((el) => el.scrollHeight - el.clientHeight))
        .toBeLessThanOrEqual(1)
    await page.getByLabel('Station (join existing network)').check()
    await page.getByTestId('wizard-wifi-ssid').fill('MyHomeNetwork')
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Display — suggested 132x64 default, plus stacked shield ──────
    await expect(page.getByText('Hardware settings for this EX-CSB1')).toBeVisible()
    await expect(page.getByText("If your screen doesn't display correctly, try a different display type")).toBeVisible()
    await expect(page.getByTestId('wizard-oled-display')).toHaveValue('OLED_132x64')
    // Checking the stacked-shield box here must reach Track Power's live
    // <track-manager-form> the instant it mounts, even though the two live
    // in different wizard steps.
    await page.getByText('This EX-CSB1 has a stacked motor shield').click()
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Track Power — the same live <track-manager-form> the Startup
    // section uses, so it supports DCC/DC/Mixed and programming just like it ──
    await expect(page.getByText('Configure track power for this EX-CSB1.')).toBeVisible()
    // Track C/D only appear once the form sees the stacked motor shield —
    // regression coverage for that choice reaching config.h before Track
    // Power's <track-manager-form> mounts (see syncCsb1ConfigH()).
    await expect(page.locator('track-manager-form').getByText('Track C', { exact: true })).toBeVisible()
    await expect(page.locator('track-manager-form').getByText('Track D', { exact: true })).toBeVisible()
    await expect(page.getByText('Mixed (DCC and DC)')).toBeVisible()
    await page.getByText('Mixed (DCC and DC)').click()
    await page.waitForTimeout(300)
    // Set Track A to PROG (the programming track) — proves mode switching,
    // including programming, works the same as the Startup section's form.
    // DDL order: [0] Startup power, [1] Track A mode, [2] Track A power
    // (hidden until "Individual"), [3] Track B mode, [4] Track B power.
    await page.locator('track-manager-form .e-ddl').nth(1).click()
    await page.waitForTimeout(200)
    await page.locator('li.e-list-item', { hasText: 'PROG' }).first().click()
    await page.waitForTimeout(300)
    // Switch to individual per-track power — together with the mode change
    // above, this guarantees myStartup.h actually changes, unlike leaving
    // everything at its firmware default (which generates no AUTOSTART block
    // at all).
    await page.locator('track-manager-form .e-ddl').first().click()
    await page.waitForTimeout(200)
    await page.getByText('Individual tracks (SET_POWER)').click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Confirm — review shows every earlier choice, then Finish ─────
    await expect(page.getByText('Review your selections')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Station — MyHomeNetwork')).toBeVisible()
    // Track Power's PROG + individual-power choices from the previous step
    // show up as a real readout, not just "configured in the previous step".
    await expect(page.getByText('Individual per-track power', { exact: false })).toBeVisible()
    await expect(page.getByText('A: PROG (ON)', { exact: false })).toBeVisible()
    await expect(page.getByText('Stacked (EXCSB1_WITH_EX8874)')).toBeVisible()
    await page.getByTestId('wizard-device-nickname').fill('My CSB1 Layout')
    await expect(page.getByRole('button', { name: 'Finish' })).toBeVisible()
    await page.getByRole('button', { name: 'Finish' }).click()

    // ── Roster isn't a wizard step — finishing lands directly on it ────────
    await expect(page.getByTestId('nav-general-wifi')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('roster-editor')).toBeVisible()

    // config.h picked up the WiFi + Display answers.
    await page.getByTestId('nav-general-wifi').click()
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
    await page.waitForTimeout(400)
    const configHContent = await getMonacoContent(page)
    expect(configHContent).toContain('WIFI_SSID "MyHomeNetwork"')
    expect(configHContent).toContain('ENABLE_WIFI true')
    expect(configHContent).toContain('OLED_DRIVER 132,64')
    expect(configHContent).toContain('MOTOR_SHIELD_TYPE EXCSB1_WITH_EX8874')

    // The Track Power step's Track A → PROG and "Individual tracks" choices
    // made it through to myStartup.h — proving the wizard's live
    // <track-manager-form> writes survive into the final saved/on-disk
    // config, not just the in-memory wizard session.
    await page.getByTestId('nav-startup').click()
    await page.locator('startup-editor').getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
    await page.waitForTimeout(400)
    const startupContent = await getMonacoContent(page)
    expect(startupContent).toContain('SET_TRACK(A,PROG)')
    expect(startupContent).toContain('SET_POWER(A,ON)')
})

test('new device wizard: WiFi password can be shown/hidden on WiFi and Confirm steps', async ({ onboardingPage: page }) => {
    await page.getByText('New Device', { exact: true }).click()

    await expect(page.getByText('Select Device', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    const boardButton = page.locator('button', { hasText: 'EX-CSB1' })
    await expect(boardButton.first()).toBeVisible({ timeout: 15_000 })
    await boardButton.first().click()
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByText('Select Version', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('au-dialog-container').getByRole('combobox').first()).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: WiFi — password field defaults masked, Show/Hide toggles it ──
    await expect(page.getByText('Set up WiFi for this EX-CSB1.')).toBeVisible({ timeout: 30_000 })
    const pwInput = page.locator('label', { hasText: 'Password' }).locator('xpath=following-sibling::div[1]//input')
    await pwInput.fill('supersecret123')
    await expect(pwInput).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Show' }).first().click()
    await expect(pwInput).toHaveAttribute('type', 'text')
    await expect(pwInput).toHaveValue('supersecret123')
    await page.getByRole('button', { name: 'Hide' }).first().click()
    await expect(pwInput).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByText('Hardware settings for this EX-CSB1')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByText('Configure track power for this EX-CSB1.')).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Step: Confirm — masked by default, its own Show/Hide reveals it ────
    await expect(page.getByText('Review your selections')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('WiFi Password')).toBeVisible()
    await expect(page.getByText('••••••••')).toBeVisible()
    await page.getByRole('button', { name: 'Show' }).click()
    await expect(page.getByText('supersecret123')).toBeVisible()
})

test('new device wizard: a second device never inherits an earlier device\'s roster/config', async ({ onboardingPage: page }) => {
    // Device A: create it, then add a roster entry by hand once landed there.
    await page.getByText('New Device', { exact: true }).click()
    await finishCsb1Wizard(page, { nickname: 'Device A' })
    await expect(page.getByTestId('nav-general-wifi')).toBeVisible({ timeout: 15_000 })
    await page.getByText('Roster', { exact: true }).first().click()
    await page.getByTitle('Add new roster entry').click()
    await expect(page.getByText('New Loco 1')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Save' }).click()
    await page.locator('[data-testid="file-changes-save-button"]').click()
    await page.waitForTimeout(300)

    // Device B: same (mock) board — it must start with none of Device A's
    // roster/config, even though --mock-device only simulates one physical
    // EX-CSB1 (same FQBN/serial as Device A).
    await page.getByRole('button', { name: /Device A/ }).click()
    await page.getByText('Add New Device', { exact: true }).click()
    await finishCsb1Wizard(page, { nickname: 'Device B' })
    await expect(page.getByTestId('nav-general-wifi')).toBeVisible({ timeout: 15_000 })

    await page.getByText('Roster', { exact: true }).first().click()
    await expect(page.getByText('New Loco 1')).toHaveCount(0)

    // Device A's own roster is untouched by Device B's setup.
    await page.getByRole('button', { name: /Device B/ }).click()
    await page.getByText('Device A', { exact: true }).click()
    await page.getByText('Roster', { exact: true }).first().click()
    await expect(page.getByText('New Loco 1')).toBeVisible({ timeout: 10_000 })
})
