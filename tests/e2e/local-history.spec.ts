import { test, expect } from './fixtures'

async function openRoutesEditor(page: import('@playwright/test').Page) {
    await page.getByText('Routes', { exact: true }).first().click()
    await expect(page.locator('routes-editor')).toBeVisible()
}

async function addRouteAndSave(page: import('@playwright/test').Page) {
    await page.locator('routes-editor button[title="Add new route"]').click()
    await expect(page.locator('[data-testid="save-dirty-indicator"]')).toBeVisible()
    await page.locator('[data-testid="save-button"]').click()
    await page.locator('[data-testid="file-changes-save-button"]').waitFor({ state: 'visible' })
    await page.locator('[data-testid="file-changes-save-button"]').click()
    await expect(page.locator('[data-testid="save-dirty-indicator"]')).not.toBeVisible()
}

test.describe('Local History (opened via the History button)', () => {
    test('is hidden until a file has been saved at least once with a real content change', async ({ workspacePage }) => {
        await openRoutesEditor(workspacePage)
        // myRoutes.h has no history yet — the button is present (scratchPath exists) but its
        // dialog should report nothing recorded rather than erroring or showing stale content.
        await workspacePage.locator('[data-testid="local-history-button"]').click()
        await expect(workspacePage.locator('[data-testid="local-history-empty"]')).toBeVisible()
        await workspacePage.locator('[data-testid="local-history-close-button"]').click()
    })

    test('records a snapshot of the previous content on every Save that actually changes the file', async ({ workspacePage }) => {
        await openRoutesEditor(workspacePage)

        await addRouteAndSave(workspacePage)
        await addRouteAndSave(workspacePage)

        await workspacePage.locator('[data-testid="local-history-button"]').click()
        await expect(workspacePage.locator('[data-testid="local-history-row"]')).toHaveCount(2)
        await expect(workspacePage.locator('[data-testid="local-history-diff-editor"]')).toBeVisible()
    })

    test('restoring a snapshot replaces the active file content and marks the save as pending', async ({ workspacePage }) => {
        await openRoutesEditor(workspacePage)
        const routeRows = workspacePage.locator('nav[aria-label="Routes"] a')
        const countBefore = await routeRows.count()

        await addRouteAndSave(workspacePage)
        await expect(routeRows).toHaveCount(countBefore + 1)

        await workspacePage.locator('[data-testid="local-history-button"]').click()
        await workspacePage.locator('[data-testid="local-history-row"]').first().click()
        await workspacePage.locator('[data-testid="local-history-restore-button"]').click()

        // Restoring only mutates in-memory state — it does not write to disk itself.
        await expect(workspacePage.locator('[data-testid="save-dirty-indicator"]')).toBeVisible()
        await expect(routeRows).toHaveCount(countBefore)
    })

    test('closing the dialog without restoring leaves the file untouched', async ({ workspacePage }) => {
        await openRoutesEditor(workspacePage)
        await addRouteAndSave(workspacePage)

        await workspacePage.locator('[data-testid="local-history-button"]').click()
        await workspacePage.locator('[data-testid="local-history-close-button"]').click()

        await expect(workspacePage.locator('[data-testid="local-history-list"]')).not.toBeVisible()
        await expect(workspacePage.locator('[data-testid="save-dirty-indicator"]')).not.toBeVisible()
    })
})
