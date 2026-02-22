import { BrowserWindow } from 'electron'
import { SerialPort } from 'serialport'
import * as usbPkg from 'usb'

// usb v2: hotplug events live on `usbPkg.usb` (the inner libusb wrapper).
// `usbPkg.getDeviceList()` is re-exported at the top level for convenience.
const usbEmitter = usbPkg.usb

export interface SerialDeviceInfo {
    path: string
    manufacturer?: string
    serialNumber?: string
    vendorId?: string
    productId?: string
}

export interface UsbDeviceInfo {
    vendorId: number
    productId: number
    deviceAddress: number
    busNumber: number
    deviceDescriptor: {
        idVendor: number
        idProduct: number
        iManufacturer: number
        iProduct: number
        iSerialNumber: number
    }
}

/**
 * UsbManager
 *
 * Manages USB device detection and serial port communication.
 * Emits events to the renderer via IPC when devices are hot-plugged.
 *
 * Serial communication uses the `serialport` npm package (Node.js native addon).
 * Raw USB HID/bulk access uses the `usb` npm package.
 */
export class UsbManager {
    private readonly openPorts = new Map<string, SerialPort>()

    constructor() {
        this.watchHotplug()
    }

    // ── Serial port helpers ────────────────────────────────────────────────────

    /** List all available serial ports (e.g. Arduino boards). */
    async listSerialPorts(): Promise<SerialDeviceInfo[]> {
        const ports = await SerialPort.list()
        return ports.map((p) => ({
            path: p.path,
            manufacturer: p.manufacturer,
            serialNumber: p.serialNumber,
            vendorId: p.vendorId,
            productId: p.productId,
        }))
    }

    /** Open a serial port and return a handle key. */
    async openPort(
        path: string,
        baudRate: number = 115200,
    ): Promise<void> {
        if (this.openPorts.has(path)) return

        return new Promise((resolve, reject) => {
            const port = new SerialPort({ path, baudRate }, (err) => {
                if (err) return reject(err)
                this.openPorts.set(path, port)
                resolve()
            })

            port.on('data', (data: Buffer) => {
                this.broadcastToRenderer('usb:data', { path, data: data.toString() })
            })

            port.on('error', (err: Error) => {
                this.broadcastToRenderer('usb:error', { path, message: err.message })
            })

            port.on('close', () => {
                this.openPorts.delete(path)
                this.broadcastToRenderer('usb:closed', { path })
            })
        })
    }

    /** Write a string or buffer to an open serial port. */
    writeToPort(path: string, data: string | Buffer): Promise<void> {
        return new Promise((resolve, reject) => {
            const port = this.openPorts.get(path)
            if (!port) return reject(new Error(`Port ${path} is not open`))
            port.write(data, (err) => (err ? reject(err) : resolve()))
        })
    }

    /** Close an open serial port. */
    closePort(path: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const port = this.openPorts.get(path)
            if (!port) return resolve()
            port.close((err) => {
                this.openPorts.delete(path)
                err ? reject(err) : resolve()
            })
        })
    }

    // ── Raw USB helpers ────────────────────────────────────────────────────────

    /** List all USB devices visible to the OS (via libusb). */
    listUsbDevices(): UsbDeviceInfo[] {
        return usbPkg.getDeviceList().map((device) => ({
            vendorId: device.deviceDescriptor.idVendor,
            productId: device.deviceDescriptor.idProduct,
            deviceAddress: device.deviceAddress,
            busNumber: device.busNumber,
            deviceDescriptor: {
                idVendor: device.deviceDescriptor.idVendor,
                idProduct: device.deviceDescriptor.idProduct,
                iManufacturer: device.deviceDescriptor.iManufacturer,
                iProduct: device.deviceDescriptor.iProduct,
                iSerialNumber: device.deviceDescriptor.iSerialNumber,
            },
        }))
    }

    // ── Hot-plug monitoring ────────────────────────────────────────────────────

    private watchHotplug(): void {
        usbEmitter.on('attach', (device) => {
            this.broadcastToRenderer('usb:attached', {
                vendorId: device.deviceDescriptor.idVendor,
                productId: device.deviceDescriptor.idProduct,
            })
        })

        usbEmitter.on('detach', (device) => {
            this.broadcastToRenderer('usb:detached', {
                vendorId: device.deviceDescriptor.idVendor,
                productId: device.deviceDescriptor.idProduct,
            })
        })
    }

    // ── Cleanup ────────────────────────────────────────────────────────────────

    dispose(): void {
        for (const [path, port] of this.openPorts) {
            if (port.isOpen) port.close(() => { })
            this.openPorts.delete(path)
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private broadcastToRenderer(channel: string, payload: unknown): void {
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send(channel, payload)
        })
    }
}
