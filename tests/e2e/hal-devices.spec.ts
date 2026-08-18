/**
 * E2E test: Accessories tab (Device Settings) for EX-CommandStation.
 *
 * Adds an RT I2C Isolated Multiplexer and an RT DCD-16 Block Sensor behind
 * one of its channels, then confirms the generated myAutomation.h HAL Devices
 * block matches the DCC-EX HAL() macro syntax from the vendor manuals
 * (rosscoe.com/Documents/RT_DCD_16_operation_manual.pdf,
 * RT_I2C_ISO_MUX_operation_manual.pdf) — see hal-devices.ts.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Accessories"
 */

import { test, expect } from './fixtures'

async function openDeviceSettings(page: import('@playwright/test').Page) {
    await page.getByText('Device Settings', { exact: true }).first().click()
    await expect(page.locator('config-h-editor')).toBeVisible()
}

async function openAccessoriesTab(page: import('@playwright/test').Page) {
    await page.locator('commandstation-config-form').getByRole('button', { name: 'Accessories' }).click()
    await expect(page.locator('hal-devices-form')).toBeVisible()
}

async function openAutomationRaw(page: import('@playwright/test').Page) {
    await page.getByText('Automation', { exact: true }).first().click()
    await expect(page.locator('automation-editor')).toBeVisible()
    await page.waitForTimeout(300)
    await page.locator('automation-editor').getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('automation-editor div.monaco-editor')).toBeVisible()
    await page.waitForTimeout(300)
}

test.describe('Accessories — HAL Devices', () => {
    test('adding a multiplexer and a block sensor behind it generates the correct HAL() lines', async ({ csb1StackedPage }) => {
        const page = csb1StackedPage

        await openDeviceSettings(page)
        await openAccessoriesTab(page)

        // Add the multiplexer first, set its address to 0x71 (avoids the
        // 0x70 PCA9685 broadcast default per the RT_I2C_ISO_MUX manual).
        await page.locator('hal-devices-form select').first().selectOption({ label: 'RT I2C Isolated Multiplexer' })
        await page.locator('hal-devices-form').getByRole('button', { name: 'Add Board' }).click()

        const muxRow = page.locator('hal-devices-form [data-board-id="rt_i2c_iso_mux"]')
        await expect(muxRow).toBeVisible()
        await muxRow.locator('[data-field="address"]').selectOption({ label: '0x71' })

        // Add an RT DCD-16 behind the multiplexer, channel 2.
        await page.locator('hal-devices-form select').first().selectOption({ label: 'RT DCD-16 Block Sensor' })
        await page.locator('hal-devices-form').getByRole('button', { name: 'Add Board' }).click()

        const sensorRow = page.locator('hal-devices-form [data-board-id="rt_dcd_16"]')
        await expect(sensorRow).toBeVisible()
        await sensorRow.locator('[data-field="parentMux"]').selectOption({ label: 'RT I2C Isolated Multiplexer' })
        await sensorRow.locator('[data-field="muxChannel"]').selectOption({ label: '2' })

        const vpinStart = await sensorRow.locator('[data-field="vpinStart"]').inputValue()

        await openAutomationRaw(page)

        // Multiplexer itself: comment-only, no HAL() call (auto-detected by DCC-EX from its address).
        await expect(page.locator('automation-editor div.monaco-editor'))
            .toContainText('HAL-MUX(board=rt_i2c_iso_mux, address=0x71')
        await expect(page.locator('automation-editor div.monaco-editor'))
            .not.toContainText('HAL(MULTIPLEXER')

        // RT DCD-16 behind the mux: I2CMux_1 (0x71 - 0x70 = 1), SubBus_2, default address 0x20.
        await expect(page.locator('automation-editor div.monaco-editor'))
            .toContainText(`HAL(PCA9555, ${vpinStart}, 16, {I2CMux_1, SubBus_2, 0x20})`)
    })
})

/** Adds a PCA9685 board (defaults to address 0x40, VPin 100) and returns once its row is visible. */
async function addPca9685(page: import('@playwright/test').Page) {
    await page.locator('hal-devices-form select').first().selectOption({ label: 'PCA9685' })
    await page.locator('hal-devices-form').getByRole('button', { name: 'Add Board' }).click()
    const deviceRow = page.locator('hal-devices-form [data-board-id="pca9685_sh"]')
    await expect(deviceRow).toBeVisible()
    return deviceRow
}

