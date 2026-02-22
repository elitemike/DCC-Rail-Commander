import { ipcMain } from 'electron'
import type { FileService } from '../file-manager'

export function registerFileIpcHandlers(fileService: FileService): void {
    ipcMain.handle('files:read', async (_event, filePath: string) => {
        return fileService.readFile(filePath)
    })

    ipcMain.handle('files:write', async (_event, filePath: string, content: string) => {
        return fileService.writeFile(filePath, content)
    })

    ipcMain.handle('files:list-dir', async (_event, dirPath: string) => {
        return fileService.listDir(dirPath)
    })

    ipcMain.handle('files:exists', async (_event, filePath: string) => {
        return fileService.exists(filePath)
    })

    ipcMain.handle('files:mkdir', async (_event, dirPath: string) => {
        return fileService.mkdir(dirPath)
    })

    ipcMain.handle('files:copy', async (_event, src: string, dest: string) => {
        return fileService.copyFiles(src, dest)
    })

    ipcMain.handle('files:delete', async (_event, filePath: string) => {
        return fileService.deleteFiles(filePath)
    })

    ipcMain.handle('files:get-install-dir', async (_event, subdir?: string) => {
        return fileService.getInstallDir(subdir)
    })

    ipcMain.handle('files:select-directory', async () => {
        return fileService.selectDirectory()
    })
}
