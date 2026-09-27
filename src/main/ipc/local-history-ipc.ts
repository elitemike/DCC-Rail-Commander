import { ipcMain } from 'electron'
import type { LocalHistoryService } from '../local-history'

export function registerLocalHistoryIpcHandlers(localHistoryService: LocalHistoryService): void {
    ipcMain.handle('local-history:record', (_event, projectKey: string, fileName: string, content: string) => {
        localHistoryService.record(projectKey, fileName, content)
    })

    ipcMain.handle('local-history:list', (_event, projectKey: string, fileName: string) => {
        return localHistoryService.list(projectKey, fileName)
    })
}
