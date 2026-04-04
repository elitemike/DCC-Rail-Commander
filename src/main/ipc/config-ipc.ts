import { ipcMain, app } from 'electron'
import { IS_MOCK_DEVICE } from '../index'

export function registerConfigIpcHandlers(): void {
    ipcMain.handle('config:get-mock', () => {
        return IS_MOCK_DEVICE
    })

    ipcMain.handle('config:get-skip-startup', () => {
        return app.commandLine.hasSwitch('skip-startup') || process.argv.includes('--skip-startup')
    })
}
