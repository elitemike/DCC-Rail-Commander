/**
 * E2E tests: Load from Folder feature.
 *
 * These tests exercise the complete flow of opening an existing folder of
 * DCC-EX config files from the home screen and loading them into the workspace.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Load from Folder"
 */

import { test as base, expect, _electron as electron } from '@playwright/test'
import type { Page, ElectronApplication } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

// Strip ELECTRON_RUN_AS_NODE so the binary runs as Electron, not Node.js.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { ELECTRON_RUN_AS_NODE: _ern, ...ELECTRON_ENV } = process.env
import { buildGeneratorHeader } from '../../src/renderer/src/utils/myAutomationParser'
import { buildDeviceHeader } from '../../src/renderer/src/utils/configHeaderParser'
import type { ArduinoCliBoardInfo } from '../../src/types/ipc'

// ── Mock file content ─────────────────────────────────────────────────────────

const MOCK_CONFIG_H = [
    '// config.h — load-from-folder test',
    '#define MAIN_DRIVER_MOTOR_SHIELD STANDARD_MOTOR_SHIELD',
].join('\n')

const MOCK_DEVICE: ArduinoCliBoardInfo = {
    name: 'Arduino Mega 2560',
    port: '/dev/ttyTest0',
    fqbn: 'arduino:avr:mega',
    protocol: 'serial',
}

/**
 * config.h that already has a device header embedded.
 * Tests using this skip the device picker dialog entirely.
 */
const CONFIG_H_WITH_DEVICE = `${buildDeviceHeader(MOCK_DEVICE)}\n${MOCK_CONFIG_H}`

/** Roster file WITHOUT generator header — simulates an externally created file. */
const EXTERNAL_ROSTER_H = [
    'ROSTER(3, "Thomas", "LIGHT/HORN/*WHISTLE/BELL")',
    'ROSTER(5, "Percy", "LIGHT/HORN")',
].join('\n')

/** Roster file WITH generator header — simulates a file already managed by us. */
const MANAGED_ROSTER_H = buildGeneratorHeader('myRoster.h', '0.1.0') + '\n' + EXTERNAL_ROSTER_H

const EXTERNAL_TURNOUTS_H = [
    'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
].join('\n')

const MANAGED_TURNOUTS_H = buildGeneratorHeader('myTurnouts.h', '0.1.0') + '\n' + EXTERNAL_TURNOUTS_H

const ELECTRON_MAIN = resolve(__dirname, '../../out/main/index.js')

// ── Fixture types ─────────────────────────────────────────────────────────────

