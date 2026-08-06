/**
 * E2E tests: Servo calibration modal — live drag preview, swap, and Save
 * writing the accepted positions back into myTurnouts.h.
 *
 * Uses the mock serial transport (src/main/mock-serial-transport.ts) so
 * usb:open-port / usb:write-to-port round trips work under --mock-device
 * without real hardware.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Servo Calibration"
 */

import { test, expect } from './fixtures'

// ── Helpers ─────────────────────────────────────────────────────────────────

async function openTurnoutEditor(page: import('@playwright/test').Page) {
    await page.getByText('Turnouts', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function switchToRaw(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
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
        return lines.map(l => (l.textContent ?? '').replace(/ /g, ' ')).join('\n')
    })
}

/** Subscribes to window.usb.onData BEFORE the dialog opens, so live-move round trips can be asserted. */
async function trackServoEvents(page: import('@playwright/test').Page) {
    await page.evaluate(() => {
        ; (window as unknown as { __servoEvents: string[] }).__servoEvents = []
        window.usb.onData(({ data }) => {
            ; (window as unknown as { __servoEvents: string[] }).__servoEvents.push(data)
        })
    })
}

async function getServoEvents(page: import('@playwright/test').Page): Promise<string[]> {
    return page.evaluate(() => (window as unknown as { __servoEvents: string[] }).__servoEvents ?? [])
}

async function openCalibrationDialog(page: import('@playwright/test').Page) {
    await openTurnoutEditor(page)
    await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction' }).click()
    await page.getByRole('button', { name: 'Calibrate Servo…' }).click()
    await expect(dialog(page).getByText('Calibrate Servo', { exact: true })).toBeVisible()
}

/** @aurelia/dialog wraps the au-dialog element with role="dialog" — scope all interactions to it, since the page also has an unrelated top-bar "Save" button. */
function dialog(page: import('@playwright/test').Page) {
    return page.getByRole('dialog')
}

