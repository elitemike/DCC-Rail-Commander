import { ipcMain, BrowserWindow, dialog } from 'electron'
import type { PlatformIoService } from '../platformio'
import { IS_MOCK_DEVICE, IS_MOCK_COMPILE } from '../index'
import { MOCK_SERIAL_PORTS } from '../dev-mock'
import { lookupKnownBoard } from '../board-targets'

export function registerPlatformIoIpcHandlers(platformIo: PlatformIoService): void {
    // Wire up progress events to renderer
    platformIo.setProgressCallback((phase, message) => {
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send('pio:progress', { phase, message })
        })
    })

    ipcMain.handle('pio:is-runtime-ready', async () => {
        return platformIo.isRuntimeReady()
    })

    ipcMain.handle('pio:seed-runtime', async () => {
        return platformIo.seedRuntime()
    })

    ipcMain.handle('pio:get-version', async () => {
        return platformIo.getVersion()
    })

    ipcMain.handle('pio:get-bundled-version', () => {
        return platformIo.getBundledVersion()
    })

    ipcMain.handle('pio:get-platforms', async () => {
        return platformIo.getPlatforms()
    })

    ipcMain.handle('pio:check-toolchain', async (_event, fqbn: string) => {
        return platformIo.checkToolchain(fqbn)
    })

    ipcMain.handle('pio:list-boards', async () => {
        if (IS_MOCK_DEVICE) {
            return MOCK_SERIAL_PORTS.map((sp) => {
                const known = lookupKnownBoard(sp.vendorId, sp.productId)
                return {
                    name: known?.name ?? sp.manufacturer ?? 'Unknown device',
                    fqbn: known?.fqbn ?? '',
                    port: sp.path,
                    protocol: 'serial' as const,
                    serialNumber: sp.serialNumber,
                }
            })
        }
        return platformIo.listBoards()
    })

    ipcMain.handle('pio:compile', async (_event, sketchPath: string, fqbn: string, verbose?: boolean) => {
        console.debug('[ipc] compile request', { sketchPath, fqbn, verbose, IS_MOCK_COMPILE })
        if (IS_MOCK_COMPILE) {
            const emitMock = (msg: string) => BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed()) win.webContents.send('pio:progress', { phase: 'compile', message: msg })
            })
            await new Promise(r => setTimeout(r, 200))
            emitMock(`Compiling for ${fqbn} (mock)...`)
            await new Promise(r => setTimeout(r, 400))
            emitMock(`Sketch uses 12345 bytes (4%) of program storage space. Maximum is 253952 bytes.`)
            await new Promise(r => setTimeout(r, 200))
            emitMock(`Global variables use 2300 bytes (28%) of dynamic memory, leaving 5892 bytes for local variables.`)
            const mockResult = { success: true, output: '' }
            console.debug('[ipc] compile mock result', mockResult)
            return mockResult
        }
        const result = await platformIo.compile(sketchPath, fqbn, verbose)
        console.debug('[ipc] compile result', result)
        return result
    })

    ipcMain.handle('pio:upload', async (_event, sketchPath: string, fqbn: string, port: string, verbose?: boolean) => {
        console.debug('[ipc] upload request', { sketchPath, fqbn, port, verbose, IS_MOCK_COMPILE })
        if (IS_MOCK_COMPILE) {
            await new Promise(r => setTimeout(r, 600))
            const mockResult = {
                success: true,
                output: `Uploading to ${port} for ${fqbn} (mock)...\nFlash written successfully.`,
            }
            console.debug('[ipc] upload mock result', mockResult)
            return mockResult
        }
        const result = await platformIo.upload(sketchPath, fqbn, port, verbose)
        console.debug('[ipc] upload result', result)
        return result
    })

    // ── Offline toolchain-pack import ────────────────────────────────────────
    // The route for boards whose toolchain isn't bundled (STM32): the user
    // supplies a pack archive rather than the app downloading one.

    ipcMain.handle('pio:browse-toolchain-pack', async () => {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        const result = await dialog.showOpenDialog(win, {
            title: 'Select Toolchain Pack (.tar.gz / .zip)',
            properties: ['openFile'],
            filters: [
                { name: 'Archive', extensions: ['tar.gz', 'tgz', 'zip'] },
                { name: 'All Files', extensions: ['*'] },
            ],
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
    })

    ipcMain.handle('pio:import-toolchain-pack', async (_event, archivePath: string) => {
        return platformIo.importToolchainPack(archivePath)
    })
}
