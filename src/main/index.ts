import { app, BrowserWindow, ipcMain, powerMonitor, shell } from 'electron'
import { join } from 'path'
import { config } from './config'
import { registerAllIpcHandlers } from './ipc'
import { UsbManager } from './usb-manager'
import { PythonRunner } from './python-runner'
import { PlatformIoService } from './platformio'
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
 * IS_MOCK_UPLOAD — mocks the PlatformIO upload (flash-to-device) response only.
 * Compile always runs for real, against the bundled toolchain — it never touches
 * hardware, so there's no reason to fake it. Upload does write to a physical
 * serial port, which e2e tests can never have, so it stays mocked whenever this
 * flag is set. Enable with `--mock-upload`.
 */
export const IS_MOCK_DEVICE =
    app.commandLine.hasSwitch('mock-device') || process.argv.includes('--mock-device')

export const IS_MOCK_UPLOAD =
    app.commandLine.hasSwitch('mock-upload') || process.argv.includes('--mock-upload')

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
export const platformIoService = new PlatformIoService(usbManager)
export const gitService = new GitService()
export const fileService = new FileService()
export const preferencesService = new PreferencesService()

// ── Window factory ───────────────────────────────────────────────────────────
// electron-builder's win/linux `icon` config only brands the packaged installer/exe —
// it has no effect on a window created at runtime, so `pnpm dev`/`pnpm debug` (which run
// the stock electron.exe binary) need the icon set here too.
const windowIconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')

function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
        icon: windowIconPath,
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
            // Chromium's default background throttling suspends/heavily throttles the
            // renderer's timers and rendering once the window is occluded or minimized —
            // after it's been in effect for a long stretch (monitor sleep from inactivity,
            // window backgrounded for a while, not just an explicit OS lock), resuming has
            // been known to leave the window permanently blank/frozen instead of catching
            // back up. This is a desktop config tool, not a page that needs to save battery
            // while backgrounded, so there's no upside to leaving it on.
            backgroundThrottling: false,
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

    // ── Native full screen (hides OS title bar / chrome entirely) ────────────
    // Used by the Throttle panel's full-screen toggle so operating a bank of
    // throttles can use the whole display, not just the app's content area.
    ipcMain.handle('window:set-fullscreen', (_event, value: boolean) => {
        win.setFullScreen(value)
    })
    ipcMain.handle('window:is-fullscreen', () => win.isFullScreen())
    // Keep the renderer in sync if the user exits native full screen via an
    // OS-level shortcut (Esc, the green traffic-light button, F11, etc.)
    // rather than the in-app toggle.
    win.on('enter-full-screen', () => win.webContents.send('window:fullscreen-changed', true))
    win.on('leave-full-screen', () => win.webContents.send('window:fullscreen-changed', false))

    const reloadContent = (): void => {
        if (process.env['ELECTRON_RENDERER_URL']) {
            win.loadURL(process.env['ELECTRON_RENDERER_URL'])
        } else {
            win.loadFile(join(__dirname, '../renderer/index.html'))
        }
    }

    // F5 or Ctrl+R / Cmd+R → reload the renderer
    // F12 or Ctrl+Shift+I / Cmd+Option+I → toggle DevTools
    win.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return
        const reload =
            input.key === 'F5' ||
            ((input.control || input.meta) && input.key === 'r')
        if (reload) {
            event.preventDefault()   // stop Chromium's built-in reload (would restore the hash URL)
            reloadContent()
            return
        }

        const devtools =
            input.key === 'F12' ||
            ((input.control || input.meta) && input.shift && input.key === 'I')
        if (devtools) win.webContents.toggleDevTools()
    })

    // ── Recovery from a blank/frozen window ───────────────────────────────────
    // Reported symptom: the app sometimes goes blank after being left alone for a
    // long time (locked, monitor slept from inactivity, just backgrounded a while)
    // and needs a full restart. Known Chromium behaviors cause this, and none
    // self-heal without help:
    //  1. A window fully occluded for a long stretch can come back without
    //     Chromium scheduling a repaint — `invalidate()` is Electron's documented
    //     fix, forcing one. `resume`/`unlock-screen` cover the OS-lock and
    //     system-sleep cases; `focus`/`show`/`restore` catch the same problem
    //     however the window became occluded (e.g. the monitor merely slept from
    //     inactivity without an explicit OS lock, which fires none of those).
    //  2. If the renderer process actually crashes/OOMs while occluded, the
    //     window just sits blank forever with nothing to reload it — so do
    //     that automatically instead of requiring the user to restart the app.
    const forceRepaint = (): void => {
        if (!win.isDestroyed()) win.webContents.invalidate()
    }
    powerMonitor.on('resume', forceRepaint)
    powerMonitor.on('unlock-screen', forceRepaint)
    win.on('focus', forceRepaint)
    win.on('show', forceRepaint)
    win.on('restore', forceRepaint)
    win.webContents.on('render-process-gone', (_event, details) => {
        if (win.isDestroyed()) return
        console.error(`Renderer process gone (${details.reason}), reloading window`)
        reloadContent()
    })

    // Open external links in the OS browser, not in Electron
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url)
        return { action: 'deny' }
    })

    reloadContent()

    return win
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    registerAllIpcHandlers({
        usbManager,
        pythonRunner,
        platformIoService,
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
