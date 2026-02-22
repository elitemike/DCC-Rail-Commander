import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
    SerialDeviceInfo,
    UsbDeviceInfo,
    PythonJobOptions,
    PythonJobResult,
} from '../types/ipc'

// ── USB API ──────────────────────────────────────────────────────────────────
const usbApi = {
    listSerialPorts: (): Promise<SerialDeviceInfo[]> =>
        ipcRenderer.invoke('usb:list-serial-ports'),

    listUsbDevices: (): Promise<UsbDeviceInfo[]> =>
        ipcRenderer.invoke('usb:list-usb-devices'),

    openPort: (path: string, baudRate?: number): Promise<void> =>
        ipcRenderer.invoke('usb:open-port', path, baudRate),

    writeToPort: (path: string, data: string): Promise<void> =>
        ipcRenderer.invoke('usb:write-to-port', path, data),

    closePort: (path: string): Promise<void> =>
        ipcRenderer.invoke('usb:close-port', path),

    // ── Push-event subscriptions ─────────────────────────────────────────────
    onData: (cb: (payload: { path: string; data: string }) => void) => {
        const handler = (_: IpcRendererEvent, p: { path: string; data: string }) => cb(p)
        ipcRenderer.on('usb:data', handler)
        return () => ipcRenderer.off('usb:data', handler)
    },

    onError: (cb: (payload: { path: string; message: string }) => void) => {
        const handler = (_: IpcRendererEvent, p: { path: string; message: string }) => cb(p)
        ipcRenderer.on('usb:error', handler)
        return () => ipcRenderer.off('usb:error', handler)
    },

    onClosed: (cb: (payload: { path: string }) => void) => {
        const handler = (_: IpcRendererEvent, p: { path: string }) => cb(p)
        ipcRenderer.on('usb:closed', handler)
        return () => ipcRenderer.off('usb:closed', handler)
    },

    onAttached: (cb: (payload: { vendorId: number; productId: number }) => void) => {
        const handler = (_: IpcRendererEvent, p: { vendorId: number; productId: number }) => cb(p)
        ipcRenderer.on('usb:attached', handler)
        return () => ipcRenderer.off('usb:attached', handler)
    },

    onDetached: (cb: (payload: { vendorId: number; productId: number }) => void) => {
        const handler = (_: IpcRendererEvent, p: { vendorId: number; productId: number }) => cb(p)
        ipcRenderer.on('usb:detached', handler)
        return () => ipcRenderer.off('usb:detached', handler)
    },
}

// ── Python API ───────────────────────────────────────────────────────────────
const pythonApi = {
    run: (options: PythonJobOptions): Promise<PythonJobResult> =>
        ipcRenderer.invoke('python:run', options),

    send: (jobId: string, message: string): Promise<void> =>
        ipcRenderer.invoke('python:send', jobId, message),

    kill: (jobId: string): Promise<void> =>
        ipcRenderer.invoke('python:kill', jobId),

    // ── Push-event subscriptions ─────────────────────────────────────────────
    onStdout: (cb: (payload: { jobId: string; line: string }) => void) => {
        const handler = (_: IpcRendererEvent, p: { jobId: string; line: string }) => cb(p)
        ipcRenderer.on('python:stdout', handler)
        return () => ipcRenderer.off('python:stdout', handler)
    },

    onStderr: (cb: (payload: { jobId: string; line: string }) => void) => {
        const handler = (_: IpcRendererEvent, p: { jobId: string; line: string }) => cb(p)
        ipcRenderer.on('python:stderr', handler)
        return () => ipcRenderer.off('python:stderr', handler)
    },

    onDone: (cb: (result: PythonJobResult) => void) => {
        const handler = (_: IpcRendererEvent, r: PythonJobResult) => cb(r)
        ipcRenderer.on('python:done', handler)
        return () => ipcRenderer.off('python:done', handler)
    },

    onError: (cb: (payload: { jobId: string; message: string }) => void) => {
        const handler = (_: IpcRendererEvent, p: { jobId: string; message: string }) => cb(p)
        ipcRenderer.on('python:error', handler)
        return () => ipcRenderer.off('python:error', handler)
    },
}

// ── Expose to renderer via contextBridge ─────────────────────────────────────
contextBridge.exposeInMainWorld('usb', usbApi)
contextBridge.exposeInMainWorld('python', pythonApi)
