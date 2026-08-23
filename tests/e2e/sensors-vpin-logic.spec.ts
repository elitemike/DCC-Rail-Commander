/**
 * E2E tests: Sensors editor — VPin allocation logic.
 *
 * sensors-editor.spec.ts already covers the basic visual/raw round-trip and the
 * myAliases.h alias-picker in depth. This file targets separate logic that has no
 * existing coverage: ConfigEditorState.nextFreeVpin (a new sensor's pin defaults to
 * the first free VPin at/after 100, re-scanning from 100 every time — see
 * findNextFreeVpin in src/renderer/src/config/hal-devices.ts) and the shared
 * <vpin-picker> component's board+channel mode (used by turnouts/signals too, but
 * never exercised through the Sensors editor).
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Sensors VPin logic"
 */

import { test, expect } from './fixtures'

// ── Helpers ─────────────────────────────────────────────────────────────────

async function openSensorsEditor(page: import('@playwright/test').Page) {
    await page.getByText('Sensors', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function switchToRaw(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
    await page.waitForTimeout(400)
}

function sensorRows(page: import('@playwright/test').Page) {
    return page.locator('sensors-editor .flex.items-end.gap-3')
}

async function addSensor(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Add Sensor' }).click()
}

// ── Tests: nextFreeVpin ──────────────────────────────────────────────────────

test.describe('Sensors VPin logic', () => {
    test('a new sensor defaults its pin to VPin 100, and a second defaults to the next free one', async ({ workspacePage: page }) => {
        await openSensorsEditor(page)

        await addSensor(page)
        const firstRow = sensorRows(page).first()
        await expect(firstRow.locator('[data-field="pin-value"]')).toHaveValue('100')

        await addSensor(page)
        const secondRow = sensorRows(page).nth(1)
        await expect(secondRow.locator('[data-field="pin-value"]')).toHaveValue('101')
    })

    test('moving a sensor off its default VPin frees it for the next new sensor', async ({ workspacePage: page }) => {
        await openSensorsEditor(page)
        await addSensor(page)
        await addSensor(page)

        // Move the first sensor (default VPin 100) out of the way.
        const firstRow = sensorRows(page).first()
        const pinInput = firstRow.locator('[data-field="pin-value"]')
        await pinInput.fill('150')
        await pinInput.blur()
        await expect(pinInput).toHaveValue('150')

        // findNextFreeVpin always rescans from 100 — VPin 100 is free again, and is
        // lower than the second sensor's 101, so the third sensor lands back on 100.
        await addSensor(page)
        const thirdRow = sensorRows(page).nth(2)
        await expect(thirdRow.locator('[data-field="pin-value"]')).toHaveValue('100')

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('SENSOR(1, 150')
        await expect(page.locator('div.monaco-editor')).toContainText('SENSOR(2, 101')
        await expect(page.locator('div.monaco-editor')).toContainText('SENSOR(3, 100')
    })
})

// ── Tests: <vpin-picker> HAL board/channel mode ──────────────────────────────

// "Accessories" is a Device Settings tree child row (expanded by default),
// reachable directly without visiting General + WiFi first.
async function openAccessoriesTab(page: import('@playwright/test').Page) {
    await page.getByText('Accessories', { exact: true }).first().click()
    await expect(page.locator('hal-devices-form')).toBeVisible()
}

/** Adds a PCA9685 board (defaults to address 0x40, VPin 100) and returns once its row is visible. */
async function addPca9685(page: import('@playwright/test').Page) {
    await page.locator('hal-devices-form select').first().selectOption({ label: 'PCA9685' })
    await page.locator('hal-devices-form').getByRole('button', { name: 'Add Board' }).click()
    const deviceRow = page.locator('hal-devices-form [data-board-id="pca9685_sh"]')
    await expect(deviceRow).toBeVisible()
    return deviceRow
}

test.describe('Sensors VPin logic — HAL board channel', () => {
    test('picking a HAL board + channel for a sensor computes its VPin, not a raw number', async ({ csb1StackedPage }) => {
        const page = csb1StackedPage

        await openAccessoriesTab(page)
        const deviceRow = await addPca9685(page)
        await expect(deviceRow.locator('[data-field="vpinStart"]')).toHaveValue('100')

        await openSensorsEditor(page)
        await addSensor(page)
        const row = sensorRows(page).first()

        // Sensors editor's <vpin-picker> is unrestricted by `role`, so a servo-role
        // board (PCA9685) still shows up here — there's only one HAL device configured,
        // so "the second <option>, after Direct MCU pin" unambiguously selects it without
        // depending on the exact label text vpin-picker renders for it.
        await row.locator('[data-field="pin-source"]').selectOption({ index: 1 })
        await row.locator('[data-field="pin-channel"]').selectOption({ label: 'Ch 3' })

        // Channel 3 of a board starting at VPin 100 is VPin 102 (1-based channel numbering).
        await expect(row.getByText('VPin 102', { exact: true })).toBeVisible()

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('SENSOR(1, 102')
    })
})
