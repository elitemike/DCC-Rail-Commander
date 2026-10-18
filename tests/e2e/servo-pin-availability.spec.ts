/**
 * E2E tests: adding a new servo turnout — the Select Pin popup only offers
 * board channels that no turnout/sensor/signal has claimed yet, and picking a
 * board auto-selects the first free channel on it.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Servo pin availability"
 */

import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'


const hal = (page: Page) => page.locator('hal-devices-form')

async function addPca9685Board(page: Page) {
    await page.getByText('Accessories', { exact: true }).first().click()
    await expect(hal(page)).toBeVisible()
    const rowsBefore = await hal(page).locator('[data-board-id="pca9685_sh"]').count()
    await hal(page).locator('select').first().selectOption({ label: 'PCA9685' })
    await hal(page).getByRole('button', { name: 'Add Board' }).click()
    await expect(hal(page).locator('[data-board-id="pca9685_sh"]')).toHaveCount(rowsBefore + 1)
}

/** Opens the Add Turnout flow (Servo kind) up to the Select Pin popup and returns the dialog. */
async function openSelectPin(page: Page) {
    await page.getByText('Turnouts', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
    await page.getByTitle('Add new turnout').click()

    // The native <dialog> specifically — the turnout tree's Syncfusion ContextMenu also puts a
    // role="dialog" wrapper in the DOM, so a bare getByRole('dialog') is ambiguous here.
    const dialog = page.locator('dialog[open]')
    await expect(dialog.getByRole('heading', { name: 'New Turnout' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Continue' }).click()
    await expect(dialog.getByText('Select Pin', { exact: true })).toBeVisible()
    return dialog
}

/** Picks the board at `boardIndex` (0-based; boards are listed first on an EX-CSB1) and finishes the add flow. */
async function addServoOnBoard(page: Page, boardIndex: number) {
    const dialog = await openSelectPin(page)
    await dialog.locator('[data-field="pin-source"]').selectOption({ index: boardIndex })
    await dialog.getByRole('button', { name: 'Continue' }).click()
    await expect(dialog.getByText('Calibrate Servo', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).not.toBeVisible()
}

const channelOptionTexts = (dialog: ReturnType<Page['getByRole']>) =>
    dialog.locator('[data-field="pin-channel"] option').allTextContents()

test.describe('Servo pin availability — new servo turnout', () => {
    test('picking a board auto-selects its first channel when none are used', async ({ csb1StackedPage }) => {
        const page = csb1StackedPage
        await addPca9685Board(page)

        const dialog = await openSelectPin(page)
        await dialog.locator('[data-field="pin-source"]').selectOption({ index: 0 })

        await expect(dialog.locator('[data-field="pin-channel"] option')).toHaveCount(16)
        await expect(dialog.locator('[data-field="pin-channel"] option:checked')).toHaveText('Ch 1')
        await expect(dialog).toContainText('VPin 100')
    })

    test('already-assigned channels are hidden and the next free one is auto-selected', async ({ csb1StackedPage }) => {
        const page = csb1StackedPage
        await addPca9685Board(page)

        // Claim channels 1 and 2 (VPins 100 and 101), one turnout at a time.
        await addServoOnBoard(page, 0)
        await addServoOnBoard(page, 0)

        const dialog = await openSelectPin(page)
        await dialog.locator('[data-field="pin-source"]').selectOption({ index: 0 })

        await expect(dialog.locator('[data-field="pin-channel"] option')).toHaveCount(14)
        const options = await channelOptionTexts(dialog)
        expect(options).not.toContain('Ch 1')
        expect(options).not.toContain('Ch 2')
        await expect(dialog.locator('[data-field="pin-channel"] option:checked')).toHaveText('Ch 3')
        await expect(dialog).toContainText('VPin 102')
    })

    test('availability is per selected board — a second board still offers all of its channels', async ({ csb1StackedPage }) => {
        const page = csb1StackedPage
        await addPca9685Board(page)
        await addPca9685Board(page)

        // Use up channel 1 of the first board only.
        await addServoOnBoard(page, 0)

        const dialog = await openSelectPin(page)
        const source = dialog.locator('[data-field="pin-source"]')

        await source.selectOption({ index: 0 })
        await expect(dialog.locator('[data-field="pin-channel"] option')).toHaveCount(15)
        await expect(dialog.locator('[data-field="pin-channel"] option:checked')).toHaveText('Ch 2')

        await source.selectOption({ index: 1 })
        await expect(dialog.locator('[data-field="pin-channel"] option')).toHaveCount(16)
        await expect(dialog.locator('[data-field="pin-channel"] option:checked')).toHaveText('Ch 1')
    })

    test('on an EX-CSB1 the boards are listed first, Direct MCU pin is omitted, and the first board is pre-selected', async ({ csb1StackedPage }) => {
        const page = csb1StackedPage
        await addPca9685Board(page)

        const dialog = await openSelectPin(page)
        const source = dialog.locator('[data-field="pin-source"]')

        await expect(source.locator('option')).toHaveCount(1)
        await expect(source.locator('option').first()).toHaveText(/PCA9685/)
        await expect(source.locator('option:checked')).toHaveText(/PCA9685/)
        await expect(dialog.locator('[data-field="pin-value"]')).toHaveCount(0)
        await expect(dialog.locator('[data-field="pin-channel"] option:checked')).toHaveText('Ch 1')
        await expect(dialog).toContainText('VPin 100')
    })

    test('on an EX-CSB1 with no servo board, adding a servo prompts for one and can jump to Accessories', async ({ csb1StackedPage }) => {
        const page = csb1StackedPage
        await page.getByText('Turnouts', { exact: true }).first().click()
        await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
        await page.getByTitle('Add new turnout').click()
        await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click()

        const prompt = page.getByTestId('confirm-dialog')
        await expect(prompt).toContainText('Servo board required')
        await expect(prompt).toContainText('PCA9685')
        // No pin picker is shown, and no turnout is created behind the prompt.
        await expect(page.locator('[data-field="pin-source"]')).toHaveCount(0)

        await prompt.getByRole('button', { name: 'Go to Accessories' }).click()
        await expect(page.locator('hal-devices-form')).toBeVisible()
        await expect(page.locator('#turnout-treeview li.e-list-item', { hasText: 'New Turnout' })).toHaveCount(0)
    })

    test('cancelling the servo-board prompt stays on Turnouts without adding anything', async ({ csb1StackedPage }) => {
        const page = csb1StackedPage
        await page.getByText('Turnouts', { exact: true }).first().click()
        await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
        await page.getByTitle('Add new turnout').click()
        await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click()

        const prompt = page.getByTestId('confirm-dialog')
        await expect(prompt).toContainText('Servo board required')
        await prompt.getByRole('button', { name: 'Cancel' }).click()

        await expect(prompt).not.toBeVisible()
        await expect(page.locator('hal-devices-form')).toHaveCount(0)
        await expect(page.locator('#turnout-treeview li.e-list-item', { hasText: 'New Turnout' })).toHaveCount(0)
    })

    test('on a non-CSB1 board Direct MCU pin stays available and listed first', async ({ workspacePage }) => {
        const page = workspacePage
        await addPca9685Board(page)

        const dialog = await openSelectPin(page)
        const options = dialog.locator('[data-field="pin-source"] option')
        await expect(options).toHaveCount(2)
        await expect(options.first()).toHaveText('Direct MCU pin')
    })

    test('a board with every channel used reports no free pins', async ({ csb1StackedPage }) => {
        const page = csb1StackedPage
        await addPca9685Board(page)

        for (let i = 0; i < 16; i++) await addServoOnBoard(page, 0)

        const dialog = await openSelectPin(page)
        await dialog.locator('[data-field="pin-source"]').selectOption({ index: 0 })
        await expect(dialog.locator('[data-field="pin-none-free"]')).toBeVisible()
        await expect(dialog.locator('[data-field="pin-channel"] option')).toHaveCount(0)
    })
})
