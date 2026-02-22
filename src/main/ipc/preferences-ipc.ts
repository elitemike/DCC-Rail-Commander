import { ipcMain } from 'electron'
import type { PreferencesService } from '../preferences'

export function registerPreferencesIpcHandlers(preferencesService: PreferencesService): void {
    ipcMain.handle('preferences:get', (_event, key: string) => {
        return preferencesService.get(key)
    })

    ipcMain.handle('preferences:set', (_event, key: string, value: unknown) => {
        preferencesService.set(key, value)
    })

    ipcMain.handle('preferences:get-all', () => {
        return preferencesService.getAll()
    })
}
