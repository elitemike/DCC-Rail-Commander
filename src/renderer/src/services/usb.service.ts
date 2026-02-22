import { DI } from 'aurelia'
import type { SerialDeviceInfo, UsbDeviceInfo } from '../../../types/ipc'

/**
 * UsbService
 *
 * Wraps window.usb (the contextBridge API) and surfaces reactive state to
 * Aurelia components via observable properties.
 */
export const IUsbService = DI.createInterface<UsbService>('IUsbService')

export class UsbService {
    serialPorts: SerialDeviceInfo[] = []
    usbDevices: UsbDeviceInfo[] = []
    log: string[] = []

    private readonly unsubscribers: Array<() => void> = []

    async initialize(): Promise<void> {
        if (!window.usb) return

        // Initial device scan
        await this.refresh()

        // Subscribe to hot-plug events pushed from the main process
        this.unsubscribers.push(
            window.usb.onAttached(({ vendorId, productId }) => {
                this.log.push(`[USB attached] VID:${vendorId.toString(16)} PID:${productId.toString(16)}`)
                this.refresh()
            }),
            window.usb.onDetached(({ vendorId, productId }) => {
                this.log.push(`[USB detached] VID:${vendorId.toString(16)} PID:${productId.toString(16)}`)
                this.refresh()
            }),
            window.usb.onData(({ path, data }) => {
                this.log.push(`[${path}] ${data}`)
            }),
            window.usb.onError(({ path, message }) => {
                this.log.push(`[${path} ERROR] ${message}`)
            }),
            window.usb.onClosed(({ path }) => {
                this.log.push(`[${path}] port closed`)
            }),
        )
    }

    async refresh(): Promise<void> {
        if (!window.usb) return
        const [serial, usb] = await Promise.all([
            window.usb.listSerialPorts(),
            window.usb.listUsbDevices(),
        ])
        this.serialPorts = serial
        this.usbDevices = usb
    }

    async openPort(path: string, baudRate = 115200): Promise<void> {
        await window.usb.openPort(path, baudRate)
    }

    async write(path: string, data: string): Promise<void> {
        await window.usb.writeToPort(path, data)
    }

    async closePort(path: string): Promise<void> {
        await window.usb.closePort(path)
    }

    dispose(): void {
        this.unsubscribers.forEach((fn) => fn())
        this.unsubscribers.length = 0
    }
}
