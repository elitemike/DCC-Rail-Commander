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
