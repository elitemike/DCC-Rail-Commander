import { test, expect } from './fixtures'
import type { Page, Locator } from '@playwright/test'

/**
 * Throttle panel: MOCK_ROSTER_H (see fixtures.ts) defines
 * `ROSTER(3, "Thomas", "LIGHT/HORN/*WHISTLE/BELL")` and
 * `ROSTER(5, "Percy", "LIGHT/HORN")` — F0=LIGHT, F1=HORN, F2=*WHISTLE
 * (momentary), F3=BELL for Thomas; F0=LIGHT, F1=HORN for Percy.
 */

async function openThrottleSection(page: Page): Promise<void> {
    const throttleNav = page.getByTestId('throttle-nav-item')
    await expect(throttleNav).toBeVisible({ timeout: 15_000 })
    await throttleNav.click()
}

/** Click an SF DropDownList's wrapper (not the underlying <input>) by the data-testid on its input, then pick a li.e-list-item by text. Same pattern as selectMotorDriver() in config-editor.spec.ts. */
async function pickFromDropdown(page: Page, inputTestId: string, optionText: string): Promise<void> {
    await page.locator('.e-ddl', { has: page.getByTestId(inputTestId) }).click()
    await page.waitForTimeout(200)
    await page.locator('li.e-list-item', { hasText: optionText }).first().click()
    await page.waitForTimeout(200)
}

async function setAddMode(page: Page, mode: 'Roster' | 'Address'): Promise<void> {
    await pickFromDropdown(page, 'throttle-add-mode', mode)
}

async function addFromRoster(page: Page, optionText: string): Promise<void> {
    await setAddMode(page, 'Roster')
    await pickFromDropdown(page, 'throttle-roster-select', optionText)
    await page.getByTestId('throttle-add').click()
}

async function addFreeform(page: Page, address: string): Promise<void> {
    await setAddMode(page, 'Address')
    // SF NumericTextBox clones data-* onto its hidden mirror input too — take the first (visible) match.
    // It only fires its `change` callback on blur, not on a raw `fill()`-dispatched input event.
    const addressInput = page.getByTestId('throttle-address-input').first()
    await addressInput.fill(address)
    await addressInput.press('Tab')
    await page.getByTestId('throttle-add').click()
}

function cardFor(page: Page, cabText: string): Locator {
    return page.getByTestId('throttle-card').filter({ hasText: cabText })
}

/** Clicks a card's × button, then confirms the "Release Throttle" dialog. */
async function releaseCard(page: Page, card: Locator): Promise<void> {
    await card.getByTestId('throttle-release').click()
    await page.getByRole('button', { name: 'Release', exact: true }).click()
}

test('Throttle nav item appears once connected, and opens an empty panel', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await expect(page.getByText('No throttles yet', { exact: false })).toBeVisible()
    await expect(page.getByTestId('throttle-power-toggle')).toBeVisible()
})

test('acquires a roster loco and a freeform address as separate cards in the grid', async ({ workspacePage: page }) => {
    await openThrottleSection(page)

    await addFromRoster(page, 'Thomas (3)')
    await expect(cardFor(page, 'Cab 3')).toBeVisible()
    await expect(cardFor(page, 'Cab 3')).toContainText('Thomas')

    await addFreeform(page, '99')
    await expect(cardFor(page, 'Cab 99')).toBeVisible()

    // Both throttles coexist — this is the "as many throttles as possible" grid.
    await expect(page.getByTestId('throttle-card')).toHaveCount(2)
})

test('an acquired roster loco drops out of the picker until released', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await addFromRoster(page, 'Thomas (3)')

    const rosterDropdown = page.locator('.e-ddl', { has: page.getByTestId('throttle-roster-select') })

    // Open — Thomas is gone, Percy remains.
    await rosterDropdown.click()
    await page.waitForTimeout(200)
    await expect(page.locator('li.e-list-item', { hasText: 'Thomas (3)' })).toHaveCount(0)
    await expect(page.locator('li.e-list-item', { hasText: 'Percy (5)' })).toBeVisible()
    // Close by toggling the same wrapper again (symmetric with how it opened).
    await rosterDropdown.click()
    await page.waitForTimeout(200)

    await releaseCard(page, cardFor(page, 'Cab 3'))
    await expect(cardFor(page, 'Cab 3')).not.toBeVisible()

    // Reopen fresh — Thomas is back.
    await rosterDropdown.click()
    await page.waitForTimeout(200)
    await expect(page.locator('li.e-list-item', { hasText: 'Thomas (3)' })).toBeVisible()
})

