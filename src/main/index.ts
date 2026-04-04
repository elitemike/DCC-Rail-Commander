import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { config } from './config'
import { registerAllIpcHandlers } from './ipc'
import { UsbManager } from './usb-manager'
import { PythonRunner } from './python-runner'
import { ArduinoCliService } from './arduino-cli'
import { GitService } from './git-client'
import { FileService } from './file-manager'
import { PreferencesService } from './preferences'

// ── E2E Test isolation ───────────────────────────────────────────────────────
// Allow tests to point userData at a temp directory so preferences don't bleed.
const testDataDir = app.commandLine.getSwitchValue('test-data-dir')
if (testDataDir) {
    app.setPath('userData', testDataDir)
}

// ── Mock mode flags ─────────────────────────────────────────────────────────
/**
 * IS_MOCK_DEVICE — mocks USB/device scanning (virtual boards, no real hardware).
 * Enable with `--mock-device`.
 *
 * IS_MOCK_COMPILE — mocks arduino-cli compile/upload responses so e2e tests
 * don't require a real toolchain. Enable with `--mock-compile`.
 */
export const IS_MOCK_DEVICE =
    app.commandLine.hasSwitch('mock-device') || process.argv.includes('--mock-device')

export const IS_MOCK_COMPILE =
    app.commandLine.hasSwitch('mock-compile') || process.argv.includes('--mock-compile')

// Expose CJS require as a global so Playwright's app.evaluate() can call it.
// evaluate() runs in a V8 eval context where the CJS module-wrapper's `require`
// is not in scope. This allows load-from-folder tests to mock IPC handlers.
if (IS_MOCK_DEVICE) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ; (global as Record<string, unknown>).__e2eRequire = require
}

if (config.disableHardwareAcceleration) app.disableHardwareAcceleration()

if (config.disableDBus && process.platform === 'linux') {
    process.env['DBUS_SESSION_BUS_ADDRESS'] ??= 'disabled:'
}
if (config.disableMediaSession) {
    app.commandLine.appendSwitch('disable-features', 'MediaSessionService')
}

// Enable Chromium remote DevTools protocol so VS Code's Chrome debugger
// can attach to the renderer process on port 9222 during development.
if (process.env['ELECTRON_RENDERER_URL']) {
    app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

// ── Singletons shared between IPC handlers ──────────────────────────────────
export const usbManager = new UsbManager()
export const pythonRunner = new PythonRunner()
export const arduinoCliService = new ArduinoCliService()
export const gitService = new GitService()
export const fileService = new FileService()
export const preferencesService = new PreferencesService()

// ── Window factory ───────────────────────────────────────────────────────────
function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: config.window.width,
        height: config.window.height,
        minWidth: config.window.minWidth,
        minHeight: config.window.minHeight,
        resizable: config.window.resizable,
        maximizable: config.window.maximizable,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            // In E2E test mode the renderer loads from file:// rather than a
            // localhost dev-server URL.  Third-party libraries (e.g. Syncfusion)
            // perform domain-based license validation that passes on localhost
            // but fires alert overlays on file://.  Disabling web-security for
            // the test window makes file:// behave like a local trusted origin.
            webSecurity: !testDataDir,
        },
    })

    win.on('ready-to-show', () => {
        win.show()
        if (process.env['ELECTRON_RENDERER_URL']) {
            //win.webContents.openDevTools()
        }
    })

    // ── Unsaved-changes prompt ────────────────────────────────────────────────
    // Intercept the window close button. In E2E test mode close immediately;
    // otherwise ask the renderer to show its own styled confirmation dialog.
    // The renderer calls window:force-close back via IPC if the user confirms.
    win.on('close', (event) => {
        if (testDataDir) {
            // E2E mode: always close without prompting.
            return
        }
        event.preventDefault()
        win.webContents.send('window:close-requested')
    })

    ipcMain.handle('window:force-close', () => {
        win.destroy()
    })

    // F5 or Ctrl+R / Cmd+R → reload the renderer
    // F12 or Ctrl+Shift+I / Cmd+Option+I → toggle DevTools
    win.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return
        const reload =
            input.key === 'F5' ||
            ((input.control || input.meta) && input.key === 'r')
        if (reload) {
            event.preventDefault()   // stop Chromium's built-in reload (would restore the hash URL)
            if (process.env['ELECTRON_RENDERER_URL']) {
                win.loadURL(process.env['ELECTRON_RENDERER_URL'])
            } else {
                win.loadFile(join(__dirname, '../renderer/index.html'))
            }
            return
        }

        const devtools =
            input.key === 'F12' ||
            ((input.control || input.meta) && input.shift && input.key === 'I')
        if (devtools) win.webContents.toggleDevTools()
    })

    // Open external links in the OS browser, not in Electron
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url)
        return { action: 'deny' }
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
        // Dev: Vite dev-server URL injected by electron-vite
        win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        // Prod: load compiled HTML
        win.loadFile(join(__dirname, '../renderer/index.html'))
    }

    return win
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    registerAllIpcHandlers({
        usbManager,
        pythonRunner,
        arduinoCliService,
        gitService,
        fileService,
        preferencesService,
    })
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    usbManager.dispose()
    pythonRunner.killAll()
    if (process.platform !== 'darwin') app.quit()
})