interface LoadFolderFixtures {
    electronApp: ElectronApplication
    homePage: Page
    sourceFolder: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function launchBareApp(): Promise<{ app: ElectronApplication; testDataDir: string }> {
    const testDataDir = mkdtempSync(join(tmpdir(), 'ex-load-folder-e2e-'))
    const prefsDir = join(testDataDir, 'preferences')
    mkdirSync(prefsDir, { recursive: true })
    // Start with an empty saved-configurations list so we get the onboarding screen
    writeFileSync(
        join(prefsDir, 'ex-installer-preferences.json'),
        JSON.stringify({ savedConfigurations: [] }, null, 2),
        'utf-8',
    )
    const args = [
        ELECTRON_MAIN,
        '--mock-device', '--mock-compile', '--skip-startup',
        `--test-data-dir=${testDataDir}`,
        '--disable-gpu', '--no-sandbox', '--js-flags=--no-expose-wasm',
    ]
    const app = await electron.launch({ args, chromiumSandbox: false, env: ELECTRON_ENV })
    return { app, testDataDir }
}

/**
 * Intercepts the `files:select-directory` IPC channel to return a fixed path,
 * bypassing the native OS folder-picker dialog.
 */
async function mockSelectDirectory(app: ElectronApplication, folder: string): Promise<void> {
    await app.evaluate((_electronApp, path: string) => {
        const { ipcMain } = (globalThis as Record<string, NodeRequire>).__e2eRequire('electron') as typeof import('electron')
        ipcMain.removeHandler('files:select-directory')
        ipcMain.handle('files:select-directory', () => path)
    }, folder)
}

/**
 * Mocks the `arduino-cli:list-boards` IPC channel to return a fixed list of
 * boards.  The device-picker dialog calls this on open.
 */
async function mockListBoards(app: ElectronApplication, boards: ArduinoCliBoardInfo[]): Promise<void> {
    await app.evaluate((_electronApp, boardList: ArduinoCliBoardInfo[]) => {
        const { ipcMain } = (globalThis as Record<string, NodeRequire>).__e2eRequire('electron') as typeof import('electron')
        ipcMain.removeHandler('arduino-cli:list-boards')
        ipcMain.handle('arduino-cli:list-boards', () => boardList)
    }, boards)
}

// ── Fixture ───────────────────────────────────────────────────────────────────

const test = base.extend<LoadFolderFixtures>({
    // eslint-disable-next-line no-empty-pattern
    electronApp: async ({ }, use) => {
        const { app, testDataDir } = await launchBareApp()
        await use(app)
        await app.close()
        rmSync(testDataDir, { recursive: true, force: true })
    },

    homePage: async ({ electronApp }, use) => {
        const page = await electronApp.firstWindow()
        page.on('dialog', (dialog) => dialog.accept().catch(() => undefined))
        await page.waitForLoadState('domcontentloaded')
        await page.evaluate(() => {
            document.querySelectorAll('[id^="ej2-licensing"]').forEach(el => el.remove())
        }).catch(() => undefined)
        // Onboarding screen shows when there are no saved configs
        await expect(page.getByText('Load from Folder').first()).toBeVisible({ timeout: 15_000 })
        await use(page)
    },

    // eslint-disable-next-line no-empty-pattern
    sourceFolder: async ({ }, use) => {
        const dir = mkdtempSync(join(tmpdir(), 'ex-source-'))
        await use(dir)
        rmSync(dir, { recursive: true, force: true })
    },
})

// ── Tests: folder already has device header (picker skipped) ─────────────────

test.describe('Load from Folder — device header present in config.h', () => {

    test('loads valid folder and navigates to workspace without showing device picker', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')
        writeFileSync(join(sourceFolder, 'myRoster.h'), MANAGED_ROSTER_H, 'utf-8')
        writeFileSync(join(sourceFolder, 'myTurnouts.h'), MANAGED_TURNOUTS_H, 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()

        // Should navigate to workspace — device picker dialog should NOT appear
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })
        await expect(homePage.getByText('Select Your Board')).not.toBeVisible()
    })

    test('workspace shows Roster and Turnouts tabs after folder load', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')
        writeFileSync(join(sourceFolder, 'myRoster.h'), MANAGED_ROSTER_H, 'utf-8')
        writeFileSync(join(sourceFolder, 'myTurnouts.h'), MANAGED_TURNOUTS_H, 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()

        await expect(homePage.getByText('Roster', { exact: true })).toBeVisible({ timeout: 10_000 })
        await expect(homePage.getByText('Turnouts', { exact: true })).toBeVisible({ timeout: 10_000 })
    })

    test('roster entries from the source file are visible in the visual editor', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')
        writeFileSync(join(sourceFolder, 'myRoster.h'), MANAGED_ROSTER_H, 'utf-8')
        writeFileSync(join(sourceFolder, 'myTurnouts.h'), MANAGED_TURNOUTS_H, 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()

        await homePage.getByText('Roster', { exact: true }).first().click()
        await expect(homePage.getByRole('button', { name: 'Visual' })).toBeVisible({ timeout: 5_000 })

        await expect(homePage.getByText('Thomas')).toBeVisible({ timeout: 5_000 })
        await expect(homePage.getByText('Percy')).toBeVisible({ timeout: 5_000 })
    })

    test('turnout entries from the source file are visible in the visual editor', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')
        writeFileSync(join(sourceFolder, 'myRoster.h'), MANAGED_ROSTER_H, 'utf-8')
        writeFileSync(join(sourceFolder, 'myTurnouts.h'), MANAGED_TURNOUTS_H, 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()

        await homePage.getByText('Turnouts', { exact: true }).first().click()
        await expect(homePage.getByRole('button', { name: 'Visual' })).toBeVisible({ timeout: 5_000 })
        await expect(homePage.getByText('Main Line Junction')).toBeVisible({ timeout: 5_000 })
    })

