import { BrowserWindow, ipcMain } from 'electron'
import type { AppUpdaterService } from '../app-updater'

export function registerUpdaterIpcHandlers(updater: AppUpdaterService): void {
    ipcMain.handle('updater:get-state', () => updater.getState())
    ipcMain.handle('updater:check', () => updater.check())
    ipcMain.handle('updater:download', () => updater.download())
    ipcMain.handle('updater:install', () => updater.install())

    updater.onStateChanged((state) => {
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send('updater:state-changed', state)
        }
    })
}