test('a roster loco only shows its defined functions — no generic Fn padding', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await addFromRoster(page, 'Thomas (3)')
    const card = cardFor(page, 'Cab 3')
    await expect(card).toBeVisible()

    // Thomas defines exactly 4 functions (LIGHT/HORN/*WHISTLE/BELL) — F4 must not appear.
    await expect(card.getByRole('button', { name: 'LIGHT', exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: 'BELL', exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: 'F4', exact: true })).toHaveCount(0)
})

test('a freeform address loco shows the full generic F0-F28 grid', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await addFreeform(page, '99')
    const card = cardFor(page, 'Cab 99')
    await expect(card).toBeVisible()

    await expect(card.getByRole('button', { name: 'F0', exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: 'F28', exact: true })).toBeVisible()
})

test('toggling a latching function updates immediately (optimistic local state)', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await addFromRoster(page, 'Thomas (3)')
    const card = cardFor(page, 'Cab 3')
    await expect(card).toBeVisible()

    const lightButton = card.getByRole('button', { name: 'LIGHT', exact: true })
    await expect(lightButton).not.toHaveClass(/e-active/)
    await lightButton.click()
    await expect(lightButton).toHaveClass(/e-active/)
    await lightButton.click()
    await expect(lightButton).not.toHaveClass(/e-active/)
})

test('a momentary function activates on press and deactivates on release', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await addFromRoster(page, 'Thomas (3)')
    const card = cardFor(page, 'Cab 3')
    await expect(card).toBeVisible()

    // F2 = *WHISTLE (momentary)
    const whistleButton = card.getByRole('button', { name: 'WHISTLE', exact: true })
    await whistleButton.hover()
    await page.mouse.down()
    await expect(whistleButton).toHaveClass(/e-active/)
    await page.mouse.up()
    await expect(whistleButton).not.toHaveClass(/e-active/)
})

test('direction buttons update the highlighted state, and the speed stepper mirrors Stop', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await addFromRoster(page, 'Percy (5)')
    const card = cardFor(page, 'Cab 5')
    await expect(card).toBeVisible()

    const fwdButton = card.getByRole('button', { name: 'Fwd ▶' })
    const revButton = card.getByRole('button', { name: '◀ Rev' })
    // Cards default to forward.
    await expect(fwdButton).toHaveClass(/bg-blue-600/)

    await revButton.click()
    await expect(revButton).toHaveClass(/bg-blue-600/)
    await expect(fwdButton).not.toHaveClass(/bg-blue-600/)

    const speedStepper = card.getByRole('spinbutton').first()
    await speedStepper.fill('50')
    await speedStepper.press('Tab')
    await expect(speedStepper).toHaveValue('50')

    await card.getByRole('button', { name: 'Stop' }).click()
    // The stepper is polled back into sync with cab.speed every 200ms.
    await expect(speedStepper).toHaveValue('0', { timeout: 2_000 })
})

test('the numeric speed stepper accepts a direct value (128-step range, 0-126)', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await addFromRoster(page, 'Thomas (3)')
    const card = cardFor(page, 'Cab 3')
    await expect(card).toBeVisible()

    const speedStepper = card.getByRole('spinbutton').first()
    await speedStepper.fill('126')
    await speedStepper.press('Tab')
    await expect(speedStepper).toHaveValue('126')
})

test('full screen expands the whole panel (all acquired throttles), not a single card', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await addFromRoster(page, 'Thomas (3)')
    await addFromRoster(page, 'Percy (5)')
    await expect(cardFor(page, 'Cab 3')).toBeVisible()
    await expect(cardFor(page, 'Cab 5')).toBeVisible()

    const panelRoot = page.getByTestId('throttle-panel-root')
    await page.getByTestId('throttle-fullscreen-toggle').click()
    await expect(panelRoot).toHaveClass(/fixed/)
    // Both throttles are still present and visible while full screen.
    await expect(cardFor(page, 'Cab 3')).toBeVisible()
    await expect(cardFor(page, 'Cab 5')).toBeVisible()
    // The toggle also asks the OS window to go native full screen (hides the title bar).
    await expect.poll(() => page.evaluate(() => window.electronWindow.isFullScreen())).toBe(true)

    await page.getByTestId('throttle-fullscreen-toggle').click()
    await expect(panelRoot).not.toHaveClass(/fixed/)
    await expect.poll(() => page.evaluate(() => window.electronWindow.isFullScreen())).toBe(false)
})

test('release (×) asks for confirmation before removing a throttle card', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await addFromRoster(page, 'Percy (5)')
    const card = cardFor(page, 'Cab 5')
    await expect(card).toBeVisible()

    await releaseCard(page, card)
    await expect(card).not.toBeVisible()
    await expect(page.getByText('No throttles yet', { exact: false })).toBeVisible()
})

