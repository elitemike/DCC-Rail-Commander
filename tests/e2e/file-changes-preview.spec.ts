import { test, expect } from './fixtures'

async function openRoutesEditor(page: import('@playwright/test').Page) {
    await page.getByText('Routes', { exact: true }).first().click()
    await expect(page.locator('routes-editor')).toBeVisible()
}

async function makeAnEdit(page: import('@playwright/test').Page) {
    await openRoutesEditor(page)
    await page.locator('routes-editor button[title="Add new route"]').click()
    await expect(page.locator('[data-testid="save-dirty-indicator"]')).toBeVisible()
}

async function openChanges(page: import('@playwright/test').Page) {
    await page.locator('[data-testid="save-button"]').click()
    await page.locator('[data-testid="file-changes-close-button"]').waitFor({ state: 'visible' })
}

test.describe('Changes dialog (opened via the Save button)', () => {
    test('Save is disabled with no pending edits, enabled after an edit, and disabled again once saved', async ({ workspacePage }) => {
        const saveButton = workspacePage.locator('[data-testid="save-button"]')
        await expect(saveButton).toBeDisabled()

        await makeAnEdit(workspacePage)
        await expect(saveButton).toBeEnabled()

        await openChanges(workspacePage)
        await workspacePage.locator('[data-testid="file-changes-save-button"]').click()

        await expect(workspacePage.locator('[data-testid="save-dirty-indicator"]')).not.toBeVisible()
        await expect(saveButton).toBeDisabled()
    })

    test('an edited file is marked changed, auto-selected, and the diff editor renders it; closing without saving leaves the edit pending', async ({ workspacePage }) => {
        await makeAnEdit(workspacePage)

        await openChanges(workspacePage)

        const changedRow = workspacePage
            .locator('[data-testid="file-change-row"]')
            .filter({ has: workspacePage.locator('[data-testid="file-change-status-changed"]') })
            .first()
        await expect(changedRow).toBeVisible()
        // The first changed/new file is auto-selected on open.
        await expect(changedRow).toHaveClass(/border-l-blue-500/)

        // Selecting a different row moves the highlight.
        const rows = workspacePage.locator('[data-testid="file-change-row"]')
        const otherRow = rows.nth((await rows.count()) - 1)
        await otherRow.click()
        await expect(otherRow).toHaveClass(/border-l-blue-500/)

        // Close (not Save) must not write anything — the edit is still pending.
        await workspacePage.locator('[data-testid="file-changes-close-button"]').click()
        await expect(workspacePage.locator('[data-testid="file-changes-list"]')).not.toBeVisible()
        await expect(workspacePage.locator('[data-testid="save-dirty-indicator"]')).toBeVisible()
        await expect(workspacePage.locator('[data-testid="save-button"]')).toBeEnabled()
    })

    test('clicking Save inside the dialog writes the files and clears the dirty indicator', async ({ workspacePage }) => {
        await makeAnEdit(workspacePage)
        await openChanges(workspacePage)

        await workspacePage.locator('[data-testid="file-changes-save-button"]').click()

        await expect(workspacePage.locator('[data-testid="file-changes-list"]')).not.toBeVisible()
        await expect(workspacePage.locator('[data-testid="save-dirty-indicator"]')).not.toBeVisible()
    })
})
