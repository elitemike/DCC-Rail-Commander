import { BrowserWindow } from 'electron'

/**
 * Minimal fake serial transport used only when IS_MOCK_DEVICE is true.
 * Lets `--mock-device` E2E runs exercise usb:open-port / usb:write-to-port /
 * usb:close-port without real hardware — under mock mode those paths (e.g.
 * /dev/ttyACM1) don't exist on the test machine, so the real UsbManager
 * would fail to open them.
 *
 * Intentionally minimal — it only synthesizes responses for the commands
 * live servo calibration needs, not a general-purpose protocol simulator.
 */
export class MockSerialTransport {
    private readonly openPorts = new Set<string>()

    isPortOpen(path: string): boolean {
        return this.openPorts.has(path)
    }

    async openPort(path: string): Promise<void> {
        this.openPorts.add(path)
    }

    async writeToPort(path: string, data: string): Promise<void> {
        if (!this.openPorts.has(path)) throw new Error(`Port ${path} is not open`)
        const response = this._synthesizeResponse(data)
        if (response) {
            setTimeout(() => this._broadcast('usb:data', { path, data: response }), 20)
        }
    }

    async closePort(path: string): Promise<void> {
        this.openPorts.delete(path)
        this._broadcast('usb:closed', { path })
    }

    private _synthesizeResponse(raw: string): string | null {
        const cmd = raw.trim()
        const servoMatch = cmd.match(/^<D SERVO (\d+) (\d+)(?: (\d+))?>$/)
        if (servoMatch) {
            const [, vpin, position] = servoMatch
            return `<* SERVO ${vpin} ${position} *>\n`
        }
        const defineMatch = cmd.match(/^<T \d+ SERVO/)
        if (defineMatch) return `<O>\n`
        return null
    }

    private _broadcast(channel: string, payload: unknown): void {
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send(channel, payload)
        })
    }
}

export const mockSerialTransport = new MockSerialTransport()