test('release (×) does nothing if the confirmation is cancelled', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await addFromRoster(page, 'Percy (5)')
    const card = cardFor(page, 'Cab 5')
    await expect(card).toBeVisible()

    await card.getByTestId('throttle-release').click()
    await expect(page.getByText('Release Throttle', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await expect(card).toBeVisible()
})

test('a function changed by another throttle (e.g. WiFi app, JMRI, a physical cab) shows up on our card', async ({ workspacePage: page }) => {
    // DCC-EX only broadcasts <l> in response to a <t> (speed/direction) command —
    // an <F> (function) command from ANOTHER throttle produces no broadcast at
    // all, so this can only be caught by ThrottleService's periodic <t cab> poll
    // (see POLL_INTERVAL_MS in throttle.service.ts). Simulate "another throttle"
    // by sending the raw <F> command through the existing serial-monitor console
    // instead of through our own throttle card — it goes over the exact same
    // (mocked) serial connection, indistinguishable from a real external throttle.
    await openThrottleSection(page)
    await addFromRoster(page, 'Percy (5)')
    const card = cardFor(page, 'Cab 5')
    await expect(card).toBeVisible()

    const hornButton = card.getByRole('button', { name: 'HORN', exact: true })
    await expect(hornButton).not.toHaveClass(/e-active/)

    if (!(await page.getByText('Device Monitor', { exact: true }).isVisible())) {
        await page.getByRole('button', { name: 'Monitor' }).click()
    }
    await expect(page.getByText('Device Monitor', { exact: true })).toBeVisible()

    await page.locator('serial-monitor').click()
    await page.keyboard.type('<F 5 1 1>')
    await page.keyboard.press('Enter')

    // Give the poll cycle (2s) time to run and pull the change back.
    await expect(hornButton).toHaveClass(/e-active/, { timeout: 5_000 })
})

test('track power toggle shows the actual state and requires confirmation only to turn off', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    const powerToggle = page.getByTestId('throttle-power-toggle')

    // The mock command station defaults to power OFF at boot, seeded via the
    // <s> query ThrottleService.initialize() sends — real DCC-EX firmware
    // does the same, so this reflects actual hardware state, not a guess.
    await expect(powerToggle).toContainText('Track Power: OFF', { timeout: 5_000 })

    // OFF -> ON needs no confirmation.
    await powerToggle.click()
    await expect(powerToggle).toContainText('Track Power: ON')

    // ON -> OFF stops every loco on the layout — confirm first.
    await powerToggle.click()
    await expect(page.getByText('Power Off Track', { exact: true })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Power Off', exact: true }).click()
    await expect(powerToggle).toContainText('Track Power: OFF')
})

test('cancelling the power-off confirmation leaves power on', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    const powerToggle = page.getByTestId('throttle-power-toggle')
    await expect(powerToggle).toContainText('Track Power: OFF', { timeout: 5_000 })

    await powerToggle.click()
    await expect(powerToggle).toContainText('Track Power: ON')

    await powerToggle.click()
    await expect(page.getByText('Power Off Track', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(powerToggle).toContainText('Track Power: ON')
})

test('E-Stop All is clickable without raising errors', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await page.getByTestId('throttle-estop-all').click()
    // No assertion beyond "didn't throw" — it's a fire-and-forget serial write.
    await expect(page.getByTestId('throttle-power-toggle')).toBeVisible()
})

/**
 * Turnouts/Routes/Both tabs: MOCK_TURNOUTS_H defines turnouts 200 ("Main Line
 * Junction") and 201 ("Yard Entry"); MOCK_ROUTES_H defines route 1 ("Main
 * Route") as THROW(200)/CLOSE(201) — see fixtures.ts.
 */

function turnoutRow(page: Page, id: number): Locator {
    return page.locator(`[data-testid="turnout-row"][data-turnout-id="${id}"]`)
}

function routeRow(page: Page, id: number): Locator {
    return page.locator(`[data-testid="route-row"][data-route-id="${id}"]`)
}

test('tab switching works while full screen — never leaves full screen or the throttle section', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    const panelRoot = page.getByTestId('throttle-panel-root')

    await page.getByTestId('throttle-fullscreen-toggle').click()
    await expect(panelRoot).toHaveClass(/fixed/)

    for (const tab of ['turnouts-routes', 'throttles'] as const) {
        await page.getByTestId(`throttle-tab-${tab}`).click()
        await expect(panelRoot).toHaveClass(/fixed/)
        await expect.poll(() => page.evaluate(() => window.electronWindow.isFullScreen())).toBe(true)
    }

    await expect(turnoutRow(page, 200)).toHaveCount(0) // Throttles tab active again — turnouts-view unmounted
    await page.getByTestId('throttle-fullscreen-toggle').click()
    await expect(panelRoot).not.toHaveClass(/fixed/)
})

