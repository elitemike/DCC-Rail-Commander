/**
 * E2E tests: Import Existing Project feature.
 *
 * Exercises the complete flow of importing a hand-scattered, multi-file EX-RAIL project
 * (arbitrary filenames, content mixed across files, alias-named ids) from the home screen:
 * source folder -> import summary dialog -> destination folder -> workspace. The core guarantee
 * this feature exists for — the source folder is never modified — is asserted explicitly.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Import Existing Project"
 */

import { test as base, expect, _electron as electron } from '@playwright/test'
import type { Page, ElectronApplication } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { ELECTRON_RUN_AS_NODE: _ern, ...ELECTRON_ENV } = process.env

import { buildDeviceHeader } from '../../src/renderer/src/utils/configHeaderParser'
import type { DetectedBoardInfo } from '../../src/types/ipc'
import { cleanupDir } from './fixtures'

const ELECTRON_MAIN = resolve(__dirname, '../../out/main/index.js')

const MOCK_DEVICE: DetectedBoardInfo = {
    name: 'Arduino Mega 2560',
    port: '/dev/ttyTest0',
    fqbn: 'arduino:avr:mega',
    protocol: 'serial',
}

// ── Fixture: a small, hand-scattered project — arbitrary filenames, an alias-named turnout
// id (the C-preprocessor-style resolution this whole feature exists for), and content this
// app has no structured editor for (a turntable directive) that must survive as leftover. ──

const SOURCE_CONFIG_H = [
    buildDeviceHeader(MOCK_DEVICE),
    '// config.h — hand-written test project',
    '#define MOTOR_SHIELD_TYPE STANDARD_MOTOR_SHIELD',
].join('\n')

const SOURCE_ROSTER_H = 'ROSTER(3, "Thomas", "LIGHT/HORN")'

const SOURCE_TURNOUTS_H = [
    'ALIAS(TRN_A, 100)',
    'TURNOUT(TRN_A, 20, 0, "Yard")',
    'THROW(TRN_A)',
].join('\n')

const SOURCE_TURNTABLE_H = [
    'DCC_TURNTABLE(1, 200)',
    'TT_ADDPOSITION(1, 1, 200, 0, "Entry")',
].join('\n')

interface ImportFixtures {
    electronApp: ElectronApplication
    homePage: Page
    sourceFolder: string
    destFolder: string
}

async function launchBareApp(): Promise<{ app: ElectronApplication; testDataDir: string }> {
    const testDataDir = mkdtempSync(join(tmpdir(), 'dcc-rail-commander-import-e2e-'))
    const prefsDir = join(testDataDir, 'app-preferences')
    mkdirSync(prefsDir, { recursive: true })
    writeFileSync(
        join(prefsDir, 'dcc-rail-commander-preferences.json'),
        JSON.stringify({ savedConfigurations: [] }, null, 2),
        'utf-8',
    )
    const args = [
        ELECTRON_MAIN,
        '--mock-device', '--mock-upload', '--skip-startup',
        `--test-data-dir=${testDataDir}`,
        '--disable-gpu', '--no-sandbox', '--js-flags=--no-expose-wasm',
    ]
    const app = await electron.launch({ args, chromiumSandbox: false, env: ELECTRON_ENV })
    return { app, testDataDir }
}

/** Intercepts `files:select-directory` to return a fixed path once, bypassing the native OS
 *  folder picker — same mechanism load-from-folder.spec.ts uses. Re-call between UI checkpoints
 *  to feed a different path to a second picker invocation later in the same flow. */
async function mockSelectDirectory(app: ElectronApplication, folder: string): Promise<void> {
    await app.evaluate((_electronApp, path: string) => {
        const { ipcMain } = (globalThis as Record<string, NodeRequire>).__e2eRequire('electron') as typeof import('electron')
        ipcMain.removeHandler('files:select-directory')
        ipcMain.handle('files:select-directory', () => path)
    }, folder)
}