    test('raw editor shows generator header for managed roster file', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')
        writeFileSync(join(sourceFolder, 'myRoster.h'), MANAGED_ROSTER_H, 'utf-8')
        writeFileSync(join(sourceFolder, 'myTurnouts.h'), MANAGED_TURNOUTS_H, 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()

        await homePage.getByText('Roster', { exact: true }).first().click()
        await homePage.getByRole('button', { name: 'Raw' }).click()
        await expect(homePage.locator('div.monaco-editor')).toBeVisible({ timeout: 5_000 })
        await homePage.waitForTimeout(400)

        await expect(homePage.locator('div.monaco-editor')).toContainText('DCCEX-Installer')
    })

    test('loads a folder containing only config.h (with device header)', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()

        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })
    })

    test('unknown .h files are loaded alongside known files', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')
        writeFileSync(join(sourceFolder, 'myCustom.h'), '// Custom DCC-EX commands\n', 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()

        await expect(homePage.getByText('myCustom.h').first()).toBeVisible({ timeout: 10_000 })
    })

    test('silently updates port when board reconnects on a different port', async ({ electronApp, homePage, sourceFolder }) => {
        // config.h has device header with port /dev/ttyUSB0
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')

        // But the board is currently attached at a different port
        const movedDevice: ArduinoCliBoardInfo = { ...MOCK_DEVICE, port: '/dev/ttyACM0' }
        await mockSelectDirectory(electronApp, sourceFolder)
        await mockListBoards(electronApp, [movedDevice])

        await homePage.getByText('Load from Folder').first().click()

        // Device picker should NOT show — board is recognised by FQBN
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })
        await expect(homePage.getByText('Select Your Board')).not.toBeVisible()

        // Save so the reconciled port is written back to disk
        await homePage.getByRole('button', { name: 'Save' }).click()
        await homePage.waitForTimeout(500)

        const savedConfig = readFileSync(join(sourceFolder, 'config.h'), 'utf-8')
        expect(savedConfig).toContain('/dev/ttyACM0')
        expect(savedConfig).not.toContain('/dev/ttyUSB0')
    })

})

// ── Tests: missing config.h error ────────────────────────────────────────────