test('Turnouts/Routes tab shows Routes above Turnouts, each under its own label', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await page.getByTestId('throttle-tab-turnouts-routes').click()

    await expect(page.getByTestId('routes-section-label')).toBeVisible()
    await expect(page.getByTestId('turnouts-section-label')).toBeVisible()
    await expect(routeRow(page, 1)).toBeVisible()
    await expect(turnoutRow(page, 200)).toBeVisible()

    const routesLabelBox = await page.getByTestId('routes-section-label').boundingBox()
    const turnoutsLabelBox = await page.getByTestId('turnouts-section-label').boundingBox()
    const routeRowBox = await routeRow(page, 1).boundingBox()
    const turnoutRowBox = await turnoutRow(page, 200).boundingBox()
    expect(routesLabelBox).not.toBeNull()
    expect(turnoutsLabelBox).not.toBeNull()
    // Routes label, then route rows, then Turnouts label, then turnout rows — in that vertical order.
    expect(routesLabelBox!.y).toBeLessThan(routeRowBox!.y)
    expect(routeRowBox!.y).toBeLessThan(turnoutsLabelBox!.y)
    expect(turnoutsLabelBox!.y).toBeLessThan(turnoutRowBox!.y)
})

test('Turnouts/Routes tab: turnout starts Unknown, and the toggle button drives the mock device', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await page.getByTestId('throttle-tab-turnouts-routes').click()

    await expect(turnoutRow(page, 200)).toContainText('Main Line Junction')
    await expect(turnoutRow(page, 200)).toHaveAttribute('data-state', 'UNKNOWN')

    await turnoutRow(page, 200).getByTestId('turnout-toggle-button').click() // Unknown -> Thrown
    await expect(turnoutRow(page, 200)).toHaveAttribute('data-state', 'THROWN', { timeout: 5_000 })

    await turnoutRow(page, 200).getByTestId('turnout-toggle-button').click() // Thrown -> Closed
    await expect(turnoutRow(page, 200)).toHaveAttribute('data-state', 'CLOSED', { timeout: 5_000 })
})

test('Turnouts/Routes tab: route status reflects the live states of the turnouts it references', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await page.getByTestId('throttle-tab-turnouts-routes').click()

    // Drive turnout 201 to CLOSED (matches route's CLOSE(201)) and
    // 200 to THROWN (matches route's THROW(200)) so the route becomes MATCHED.
    await turnoutRow(page, 201).getByTestId('turnout-toggle-button').click() // Unknown -> Thrown
    await turnoutRow(page, 201).getByTestId('turnout-toggle-button').click() // Thrown -> Closed
    await expect(turnoutRow(page, 201)).toHaveAttribute('data-state', 'CLOSED', { timeout: 5_000 })
    await turnoutRow(page, 200).getByTestId('turnout-toggle-button').click() // Unknown -> Thrown
    await expect(turnoutRow(page, 200)).toHaveAttribute('data-state', 'THROWN', { timeout: 5_000 })

    await expect(routeRow(page, 1)).toContainText('Main Route')
    const badge = routeRow(page, 1).getByTestId('route-status-badge')
    await expect(badge).toHaveAttribute('data-status', 'MATCHED', { timeout: 5_000 })
    await expect(badge).toHaveText('Active')

    // Flip turnout 200 to CLOSED — now mismatches the route's THROW(200).
    await turnoutRow(page, 200).getByTestId('turnout-toggle-button').click() // Thrown -> Closed
    await expect(turnoutRow(page, 200)).toHaveAttribute('data-state', 'CLOSED', { timeout: 5_000 })
    await expect(badge).toHaveAttribute('data-status', 'MISMATCHED', { timeout: 5_000 })
    await expect(badge).toHaveText('Inactive')
})

test('Turnouts/Routes tab: Trigger button actually sets the turnouts the route references (mock has no EXRAIL interpreter)', async ({ workspacePage: page }) => {
    await openThrottleSection(page)
    await page.getByTestId('throttle-tab-turnouts-routes').click()

    const badge = routeRow(page, 1).getByTestId('route-status-badge')
    await expect(badge).toHaveAttribute('data-status', 'UNKNOWN')

    // Route 1 is THROW(200)/CLOSE(201) — see MOCK_ROUTES_H in fixtures.ts.
    await routeRow(page, 1).getByTestId('route-trigger-button').click()
    await expect(badge).toHaveAttribute('data-status', 'MATCHED', { timeout: 5_000 })
    await expect(badge).toHaveText('Active')

    await expect(turnoutRow(page, 200)).toHaveAttribute('data-state', 'THROWN', { timeout: 5_000 })
    await expect(turnoutRow(page, 201)).toHaveAttribute('data-state', 'CLOSED', { timeout: 5_000 })
})
