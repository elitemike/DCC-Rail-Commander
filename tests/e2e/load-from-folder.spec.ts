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
import { basename, join, resolve } from 'path'
import { tmpdir } from 'os'

// Strip ELECTRON_RUN_AS_NODE so the binary runs as Electron, not Node.js.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { ELECTRON_RUN_AS_NODE: _ern, ...ELECTRON_ENV } = process.env
import { buildGeneratorHeader } from '../../src/renderer/src/utils/myAutomationParser'
import { buildDeviceHeader } from '../../src/renderer/src/utils/configHeaderParser'
import type { ArduinoCliBoardInfo, SerialDeviceInfo } from '../../src/types/ipc'

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

/** Device header with a known FQBN but no port — triggers the portOnly device picker. */
const CONFIG_H_WITH_DEVICE_NO_PORT = `${buildDeviceHeader({ ...MOCK_DEVICE, port: '' })}\n${MOCK_CONFIG_H}`

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
    const prefsDir = join(testDataDir, 'app-preferences')
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

/**
 * Mocks the `usb:list-serial-ports` IPC channel, overriding the fake devices
 * `--mock-device` normally supplies. Defaults to no ports at all — combined
 * with an empty mockListBoards(), that reproduces the genuine "nothing
 * connected" state the device-picker dialog's empty-state / troubleshooting
 * UI is meant for. Pass an explicit list to simulate specific unrelated
 * devices being connected instead.
 */
