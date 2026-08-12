import { DI } from 'aurelia'
import type { SerialDeviceInfo, UsbDeviceInfo } from '../../../types/ipc'

/**
 * UsbService
 *
 * Wraps window.usb (the contextBridge API) and surfaces reactive state to
 * Aurelia components via observable properties.
 */
export const IUsbService = DI.createInterface<UsbService>('IUsbService')

type UsbWriteListener = (payload: { path: string; data: string }) => void

export class UsbService {
    serialPorts: SerialDeviceInfo[] = []
    usbDevices: UsbDeviceInfo[] = []
    log: string[] = []

    private readonly unsubscribers: Array<() => void> = []
    private readonly writeListeners: UsbWriteListener[] = []
    private initialized = false

    async initialize(): Promise<void> {
        if (this.initialized) return
        this.initialized = true

        await this.refresh()

        if (!window.usb) return

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

    /**
     * `silent` skips the onWrite broadcast — used by the Serial Monitor
     * itself, which already echoes its own typed/quick-send commands into
     * its terminal and would otherwise show every command twice. Every other
     * caller (throttle panel, config forms, etc.) leaves it unset so its
     * writes become visible there, since without it those commands go out
     * over serial with no visible trace anywhere in the app.
     */
    async write(path: string, data: string, options?: { silent?: boolean }): Promise<void> {
        if (!options?.silent) {
            this.writeListeners.forEach((fn) => fn({ path, data }))
        }
        await window.usb.writeToPort(path, data)
    }

    /** Notified on every non-silent write(), regardless of which service/component sent it. */
    onWrite(cb: UsbWriteListener): () => void {
        this.writeListeners.push(cb)
        return () => {
            const idx = this.writeListeners.indexOf(cb)
            if (idx !== -1) this.writeListeners.splice(idx, 1)
        }
    }

    async closePort(path: string): Promise<void> {
        await window.usb.closePort(path)
    }

    async isPortOpen(path: string): Promise<boolean> {
        return window.usb.isPortOpen(path)
    }

    dispose(): void {
        this.unsubscribers.forEach((fn) => fn())
        this.unsubscribers.length = 0
    }
}