test.describe('Load from Folder — validation', () => {

    test('shows error toast and stays on home if folder has no config.h', async ({ electronApp, homePage, sourceFolder }) => {
        // Only put myRoster.h — no config.h
        writeFileSync(join(sourceFolder, 'myRoster.h'), EXTERNAL_ROSTER_H, 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()

        await expect(homePage.locator('.e-toast-danger')).toBeVisible({ timeout: 5_000 })
        await expect(homePage.locator('.e-toast-danger')).toContainText('config.h')

        // Should remain on home screen
        await expect(homePage.getByText('Load from Folder').first()).toBeVisible()
        await expect(homePage.getByText('config.h').first()).not.toBeVisible()
    })

    test('cancelling the folder picker leaves the home screen unchanged', async ({ electronApp, homePage }) => {
        await electronApp.evaluate((_electronApp) => {
            const { ipcMain } = (globalThis as Record<string, NodeRequire>).__e2eRequire('electron') as typeof import('electron')
            ipcMain.removeHandler('files:select-directory')
            ipcMain.handle('files:select-directory', () => null)
        })

        await homePage.getByText('Load from Folder').first().click()

        await expect(homePage.getByText('Load from Folder').first()).toBeVisible({ timeout: 3_000 })
        await expect(homePage.getByText('config.h').first()).not.toBeVisible()
    })

})

// ── Tests: device picker dialog ───────────────────────────────────────────────

test.describe('Load from Folder — device picker dialog', () => {

    test('shows device picker when config.h has no device header', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), MOCK_CONFIG_H, 'utf-8')
        await mockSelectDirectory(electronApp, sourceFolder)
        await mockListBoards(electronApp, [MOCK_DEVICE])

        await homePage.getByText('Load from Folder').first().click()

        await expect(homePage.getByText('Select Your Board')).toBeVisible({ timeout: 8_000 })
    })

    test('device picker lists detected boards', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), MOCK_CONFIG_H, 'utf-8')
        await mockSelectDirectory(electronApp, sourceFolder)
        await mockListBoards(electronApp, [MOCK_DEVICE])

        await homePage.getByText('Load from Folder').first().click()

        await expect(homePage.getByText('Arduino Mega 2560')).toBeVisible({ timeout: 8_000 })
        await expect(homePage.getByText('arduino:avr:mega')).toBeVisible()
    })

    test('"Use This Board" confirms selection and navigates to workspace', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), MOCK_CONFIG_H, 'utf-8')
        await mockSelectDirectory(electronApp, sourceFolder)
        await mockListBoards(electronApp, [MOCK_DEVICE])

        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('Select Your Board')).toBeVisible({ timeout: 8_000 })

        await homePage.getByRole('button', { name: 'Use This Board' }).click()

        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })
    })

    test('"Continue without device" still navigates to workspace', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), MOCK_CONFIG_H, 'utf-8')
        await mockSelectDirectory(electronApp, sourceFolder)
        await mockListBoards(electronApp, [])  // no boards detected

        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('Select Your Board')).toBeVisible({ timeout: 8_000 })

        await homePage.getByRole('button', { name: 'Continue without device' }).click()

        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })
    })

    test('Cancel in device picker aborts folder load and keeps home screen', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), MOCK_CONFIG_H, 'utf-8')
        await mockSelectDirectory(electronApp, sourceFolder)
        await mockListBoards(electronApp, [MOCK_DEVICE])

        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('Select Your Board')).toBeVisible({ timeout: 8_000 })

        await homePage.getByRole('button', { name: 'Cancel' }).click()

        // Should remain on home screen — no workspace navigation
        await expect(homePage.getByText('Load from Folder').first()).toBeVisible({ timeout: 5_000 })
        await expect(homePage.getByText('config.h').first()).not.toBeVisible()
    })

    test('confirming a board injects device header into config.h on Save', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), MOCK_CONFIG_H, 'utf-8')
        await mockSelectDirectory(electronApp, sourceFolder)
        await mockListBoards(electronApp, [MOCK_DEVICE])

        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('Select Your Board')).toBeVisible({ timeout: 8_000 })
        await homePage.getByRole('button', { name: 'Use This Board' }).click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        await homePage.getByRole('button', { name: 'Save' }).click()
        await homePage.waitForTimeout(500)

        const savedContent = readFileSync(join(sourceFolder, 'config.h'), 'utf-8')
        expect(savedContent).toContain('DCCEX-Installer Device Configuration')
        expect(savedContent).toContain('Arduino Mega 2560')
        expect(savedContent).toContain('arduino:avr:mega')
    })

    test('re-opening same folder after Save skips the device picker', async ({ electronApp, homePage, sourceFolder }) => {
        // First load — device picker shown, user confirms
        writeFileSync(join(sourceFolder, 'config.h'), MOCK_CONFIG_H, 'utf-8')
        await mockSelectDirectory(electronApp, sourceFolder)
        await mockListBoards(electronApp, [MOCK_DEVICE])

        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('Select Your Board')).toBeVisible({ timeout: 8_000 })
        await homePage.getByRole('button', { name: 'Use This Board' }).click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        // Save so device header is written to disk
        await homePage.getByRole('button', { name: 'Save' }).click()
        await homePage.waitForTimeout(500)

        // Navigate back to home
        await homePage.getByRole('button', { name: 'EX-Installer' }).click()
        await expect(homePage.getByText('Load from Folder').first()).toBeVisible({ timeout: 5_000 })

        // Second load from same folder — picker should not appear
        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()

        // Picker should be skipped; workspace loads directly
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })
        await expect(homePage.getByText('Select Your Board')).not.toBeVisible()
    })

})

// ── Tests: migration detection ────────────────────────────────────────────────