function numericInput(page: import('@playwright/test').Page, label: string) {
    return dialog(page)
        .locator('label', { hasText: label })
        .locator('..')
        .locator('input.e-numerictextbox')
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Servo Calibration', () => {
    test('opens with the seeded turnout values and a visible range slider', async ({ workspacePage: page }) => {
        await openCalibrationDialog(page)

        await expect(dialog(page).locator('.e-slider')).toBeVisible()
        await expect(numericInput(page, 'Closed position')).toHaveValue('205')
        await expect(numericInput(page, 'Thrown position')).toHaveValue('410')
    })

    test('editing the thrown position sends a live move command through the mock transport', async ({ workspacePage: page }) => {
        await trackServoEvents(page)
        await openCalibrationDialog(page)
        await expect(dialog(page).getByText('Connected', { exact: false })).toBeVisible({ timeout: 5_000 })

        const thrownInput = numericInput(page, 'Thrown position')
        await thrownInput.fill('300')
        await thrownInput.press('Tab')

        // Debounce is ~220ms; give it room plus the mock transport's own delay.
        await expect(async () => {
            const events = await getServoEvents(page)
            expect(events.some(e => e.includes('SERVO 25 300'))).toBe(true)
        }).toPass({ timeout: 3_000 })
    })

    test('unchecking live update queues changes for a manual "Move Servo" send', async ({ workspacePage: page }) => {
        await trackServoEvents(page)
        await openCalibrationDialog(page)
        await expect(dialog(page).getByText('Connected', { exact: false })).toBeVisible({ timeout: 5_000 })

        const liveUpdateCheckbox = dialog(page)
            .locator('label', { hasText: 'Live update while dragging' })
            .locator('input[type="checkbox"]')
        await expect(liveUpdateCheckbox).toBeChecked()
        await liveUpdateCheckbox.uncheck({ force: true })

        const moveButton = dialog(page).getByRole('button', { name: 'Move Servo' })
        await expect(moveButton).toBeDisabled()

        const thrownInput = numericInput(page, 'Thrown position')
        await thrownInput.fill('320')
        await thrownInput.press('Tab')

        // Give the (now-disabled) debounce window time to pass — nothing should have been sent.
        await page.waitForTimeout(500)
        let events = await getServoEvents(page)
        expect(events.some(e => e.includes('SERVO'))).toBe(false)
        await expect(moveButton).toBeEnabled()

        await moveButton.click()
        await expect(async () => {
            events = await getServoEvents(page)
            expect(events.some(e => e.includes('SERVO 25 320'))).toBe(true)
        }).toPass({ timeout: 3_000 })
        await expect(moveButton).toBeDisabled()
    })

    test('Close/Mid/Throw quick-test buttons send fixed live move commands using the selected profile', async ({ workspacePage: page }) => {
        await openCalibrationDialog(page)
        await expect(dialog(page).getByText('Connected', { exact: false })).toBeVisible({ timeout: 5_000 })

        // Seeded turnout: closed=205, thrown=410, profile=Slow (3) -> mid = round((205+410)/2) = 308.
        // Asserted against the dialog's own "Last sent" readout (the mock transport's echoed
        // response strips the profile digit, so it can't be used to verify this — see
        // mock-serial-transport.ts's `_synthesizeResponse`).
        const lastSent = dialog(page).getByText('Last sent:')

        await dialog(page).getByRole('button', { name: 'Close', exact: true }).click()
        await expect(lastSent).toContainText('<D SERVO 25 205 3>')

        await dialog(page).getByRole('button', { name: 'Mid', exact: true }).click()
        await expect(lastSent).toContainText('<D SERVO 25 308 3>')

        await dialog(page).getByRole('button', { name: 'Throw', exact: true }).click()
        await expect(lastSent).toContainText('<D SERVO 25 410 3>')

        // None of these change the calibrated endpoints themselves.
        await expect(numericInput(page, 'Closed position')).toHaveValue('205')
        await expect(numericInput(page, 'Thrown position')).toHaveValue('410')
    })

    test('changing the profile changes what the test-move buttons send', async ({ workspacePage: page }) => {
        await openCalibrationDialog(page)
        await expect(dialog(page).getByText('Connected', { exact: false })).toBeVisible({ timeout: 5_000 })

        const profileSelect = dialog(page).locator('select')
        await profileSelect.selectOption('Bounce')

        await dialog(page).getByRole('button', { name: 'Close', exact: true }).click()
        await expect(dialog(page).getByText('Last sent:')).toContainText('<D SERVO 25 205 4>')
    })

    test('dragging/typing still moves the servo instantly regardless of the selected profile', async ({ workspacePage: page }) => {
        await openCalibrationDialog(page)
        await expect(dialog(page).getByText('Connected', { exact: false })).toBeVisible({ timeout: 5_000 })

        const profileSelect = dialog(page).locator('select')
        await profileSelect.selectOption('Bounce')

        const thrownInput = numericInput(page, 'Thrown position')
        await thrownInput.fill('300')
        await thrownInput.press('Tab')

        await expect(dialog(page).getByText('Last sent:')).toContainText('<D SERVO 25 300 0>', { timeout: 3_000 })
    })

    test('Close/Mid/Throw buttons are disabled when no device is connected', async ({ electronApp, workspacePage: page }) => {
        // Force usb:open-port to fail so the dialog lands on portStatus 'error'
        // (mirrors what happens when the real port can't be opened).
        await electronApp.evaluate((_electronApp) => {
            const { ipcMain } = (globalThis as Record<string, NodeRequire>).__e2eRequire('electron') as typeof import('electron')
            ipcMain.removeHandler('usb:open-port')
            ipcMain.handle('usb:open-port', () => {
                throw new Error('forced failure for test')
            })
        })

        await openTurnoutEditor(page)
        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction' }).click()
        await page.getByRole('button', { name: 'Calibrate Servo…' }).click()
        await expect(dialog(page).getByText('Calibrate Servo', { exact: true })).toBeVisible()
        await expect(dialog(page).getByText('Could not connect', { exact: false })).toBeVisible({ timeout: 5_000 })

        await expect(dialog(page).getByRole('button', { name: 'Close', exact: true })).toBeDisabled()
        await expect(dialog(page).getByRole('button', { name: 'Mid', exact: true })).toBeDisabled()
        await expect(dialog(page).getByRole('button', { name: 'Throw', exact: true })).toBeDisabled()
    })

    test('swap exchanges the two values without sending a live move', async ({ workspacePage: page }) => {
        await trackServoEvents(page)
        await openCalibrationDialog(page)
        await expect(dialog(page).getByText('Connected', { exact: false })).toBeVisible({ timeout: 5_000 })

        await dialog(page).getByRole('button', { name: 'Swap' }).click()

        await expect(numericInput(page, 'Closed position')).toHaveValue('410')
        await expect(numericInput(page, 'Thrown position')).toHaveValue('205')

        // Give any (unwanted) debounced command time to fire, then assert none did.
        await page.waitForTimeout(500)
        const events = await getServoEvents(page)
        expect(events.some(e => e.includes('SERVO'))).toBe(false)
    })

    test('save writes the updated positions back into myTurnouts.h', async ({ workspacePage: page }) => {
        await openCalibrationDialog(page)

        await dialog(page).getByRole('button', { name: 'Swap' }).click()
        await dialog(page).getByRole('button', { name: 'Save' }).click()

        await expect(dialog(page)).not.toBeVisible()

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('SERVO_TURNOUT(200, 25, 205, 410')
    })

    test('cancel discards changes and leaves myTurnouts.h unchanged', async ({ workspacePage: page }) => {
        await openCalibrationDialog(page)

        const thrownInput = numericInput(page, 'Thrown position')
        await thrownInput.fill('300')
        await thrownInput.press('Tab')

        await dialog(page).getByRole('button', { name: 'Cancel' }).click()
        await expect(dialog(page)).not.toBeVisible()

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('SERVO_TURNOUT(200, 25, 410, 205')
        const content = await getMonacoContent(page)
        expect(content).not.toContain('SERVO_TURNOUT(200, 25, 300')
    })

    test('clicking "Add new turnout" opens the calibration modal immediately', async ({ workspacePage: page }) => {
        await openTurnoutEditor(page)

        await page.getByTitle('Add new turnout').click()

        await expect(dialog(page).getByText('Calibrate Servo', { exact: true })).toBeVisible()
        // New entries default to activeAngle 400 / inactiveAngle 100.
        await expect(numericInput(page, 'Closed position')).toHaveValue('100')
        await expect(numericInput(page, 'Thrown position')).toHaveValue('400')

        // Save should commit the new turnout's (unmodified) defaults into myTurnouts.h.
        await dialog(page).getByRole('button', { name: 'Save' }).click()
        await expect(dialog(page)).not.toBeVisible()

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('SERVO_TURNOUT(')
        await expect(page.locator('div.monaco-editor')).toContainText('New Turnout')
    })
})
