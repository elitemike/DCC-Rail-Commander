import { ipcMain, nativeTheme, BrowserWindow } from 'electron'

/**
 * IPC handlers for OS-level dark/light theme detection.
 *
 * `nativeTheme` is Electron's own cross-platform theme source — it reads the
 * OS setting natively (Windows registry, macOS effectiveAppearance, Linux
 * GSettings) rather than relying on the renderer's `prefers-color-scheme`
 * CSS media query, which on Linux can be affected by things like this app's
 * own D-Bus session handling (see config.ts's disableDBus).
 *
 * theme:should-use-dark-colors → boolean          (renderer polls once at startup)
 * theme:updated  (push, no reply)                 (renderer subscribes for live OS changes)
 */
export function registerThemeIpcHandlers(): void {
    ipcMain.handle('theme:should-use-dark-colors', () => {
        return nativeTheme.shouldUseDarkColors
    })

    nativeTheme.on('updated', () => {
        const dark = nativeTheme.shouldUseDarkColors
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send('theme:updated', dark)
        })
    })
}
