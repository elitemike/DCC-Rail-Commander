import { ipcMain, BrowserWindow } from 'electron'
import type { ArduinoCliService } from '../arduino-cli'

export function registerArduinoCliIpcHandlers(arduinoCliService: ArduinoCliService): void {
    // Wire up progress events to renderer
    arduinoCliService.setProgressCallback((phase, message) => {
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send('arduino-cli:progress', { phase, message })
        })
    })

    ipcMain.handle('arduino-cli:is-installed', () => {
        return arduinoCliService.isInstalled()
    })

    ipcMain.handle('arduino-cli:get-version', async () => {
        return arduinoCliService.getVersion()
    })

    ipcMain.handle('arduino-cli:download', async () => {
        return arduinoCliService.downloadCli()
    })

    ipcMain.handle('arduino-cli:install-platform', async (_event, platform: string, version?: string) => {
        return arduinoCliService.installPlatform(platform, version)
    })

    ipcMain.handle('arduino-cli:install-library', async (_event, library: string, version?: string) => {
        return arduinoCliService.installLibrary(library, version)
    })

    ipcMain.handle('arduino-cli:get-platforms', async () => {
        return arduinoCliService.getPlatforms()
    })

    ipcMain.handle('arduino-cli:get-libraries', async () => {
        return arduinoCliService.getLibraries()
    })

    ipcMain.handle('arduino-cli:list-boards', async () => {
        return arduinoCliService.listBoards()
    })

    ipcMain.handle('arduino-cli:compile', async (_event, sketchPath: string, fqbn: string) => {
        return arduinoCliService.compile(sketchPath, fqbn)
    })

    ipcMain.handle('arduino-cli:upload', async (_event, sketchPath: string, fqbn: string, port: string) => {
        return arduinoCliService.upload(sketchPath, fqbn, port)
    })

    ipcMain.handle('arduino-cli:init-config', async () => {
        return arduinoCliService.initConfig()
    })

    ipcMain.handle('arduino-cli:update-index', async () => {
        return arduinoCliService.updateIndex()
    })
}
