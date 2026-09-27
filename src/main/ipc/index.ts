import { registerUsbIpcHandlers } from './usb-ipc'
import { registerPythonIpcHandlers } from './python-ipc'
import { registerPlatformIoIpcHandlers } from './platformio-ipc'
import { registerGitIpcHandlers } from './git-ipc'
import { registerFileIpcHandlers } from './file-ipc'
import { registerPreferencesIpcHandlers } from './preferences-ipc'
import { registerConfigIpcHandlers } from './config-ipc'
import { registerThemeIpcHandlers } from './theme-ipc'
import { registerLocalHistoryIpcHandlers } from './local-history-ipc'
import type { UsbManager } from '../usb-manager'
import type { PythonRunner } from '../python-runner'
import type { PlatformIoService } from '../platformio'
import type { GitService } from '../git-client'
import type { FileService } from '../file-manager'
import type { PreferencesService } from '../preferences'
import type { LocalHistoryService } from '../local-history'

export interface IpcServices {
    usbManager: UsbManager
    pythonRunner: PythonRunner
    platformIoService: PlatformIoService
    gitService: GitService
    fileService: FileService
    preferencesService: PreferencesService
    localHistoryService: LocalHistoryService
}

/**
 * Register every IPC handler group. Called once from main/index.ts
 * after `app.whenReady()` resolves.
 */
export function registerAllIpcHandlers(services: IpcServices): void {
    registerUsbIpcHandlers(services.usbManager)
    registerPythonIpcHandlers(services.pythonRunner)
    registerPlatformIoIpcHandlers(services.platformIoService)
    registerGitIpcHandlers(services.gitService)
    registerFileIpcHandlers(services.fileService)
    registerPreferencesIpcHandlers(services.preferencesService)
    registerConfigIpcHandlers()
    registerThemeIpcHandlers()
    registerLocalHistoryIpcHandlers(services.localHistoryService)
}