async function mockSerialPorts(app: ElectronApplication, ports: SerialDeviceInfo[] = []): Promise<void> {
    await app.evaluate((_electronApp, portList: SerialDeviceInfo[]) => {
        const { ipcMain } = (globalThis as Record<string, NodeRequire>).__e2eRequire('electron') as typeof import('electron')
        ipcMain.removeHandler('usb:list-serial-ports')
        ipcMain.handle('usb:list-serial-ports', () => portList)
    }, ports)
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

    test('manually rescanning the port (port badge) updates the raw config.h, not just in-memory state', async ({ electronApp, homePage, sourceFolder }) => {
        // Regression: rescanPort() wrote the new port into configFiles, but
        // saveFiles() -> configEditorState.syncAll() re-derived config.h from
        // ConfigEditorState's own stale cached copy (configHContent), which still
        // had *a* device header on it, so it silently overwrote the fresh port
        // with the old one — the raw file (and the on-disk save) never changed.
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8') // port: /dev/ttyTest0
        await mockSelectDirectory(electronApp, sourceFolder)

        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        // Force the config.h Raw view to actually load its (stale) cached content
        // before rescanning, same as a real session where the user has already
        // looked at/edited other fields — this is what made configHContent stale.
        await homePage.getByText('Device Settings', { exact: true }).first().click()

        // Now a *different* board answers on a new port for the manual rescan.
        const rescannedDevice: ArduinoCliBoardInfo = { ...MOCK_DEVICE, port: '/dev/ttyACM9' }
        await mockListBoards(electronApp, [rescannedDevice])
        await mockSerialPorts(electronApp, [{
            path: '/dev/ttyACM9',
            manufacturer: 'Arduino (www.arduino.cc)',
            serialNumber: 'DEV-MEGA-0001',
            vendorId: '2341',
            productId: '0042',
        }])

        await homePage.getByTestId('port-badge').click()
        await expect(homePage.getByText('Select Port', { exact: true })).toBeVisible({ timeout: 8_000 })
        await expect(homePage.getByRole('button', { name: 'Use This Board' })).toBeEnabled()
        await homePage.getByRole('button', { name: 'Use This Board' }).click()

        await expect(homePage.getByText('Port Updated')).toBeVisible({ timeout: 5_000 })
        // The port badge itself must reflect the new port immediately.
        await expect(homePage.getByTestId('port-badge')).toContainText('/dev/ttyACM9')

        // The Raw editor (bound to ConfigEditorState.configHContent) must also show it —
        // this is exactly the field that went stale and clobbered the save.
        await homePage.getByRole('button', { name: 'Raw' }).click()
        await expect(homePage.locator('div.monaco-editor')).toBeVisible({ timeout: 5_000 })
        await homePage.waitForTimeout(400)
        await expect(homePage.locator('div.monaco-editor')).toContainText('/dev/ttyACM9')

        // And it must have actually been written to disk (saveFiles() runs inside rescanPort()).
        const savedConfig = readFileSync(join(sourceFolder, 'config.h'), 'utf-8')
        expect(savedConfig).toContain('/dev/ttyACM9')
        expect(savedConfig).not.toContain('/dev/ttyTest0')
    })

    test('a rescanned port survives leaving and reopening the same saved config', async ({ electronApp, homePage, sourceFolder }) => {
        // Regression: updateSavedConfig() refreshed configFiles but never
        // devicePort/deviceFqbn/deviceName on the SavedConfiguration entry. Both
        // home.ts's loadConfig() and workspace.ts's switchToConfig() rebuild
        // state.selectedDevice straight from those saved fields, so even though
        // rescanPort() correctly updated the live session (and config.h on disk),
        // the *next* time this same config was opened the port badge reverted to
        // whatever port was saved when the config was first created — as if the
        // rescan had never happened.
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8') // port: /dev/ttyTest0
        await mockSelectDirectory(electronApp, sourceFolder)

        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        const rescannedDevice: ArduinoCliBoardInfo = { ...MOCK_DEVICE, port: '/dev/ttyACM9' }
        await mockListBoards(electronApp, [rescannedDevice])
        await mockSerialPorts(electronApp, [{
            path: '/dev/ttyACM9',
            manufacturer: 'Arduino (www.arduino.cc)',
            serialNumber: 'DEV-MEGA-0001',
            vendorId: '2341',
            productId: '0042',
        }])

        await homePage.getByTestId('port-badge').click()
        await expect(homePage.getByText('Select Port', { exact: true })).toBeVisible({ timeout: 8_000 })
        await homePage.getByRole('button', { name: 'Use This Board' }).click()
        await expect(homePage.getByText('Port Updated')).toBeVisible({ timeout: 5_000 })

        // Leave, then reopen the same saved config from the home screen.
        await homePage.getByRole('button', { name: 'EX-Installer' }).click()
        await expect(homePage.getByText('Recent Devices')).toBeVisible({ timeout: 10_000 })
        await homePage.getByText(basename(sourceFolder), { exact: true }).first().click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        // The port badge must reflect the rescanned port, not the one the config was created with.
        await expect(homePage.getByTestId('port-badge')).toContainText('/dev/ttyACM9')
    })

    test('port picker does not auto-select an unrelated board when the known device is not connected', async ({ electronApp, homePage, sourceFolder }) => {
        // Regression: previously this fell back to preselecting boards[0] — an
        // unrelated board the user never actually chose — whenever the FQBN from
        // config.h didn't match anything currently connected.
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE_NO_PORT, 'utf-8')

        // Only an Uno is connected — config.h's device is a Mega, so nothing matches.
        await mockListBoards(electronApp, [])
        await mockSerialPorts(electronApp, [{
            path: '/dev/ttyACM5',
            manufacturer: 'Arduino (www.arduino.cc)',
            serialNumber: 'DEV-UNO-0001',
            vendorId: '2341',
            productId: '0043',
        }])

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()

        await expect(homePage.getByText('Select Port', { exact: true })).toBeVisible({ timeout: 8_000 })
        await expect(homePage.getByText("wasn't found among the connected boards", { exact: false })).toBeVisible()
        await expect(homePage.getByText('Arduino Uno')).toBeVisible()

        // Nothing pre-selected — "Use This Board" must stay disabled until the user picks one.
        await expect(homePage.getByRole('button', { name: 'Use This Board' })).toBeDisabled()

        await homePage.getByText('Arduino Uno').click()
        await expect(homePage.getByRole('button', { name: 'Use This Board' })).toBeEnabled()
    })

    test('port badge shows connected and the Monitor auto-opens when the device answers on load', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8') // port: /dev/ttyTest0
        await mockSelectDirectory(electronApp, sourceFolder)
        await mockListBoards(electronApp, [MOCK_DEVICE])
        await mockSerialPorts(electronApp, [{
            path: '/dev/ttyTest0',
            manufacturer: 'Arduino (www.arduino.cc)',
            serialNumber: 'DEV-MEGA-0001',
            vendorId: '2341',
            productId: '0042',
        }])

        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        await expect(homePage.getByTestId('port-badge')).toHaveAttribute('title', /Device connected/, { timeout: 5_000 })
        // The Monitor should have opened itself — no manual "Monitor" click.
        // "Device Monitor" is the serial-monitor panel's own header text —
        // unambiguous, unlike "Monitor" which also matches the toolbar toggle
        // button and the bottom-panel tab button.
        await expect(homePage.getByText('Device Monitor', { exact: true })).toBeVisible({ timeout: 5_000 })
    })

    test('port badge shows not-detected and the Monitor stays closed when the device does not answer', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8') // port: /dev/ttyTest0
        await mockSelectDirectory(electronApp, sourceFolder)
        // Nothing connected matches /dev/ttyTest0.
        await mockListBoards(electronApp, [])
        await mockSerialPorts(electronApp, [])

        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        await expect(homePage.getByTestId('port-badge')).toHaveAttribute('title', /not detected/, { timeout: 5_000 })
        await expect(homePage.getByText('Device Monitor', { exact: true })).not.toBeVisible()
    })

    test('turning off Auto-connect is a persisted preference — Monitor stays closed on the next load', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8') // port: /dev/ttyTest0
        await mockSelectDirectory(electronApp, sourceFolder)
        await mockListBoards(electronApp, [MOCK_DEVICE])
        await mockSerialPorts(electronApp, [{
            path: '/dev/ttyTest0',
            manufacturer: 'Arduino (www.arduino.cc)',
            serialNumber: 'DEV-MEGA-0001',
            vendorId: '2341',
            productId: '0042',
        }])

        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        await expect(homePage.getByText('Device Monitor', { exact: true })).toBeVisible({ timeout: 5_000 })

        const autoConnectCheckbox = homePage
            .locator('label', { hasText: 'Auto-connect' })
            .locator('input[type="checkbox"]')
        await expect(autoConnectCheckbox).toBeChecked()
        await autoConnectCheckbox.uncheck({ force: true })

        // Leave and reopen the same saved config — a fresh Workspace instance
        // whose binding() must read the persisted preference from disk, not
        // just carry over an in-memory flag from the previous instance.
        await homePage.getByRole('button', { name: 'EX-Installer' }).click()
        await expect(homePage.getByText('Recent Devices')).toBeVisible({ timeout: 10_000 })
        await homePage.getByText(basename(sourceFolder), { exact: true }).first().click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        await expect(homePage.getByTestId('port-badge')).toHaveAttribute('title', /Device connected/, { timeout: 5_000 })
        await expect(homePage.getByText('Device Monitor', { exact: true })).not.toBeVisible()

        const autoConnectCheckboxAfterReload = homePage
            .locator('label', { hasText: 'Auto-connect' })
            .locator('input[type="checkbox"]')
        await expect(autoConnectCheckboxAfterReload).not.toBeChecked()
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

    test('device picker shows driver troubleshooting info when no boards are detected', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), MOCK_CONFIG_H, 'utf-8')
        await mockSelectDirectory(electronApp, sourceFolder)
        await mockListBoards(electronApp, [])
        await mockSerialPorts(electronApp)

        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('Select Your Board')).toBeVisible({ timeout: 8_000 })
        await expect(homePage.getByText('No boards detected.')).toBeVisible()

        const toggle = homePage.getByRole('button', { name: "Why can't I see my board?" })
        await expect(toggle).toBeVisible()
        await expect(homePage.getByText('WCH')).not.toBeVisible()

        await toggle.click()
        await expect(homePage.getByText('WCH')).toBeVisible()
        await expect(homePage.getByRole('button', { name: 'Hide' })).toBeVisible()
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
        // The picker now lists every connected serial port (not just the one CLI
        // mocked above), so explicitly pick the Mega rather than relying on
        // whichever board happens to be preselected by default.
        await homePage.getByText('Arduino Mega 2560').click()
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

    test('Save persists roster alias edits to myAliases.h in source folder', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')
        writeFileSync(join(sourceFolder, 'myRoster.h'), EXTERNAL_ROSTER_H, 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        await homePage.getByText('Roster', { exact: true }).first().click()
        await homePage.locator('#roster-treeview li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()

        const aliasInput = homePage
            .locator('div:has(> label:has-text("Alias")) input[type="text"]')
            .first()
        await aliasInput.fill('THOMAS_ALIAS')
        await aliasInput.blur()

        await homePage.getByRole('button', { name: 'Save' }).click()
        await homePage.waitForTimeout(500)

        const aliasesPath = join(sourceFolder, 'myAliases.h')
        expect(existsSync(aliasesPath)).toBe(true)
        const aliasesContent = readFileSync(aliasesPath, 'utf-8')
        expect(aliasesContent).toContain('#define THOMAS_ALIAS "3" // type: Roster')
    })

    test('Save persists roster alias when Save is clicked without leaving the alias field', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')
        writeFileSync(join(sourceFolder, 'myRoster.h'), EXTERNAL_ROSTER_H, 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        await homePage.getByText('Roster', { exact: true }).first().click()
        await homePage.locator('#roster-treeview li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()

        const aliasInput = homePage
            .locator('div:has(> label:has-text("Alias")) input[type="text"]')
            .first()
        await aliasInput.fill('THOMAS_ALIAS_NO_BLUR')

        // Intentionally do not blur the alias field before saving.
        await homePage.getByRole('button', { name: 'Save' }).click()
        await homePage.waitForTimeout(500)

        const aliasesPath = join(sourceFolder, 'myAliases.h')
        expect(existsSync(aliasesPath)).toBe(true)
        const aliasesContent = readFileSync(aliasesPath, 'utf-8')
        expect(aliasesContent).toContain('#define THOMAS_ALIAS_NO_BLUR "3" // type: Roster')
    })

    test('reopening saved config reads alias content from disk (not stale cache)', async ({ electronApp, homePage, sourceFolder }) => {
        writeFileSync(join(sourceFolder, 'config.h'), CONFIG_H_WITH_DEVICE, 'utf-8')
        writeFileSync(join(sourceFolder, 'myRoster.h'), EXTERNAL_ROSTER_H, 'utf-8')

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Load from Folder').first().click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        await homePage.getByText('Roster', { exact: true }).first().click()
        await homePage.locator('#roster-treeview li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()

        const aliasInput = homePage
            .locator('div:has(> label:has-text("Alias")) input[type="text"]')
            .first()
        await aliasInput.fill('CACHED_ALIAS')
        await aliasInput.blur()

        await homePage.getByRole('button', { name: 'Save' }).click()
        await homePage.waitForTimeout(500)

        const aliasesPath = join(sourceFolder, 'myAliases.h')
        writeFileSync(aliasesPath, '#define DISK_ALIAS "3" // type: Roster\n', 'utf-8')

        await homePage.getByRole('button', { name: 'EX-Installer' }).click()
        await expect(homePage.getByText('Recent Devices')).toBeVisible({ timeout: 10_000 })

        await homePage.getByText(basename(sourceFolder), { exact: true }).first().click()
        await expect(homePage.getByText('config.h').first()).toBeVisible({ timeout: 10_000 })

        await homePage.getByText('Roster', { exact: true }).first().click()
        await homePage.locator('#roster-treeview li').filter({ hasText: 'Thomas' }).first().locator('.e-fullrow').click()

        const reopenedAliasInput = homePage
            .locator('div:has(> label:has-text("Alias")) input[type="text"]')
            .first()
        await expect(reopenedAliasInput).toHaveValue('DISK_ALIAS')
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