const test = base.extend<ImportFixtures>({
    // eslint-disable-next-line no-empty-pattern
    electronApp: async ({ }, use) => {
        const { app, testDataDir } = await launchBareApp()
        await use(app)
        await app.close()
        cleanupDir(testDataDir)
    },

    homePage: async ({ electronApp }, use) => {
        const page = await electronApp.firstWindow()
        page.on('dialog', (dialog) => dialog.accept().catch(() => undefined))
        await page.waitForLoadState('domcontentloaded')
        await page.evaluate(() => {
            document.querySelectorAll('[id^="ej2-licensing"]').forEach(el => el.remove())
        }).catch(() => undefined)
        await expect(page.getByText('Import Existing Project').first()).toBeVisible({ timeout: 15_000 })
        await use(page)
    },

    // eslint-disable-next-line no-empty-pattern
    sourceFolder: async ({ }, use) => {
        const dir = mkdtempSync(join(tmpdir(), 'dcc-import-source-'))
        await use(dir)
        cleanupDir(dir)
    },

    // eslint-disable-next-line no-empty-pattern
    destFolder: async ({ }, use) => {
        const dir = mkdtempSync(join(tmpdir(), 'dcc-import-dest-'))
        await use(dir)
        cleanupDir(dir)
    },
})

function seedSourceProject(sourceFolder: string): void {
    writeFileSync(join(sourceFolder, 'config.h'), SOURCE_CONFIG_H, 'utf-8')
    writeFileSync(join(sourceFolder, 'myOldRoster.h'), SOURCE_ROSTER_H, 'utf-8')
    writeFileSync(join(sourceFolder, 'myOldTurnouts.h'), SOURCE_TURNOUTS_H, 'utf-8')
    writeFileSync(join(sourceFolder, 'myOldTurntable.h'), SOURCE_TURNTABLE_H, 'utf-8')
}

test.describe('Import Existing Project', () => {
    test('imports a scattered project into the destination folder, resolving alias-named ids, and leaves the source untouched', async ({ electronApp, homePage, sourceFolder, destFolder }) => {
        seedSourceProject(sourceFolder)
        const beforeSnapshot = new Map(
            readdirSync(sourceFolder).map(name => [name, readFileSync(join(sourceFolder, name), 'utf-8')]),
        )

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Import Existing Project').first().click()

        // Import Summary dialog appears with the scanned file count.
        await expect(homePage.getByText('Import Summary')).toBeVisible({ timeout: 10_000 })
        await expect(homePage.getByTestId('import-summary-file-row')).toHaveCount(4)

        // Second folder picker (destination) — re-mock before triggering it.
        await mockSelectDirectory(electronApp, destFolder)
        await homePage.getByTestId('import-summary-continue-button').click()

        // Navigates to workspace once the import completes.
        await expect(homePage.getByText('Roster', { exact: true })).toBeVisible({ timeout: 15_000 })

        // Destination folder actually has the merged, canonical files.
        const destFiles = readdirSync(destFolder)
        expect(destFiles).toContain('myRoster.h')
        expect(destFiles).toContain('myTurnouts.h')
        expect(destFiles).toContain('config.h')

        const destTurnouts = readFileSync(join(destFolder, 'myTurnouts.h'), 'utf-8')
        // TRN_A (alias) resolved to its numeric value 100, addr 20 — not left as the alias name.
        expect(destTurnouts).toContain('TURNOUT(100, 20, 0, "Yard")')

        const destRoster = readFileSync(join(destFolder, 'myRoster.h'), 'utf-8')
        expect(destRoster).toContain('Thomas')

        // Turntable content has no structured home — must survive as leftover, not vanish.
        const leftoverFile = destFiles.find(name => name.includes('Turntable'))
        expect(leftoverFile).toBeDefined()
        const leftoverContent = readFileSync(join(destFolder, leftoverFile!), 'utf-8')
        expect(leftoverContent).toContain('DCC_TURNTABLE(1, 200)')

        // The whole point of this feature: the original folder is byte-for-byte unchanged.
        const afterSnapshot = new Map(
            readdirSync(sourceFolder).map(name => [name, readFileSync(join(sourceFolder, name), 'utf-8')]),
        )
        expect(afterSnapshot).toEqual(beforeSnapshot)
    })

    test('cancelling at the import summary dialog aborts — no destination picker, no files written anywhere', async ({ electronApp, homePage, sourceFolder, destFolder }) => {
        seedSourceProject(sourceFolder)

        await mockSelectDirectory(electronApp, sourceFolder)
        await homePage.getByText('Import Existing Project').first().click()
        await expect(homePage.getByText('Import Summary')).toBeVisible({ timeout: 10_000 })

        // If Cancel wrongly proceeded, this second picker mock would be consumed by an
        // unexpected destination-folder prompt — left in place deliberately as a tripwire.
        await mockSelectDirectory(electronApp, destFolder)
        await homePage.getByTestId('import-summary-cancel-button').click()

        await expect(homePage.getByText('Import Summary')).not.toBeVisible()
        await expect(homePage.getByText('Import Existing Project').first()).toBeVisible()
        expect(readdirSync(destFolder)).toEqual([])
    })
})