test.describe('Load from Folder — migration detection', () => {

    test('shows migration warning for externally created roster file', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')
        writeFileSync(join(sourceFolder, 'myRoster.h'), EXTERNAL_ROSTER_H, 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()

        await expect(homePage.locator('.e-toast-warning')).toBeVisible({ timeout: 8_000 })
        await expect(homePage.locator('.e-toast-warning')).toContainText('not created by EX-Installer')
    })

    test('no migration warning when all managed files have generator headers', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')
        writeFileSync(join(sourceFolder, 'myRoster.h'), MANAGED_ROSTER_H, 'utf-8')
        writeFileSync(join(sourceFolder, 'myTurnouts.h'), MANAGED_TURNOUTS_H, 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()

        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })
        await expect(homePage.locator('.e-toast-warning')).not.toBeVisible()
    })

})

// ── Tests: save writes back to source folder ──────────────────────────────────

test.describe('Load from Folder — save writes back to source folder', () => {

    test('Save writes generator header to roster file in source folder', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')
        writeFileSync(join(sourceFolder, 'myRoster.h'), EXTERNAL_ROSTER_H, 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        await homePage.locator('.e-toast-warning').click().catch(() => undefined)
        await homePage.getByRole('button', { name: 'Save' }).click()
        await homePage.waitForTimeout(500)

        const savedContent = readFileSync(join(sourceFolder, 'myRoster.h'), 'utf-8')
        expect(savedContent).toContain('DCCEX-Installer')
        expect(savedContent).toContain('ROSTER(3, "Thomas"')
        expect(savedContent).toContain('ROSTER(5, "Percy"')
    })

})

// ── Tests: internal sketch path setup ────────────────────────────────────────

test.describe('Load from Folder — internal sketch path setup', () => {

    test('creates internal scratch dir when matching product repo is installed and folder has no .ino', async ({ electronApp, homePage, sourceFolder }) => {
        // Build a minimal installed repos directory structure.
        // resolveSketchPath will look here for a matching product repo.
        const reposDir = mkdtempSync(join(tmpdir(), 'ex-repos-mock-'))
        try {
            // Create a minimal CommandStation-EX repo with .git marker and .ino file.
            // Only the .ino is needed to verify it gets copied to the internal scratch.
            const repoDir = join(reposDir, 'CommandStation-EX')
            mkdirSync(join(repoDir, '.git'), { recursive: true })
            writeFileSync(join(repoDir, 'CommandStation-EX.ino'), '// sketch placeholder\n', 'utf-8')

            // User's source folder has only config.h — no .ino file.
            writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')

            // Override getInstallDir to point to our fake repos directory.
            await electronApp.evaluate((_electronApp, dir: string) => {
                const { ipcMain } = (globalThis as Record<string, NodeRequire>).__e2eRequire('electron') as typeof import('electron')
                ipcMain.removeHandler('files:get-install-dir')
                ipcMain.handle('files:get-install-dir', () => dir)
            }, reposDir)

            await mockSelectDirectory(electronApp, sourceFolder)
            await homePage.getByText('Load from Folder').first().click()

            // Workspace should load successfully
            await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

            // An internal _build/<id>/CommandStation-EX directory should have been created
            const buildDir = join(reposDir, '_build')
            expect(existsSync(buildDir)).toBe(true)

            const idDirs = readdirSync(buildDir)
            expect(idDirs).toHaveLength(1)

            const sketchDir = join(buildDir, idDirs[0], 'CommandStation-EX')
            // The .ino was copied from the repo source to the internal scratch
            expect(existsSync(join(sketchDir, 'CommandStation-EX.ino'))).toBe(true)
            // The user's config.h was overlaid into the scratch dir
            expect(existsSync(join(sketchDir, 'config.h'))).toBe(true)

            // Save — config.h must be written back to the user's original source folder
            await homePage.getByRole('button', { name: 'Save' }).click()
            await homePage.waitForTimeout(500)

            const savedConfig = readFileSync(join(sourceFolder, 'config.h'), 'utf-8')
            expect(savedConfig).toContain('#define MAIN_DRIVER_MOTOR_SHIELD')
        } finally {
            rmSync(reposDir, { recursive: true, force: true })
        }
    })

})
