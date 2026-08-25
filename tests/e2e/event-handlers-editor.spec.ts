/**
 * E2E tests: Event Handlers editor — myEvents.h's list+canvas editor for EXRAIL ON* blocks
 * (ONSENSOR, ONACTIVATE, ONRAILSYNCON, ...). Unlike ROUTE/SEQUENCE, an entry has no id/alias/
 * description — the whole on-disk block (header line included) is edited as one unit, and the
 * Add control offers a category-grouped choice of which event-handler command to add, gated by
 * isAvailable() the same way the block palette gates ordinary blocks (see BLOCK_REGISTRY).
 *
 * MOCK_TURNOUTS_H seeds turnouts 200/201 but no sensors, so ONCLOSE/ONTHROW (turnout-gated)
 * should be offered while ONSENSOR (sensor-gated) should not.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Event Handlers editor"
 */

import { test, expect } from './fixtures'

async function openEventHandlersEditor(page: import('@playwright/test').Page) {
    await page.getByText('Event Handlers', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

function addSelect(page: import('@playwright/test').Page) {
    return page.getByTestId('add-handler-select')
}

async function addHandler(page: import('@playwright/test').Page, command: string) {
    await addSelect(page).selectOption(command)
    await page.getByTestId('add-handler-button').click()
}

async function getOutputPaneText(page: import('@playwright/test').Page): Promise<string> {
    return (await page.getByTestId('exrail-output-text').textContent()) ?? ''
}

test.describe('Event Handlers editor', () => {
    test('appears as a normal Configuration-list row and opens to an empty state', async ({ workspacePage: page }) => {
        await expect(page.getByText('Event Handlers', { exact: true }).first()).toBeVisible()
        await openEventHandlersEditor(page)
        await expect(page.getByText('No event handlers.', { exact: false }).first()).toBeVisible()
    })

    test('gates the Add options by isAvailable — turnout-scoped offered, sensor-scoped not (no sensors seeded)', async ({ workspacePage: page }) => {
        await openEventHandlersEditor(page)
        const optionTexts = await addSelect(page).locator('option').allTextContents()
        expect(optionTexts).toContain('On turnout closed')
        expect(optionTexts).toContain('On turnout thrown')
        expect(optionTexts).not.toContain('On sensor changed')
    })

    test('adds a zero-arg event handler and shows it in the list and canvas', async ({ workspacePage: page }) => {
        await openEventHandlersEditor(page)
        await addHandler(page, 'ONRAILSYNCON')

        await expect(page.locator('event-handlers-editor nav[aria-label="Event handlers"] a')).toHaveCount(1)
        await expect(page.locator('event-handlers-editor nav[aria-label="Event handlers"] a').first()).toContainText('On rail sync signal valid')

        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        const outputText = await getOutputPaneText(page)
        expect(outputText).toContain('ONRAILSYNCON')
        expect(outputText).toContain('DONE')
    })

    test('adds a turnout-scoped handler with a real ref-kind field seeded from the turnout list', async ({ workspacePage: page }) => {
        await openEventHandlersEditor(page)
        await addHandler(page, 'ONCLOSE')

        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })
        const outputText = await getOutputPaneText(page)
        // Seeded with the first available turnout (200 or 201, per MOCK_TURNOUTS_H) — not blank.
        expect(outputText).toMatch(/ONCLOSE\(20[01]\)/)
    })

    test('the whole-file Raw tab shows myEvents.h content after adding a handler', async ({ workspacePage: page }) => {
        await openEventHandlersEditor(page)
        await addHandler(page, 'ONRAILSYNCOFF')

        await page.getByTestId('editor-tab-raw').click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        await page.waitForFunction(() => {
            const el = document.querySelector('[data-testid="file-body-monaco"] div.monaco-editor')
            return el ? el.querySelectorAll('.view-line').length > 0 : false
        })
        const text = await page.evaluate(() => {
            const el = document.querySelector('[data-testid="file-body-monaco"] div.monaco-editor')
            return el ? Array.from(el.querySelectorAll('.view-line')).map(l => l.textContent).join('\n') : ''
        })
        expect(text).toContain('ONRAILSYNCOFF')
    })

    test('removing the only entry returns to the empty state', async ({ workspacePage: page }) => {
        await openEventHandlersEditor(page)
        await addHandler(page, 'ONRAILSYNCON')
        await expect(page.locator('event-handlers-editor nav[aria-label="Event handlers"] a')).toHaveCount(1)

        await page.locator('event-handlers-editor nav[aria-label="Event handlers"] a button[title="Remove"]').click()

        await expect(page.locator('event-handlers-editor nav[aria-label="Event handlers"] a')).toHaveCount(0)
        await expect(page.getByText('No event handlers.', { exact: false }).first()).toBeVisible()
    })
})

test.describe('Block palette regression — new categories from this session render', () => {
    test('Routes editor palette includes newly-added categories alongside the existing ones', async ({ workspacePage: page }) => {
        await page.getByText('Routes', { exact: true }).first().click()
        await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
        await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 10_000 })

        const palette = page.locator('exrail-block-canvas nav')
        await expect(palette.getByRole('button', { name: 'Messages', exact: false })).toBeVisible()
        await expect(palette.getByRole('button', { name: 'Accessories', exact: false })).toBeVisible()

        await palette.getByRole('button', { name: 'Messages', exact: false }).click()
        await expect(page.locator('.blocklyFlyout').getByText('Print diagnostic message', { exact: false })).toBeVisible()
    })
})
