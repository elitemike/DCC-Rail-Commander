import { ipcMain } from 'electron'
import type { UsbManager } from '../usb-manager'
import { IS_MOCK_DEVICE } from '../index'
import { MOCK_SERIAL_PORTS } from '../dev-mock'
import { mockSerialTransport } from '../mock-serial-transport'

/**
 * IPC handlers for USB / serial-port operations.
 *
 * Renderer sends requests on these channels and awaits the reply:
 *
 *  usb:list-serial-ports   → SerialDeviceInfo[]
 *  usb:list-usb-devices    → UsbDeviceInfo[]
 *  usb:open-port           → void   (throws on failure)
 *  usb:write-to-port       → void
 *  usb:close-port          → void
 *  usb:is-port-open        → boolean
 *
 * Main → Renderer push events (no reply expected):
 *  usb:data      { path, data }
 *  usb:error     { path, message }
 *  usb:closed    { path }
 *  usb:attached  { vendorId, productId }
 *  usb:detached  { vendorId, productId }
 *
 * Under --mock-device, open/write/close/is-open are served by
 * MockSerialTransport instead of the real UsbManager, since mock port paths
 * (e.g. /dev/ttyACM1) don't correspond to real hardware on the test machine.
 */
export function registerUsbIpcHandlers(usbManager: UsbManager): void {
    ipcMain.handle('usb:list-serial-ports', async () => {
        if (IS_MOCK_DEVICE) return MOCK_SERIAL_PORTS
        return usbManager.listSerialPorts()
    })

    ipcMain.handle('usb:list-usb-devices', () => {
        if (IS_MOCK_DEVICE) return []
        return usbManager.listUsbDevices()
    })

    ipcMain.handle(
        'usb:open-port',
        async (_event, path: string, baudRate?: number) => {
            if (IS_MOCK_DEVICE) return mockSerialTransport.openPort(path)
            await usbManager.openPort(path, baudRate)
        },
    )

    ipcMain.handle(
        'usb:write-to-port',
        async (_event, path: string, data: string) => {
            if (IS_MOCK_DEVICE) return mockSerialTransport.writeToPort(path, data)
            await usbManager.writeToPort(path, data)
        },
    )

    ipcMain.handle('usb:close-port', async (_event, path: string) => {
        if (IS_MOCK_DEVICE) return mockSerialTransport.closePort(path)
        await usbManager.closePort(path)
    })

    ipcMain.handle('usb:is-port-open', (_event, path: string) => {
        return IS_MOCK_DEVICE ? mockSerialTransport.isPortOpen(path) : usbManager.isPortOpen(path)
    })
}
