/**
 * "Setup New Device" wizard — this app version only supports EX-CommandStation,
 * so the wizard has no product-selection step (see device-wizard.ts/.html).
 */

import { test, expect } from './fixtures'

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

    // The stacked-motor-shield option must be visible without scrolling the
    // step container (the whole point of the dialog height bump).
    const container = page.locator('div.overflow-y-auto').first()
    const containerBox = await container.boundingBox()
    const labelBox = await shieldLabel.boundingBox()
    expect(containerBox).not.toBeNull()
    expect(labelBox).not.toBeNull()
    expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(containerBox!.y + containerBox!.height + 1)
})
