/**
 * E2E test: importing an EX-CommandStation project that includes mySetup.h and
 * myHal.cpp alongside myAutomation.h and config.h.
 *
 * Both files have real integration points in the DCC-EX/CommandStation-EX
 * firmware entirely independent of myAutomation.h (see the fixture's
 * MOCK_HAL_SKETCH_INO / MOCK_EXRAIL_MOCK_CPP doc comments for the exact
 * hazards this guards against): mySetup.h is #include'd directly by the
 * firmware's own setup(), and myHal.cpp is a separate .cpp translation unit
 * PlatformIO compiles on its own. Before the fix, config-editor-state.ts's
 * automationPreview blindly auto-#included every "custom" file into
 * myAutomation.h, including these two — a guaranteed compile/link failure.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 */

import { test, expect } from './fixtures'

async function getMonacoContent(page: import('@playwright/test').Page): Promise<string> {
    const lines = await page.locator('div.monaco-editor .view-line').allTextContents()
    return lines.map((l) => l.replace(/ /g, ' ')).join('\n')
}

test.describe('Import project with mySetup.h + myHal.cpp', () => {
    test('Setup Commands and HAL Setup (myHal.cpp) appear with friendly names in the Configuration list', async ({ importedHalProjectPage: page }) => {
        await expect(page.getByText('Setup Commands', { exact: true })).toBeVisible()
        await expect(page.getByText('HAL Setup (myHal.cpp)', { exact: true })).toBeVisible()
    })

    test('compiling the imported project for Arduino Mega succeeds, and myAutomation.h never auto-#included mySetup.h or myHal.cpp', async ({ importedHalProjectPage: page }) => {
        // Compile triggers workspace.ts's saveFiles() -> configEditorState.syncAll(),
        // which is what actually regenerates myAutomation.h's content from
        // automationPreview — reading the Advanced editor beforehand would only see
        // the as-seeded file, never exercising the include-generation logic at all.
        await page.getByRole('button', { name: 'Compile' }).click()
        await expect(page.getByText('✓ Success')).toBeVisible({ timeout: 30_000 })

        await page.getByTestId('nav-advanced').click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()

        const content = await getMonacoContent(page)
        expect(content).not.toContain('#include "mySetup.h"')
        expect(content).not.toContain('#include "myHal.cpp"')
    })
})
