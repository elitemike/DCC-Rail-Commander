import { registerUsbIpcHandlers } from './usb-ipc'
import { registerPythonIpcHandlers } from './python-ipc'

/**
 * Register every IPC handler group. Called once from main/index.ts
 * after `app.whenReady()` resolves.
 */
export function registerAllIpcHandlers(): void {
    registerUsbIpcHandlers()
    registerPythonIpcHandlers()
}