/** Adds a new (always-SERVO) turnout, picks the given board's channel 1 in the pin-select popup, then saves calibration unchanged. */
async function addTurnoutOnBoardChannel(page: import('@playwright/test').Page, boardOptionLabel: string) {
    await page.getByText('Turnouts', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
    await page.getByTitle('Add new turnout').click()

    const pinDialog = page.getByRole('dialog')
    await expect(pinDialog.getByText('Select Pin', { exact: true })).toBeVisible()
    await pinDialog.locator('[data-field="pin-source"]').selectOption({ label: boardOptionLabel })
    await pinDialog.getByRole('button', { name: 'Continue' }).click()

    await expect(pinDialog.getByText('Calibrate Servo', { exact: true })).toBeVisible()
    await pinDialog.getByRole('button', { name: 'Save' }).click()
    await expect(pinDialog).not.toBeVisible()
}

test.describe('Accessories — free-entry I2C address field', () => {
    test('accepts a hex address, generates it in the HAL() line, and reverts an out-of-range entry', async ({ csb1StackedPage }) => {
        const page = csb1StackedPage

        await openDeviceSettings(page)
        await openAccessoriesTab(page)
        const deviceRow = await addPca9685(page)

        const addressField = deviceRow.locator('[data-field="address"]')
        await expect(addressField).toHaveValue('0x40')

        // Typing another in-range hex address commits on blur.
        await addressField.fill('0x41')
        await addressField.blur()
        await expect(addressField).toHaveValue('0x41')

        await openAutomationRaw(page)
        await expect(page.locator('automation-editor div.monaco-editor')).toContainText('HAL(PCA9685, 100, 16, 0x41)')

        // Out-of-range entry (PCA9685 range is 0x40-0x7f) is rejected and reverts to the last valid value.
        await openDeviceSettings(page)
        await openAccessoriesTab(page)
        const deviceRowAgain = page.locator('hal-devices-form [data-board-id="pca9685_sh"]')
        const addressFieldAgain = deviceRowAgain.locator('[data-field="address"]')
        await addressFieldAgain.fill('0x99')
        await addressFieldAgain.blur()
        await expect(addressFieldAgain).toHaveValue('0x41')
    })
})

test.describe('Accessories — VPin conflicts with consumers', () => {
    test('a turnout using a HAL board\'s own channel does not trigger a false VPin overlap warning', async ({ csb1StackedPage }) => {
        const page = csb1StackedPage

        await openDeviceSettings(page)
        await openAccessoriesTab(page)
        const deviceRow = await addPca9685(page)
        await expect(deviceRow.locator('[data-field="vpinStart"]')).toHaveValue('100')

        // Channel 1 of a board starting at VPin 100 is VPin 100 itself.
        await addTurnoutOnBoardChannel(page, 'PCA9685')

        // Back on Accessories, the board's own row must show no conflict warning —
        // the new turnout is legitimately consuming one of its own channels.
        await openDeviceSettings(page)
        await openAccessoriesTab(page)
        await expect(
            page.locator('hal-devices-form [data-board-id="pca9685_sh"]', { hasText: 'VPin range overlaps' }),
        ).toHaveCount(0)
    })

    test('a turnout on a HAL board channel shows the board (not Direct MCU pin) as soon as it is added', async ({ csb1StackedPage }) => {
        const page = csb1StackedPage

        await openDeviceSettings(page)
        await openAccessoriesTab(page)
        await addPca9685(page)

        await addTurnoutOnBoardChannel(page, 'PCA9685')

        // The newly-added turnout is auto-selected right after Save — this is
        // its very first render, which is exactly where the picker previously
        // fell back to showing "Direct MCU pin" instead of the board.
        const pinSourceSelect = page.locator('#turnout-splitter [data-field="pin-source"]')
        await expect(pinSourceSelect).not.toHaveValue('Direct MCU pin')
    })

    test('switching to another turnout and back still shows the board on the pin picker', async ({ csb1StackedPage }) => {
        const page = csb1StackedPage

        await openDeviceSettings(page)
        await openAccessoriesTab(page)
        await addPca9685(page)

        await addTurnoutOnBoardChannel(page, 'PCA9685')

        const pinSourceSelect = page.locator('#turnout-splitter [data-field="pin-source"]')

        // Select a different (seeded, Direct-pin) turnout, then switch back —
        // this reuses the same picker instance (both are SERVO turnouts) and
        // re-derives its source/channel from the newly-bound value.
        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'Main Line Junction' }).click()
        await expect(pinSourceSelect).toHaveValue('Direct MCU pin')

        await page.locator('nav[aria-label="Turnouts"] a', { hasText: 'New Turnout' }).click()
        await expect(pinSourceSelect).not.toHaveValue('Direct MCU pin')
    })
})
