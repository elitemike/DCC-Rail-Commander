/**
 * Shared IPC type contracts — imported by main, preload, and renderer.
 * Keep this file free of Node.js / browser-only dependencies so it is
 * safe to import from every process.
 */

// ── USB / Serial ─────────────────────────────────────────────────────────────

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

// ── Python ───────────────────────────────────────────────────────────────────

export interface PythonJobOptions {
    script: string
    args?: string[]
    cwd?: string
    env?: Record<string, string>
    mode?: 'text' | 'json' | 'binary'
}

export interface PythonJobResult {
    jobId: string
    exitCode: number | null
    output: string[]
    error?: string
}

// ── Window-level API surfaces exposed through contextBridge ──────────────────

export interface UsbElectronApi {
    listSerialPorts: () => Promise<SerialDeviceInfo[]>
    listUsbDevices: () => Promise<UsbDeviceInfo[]>
    openPort: (path: string, baudRate?: number) => Promise<void>
    writeToPort: (path: string, data: string) => Promise<void>
    closePort: (path: string) => Promise<void>
    onData: (cb: (payload: { path: string; data: string }) => void) => () => void
    onError: (cb: (payload: { path: string; message: string }) => void) => () => void
    onClosed: (cb: (payload: { path: string }) => void) => () => void
    onAttached: (cb: (payload: { vendorId: number; productId: number }) => void) => () => void
    onDetached: (cb: (payload: { vendorId: number; productId: number }) => void) => () => void
}

export interface PythonElectronApi {
    run: (options: PythonJobOptions) => Promise<PythonJobResult>
    send: (jobId: string, message: string) => Promise<void>
    kill: (jobId: string) => Promise<void>
    onStdout: (cb: (payload: { jobId: string; line: string }) => void) => () => void
    onStderr: (cb: (payload: { jobId: string; line: string }) => void) => () => void
    onDone: (cb: (result: PythonJobResult) => void) => () => void
    onError: (cb: (payload: { jobId: string; message: string }) => void) => () => void
}

// ── Augment Window global ─────────────────────────────────────────────────────

declare global {
    interface Window {
        usb: UsbElectronApi
        python: PythonElectronApi
    }
}
