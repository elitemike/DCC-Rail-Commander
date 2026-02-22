import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { config } from './config'
import { registerAllIpcHandlers } from './ipc'
import { UsbManager } from './usb-manager'
import { PythonRunner } from './python-runner'

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

// ── Window factory ───────────────────────────────────────────────────────────
function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: config.window.width,
        height: config.window.height,
        minWidth: config.window.minWidth,
        minHeight: config.window.minHeight,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
        },
    })

    win.on('ready-to-show', () => {
        win.show()
        if (process.env['ELECTRON_RENDERER_URL']) {
            win.webContents.openDevTools()
        }
    })

    // F5 or Ctrl+R / Cmd+R → reload the renderer
    win.webContents.on('before-input-event', (_event, input) => {
        const reload =
            input.type === 'keyDown' &&
            (input.key === 'F5' ||
                ((input.control || input.meta) && input.key === 'r'))
        if (reload) win.webContents.reload()
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
    registerAllIpcHandlers()
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
