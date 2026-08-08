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

    /** cab -> last known {speedByte, functmap}, so a bare `<t cab>` status request has something to echo back. */
    private readonly cabState = new Map<number, { speedByte: number; functmap: number }>()

    private _synthesizeResponse(raw: string): string | null {
        const cmd = raw.trim()
        const servoMatch = cmd.match(/^<D SERVO (\d+) (\d+)(?: (\d+))?>$/)
        if (servoMatch) {
            const [, vpin, position] = servoMatch
            return `<* SERVO ${vpin} ${position} *>\n`
        }
        const defineMatch = cmd.match(/^<T \d+ SERVO/)
        if (defineMatch) return `<O>\n`

        // Throttle: <t cab speed dir> — set + echo back as a <l> broadcast.
        const throttleMatch = cmd.match(/^<t (\d+) (\d+) ([01])>$/)
        if (throttleMatch) {
            const [, cabStr, speedStr, dirStr] = throttleMatch
            const cab = Number(cabStr)
            const speed = Number(speedStr)
            const dir = Number(dirStr)
            const speedByte = speed === 0 ? (dir ? 128 : 0) : (dir ? 128 : 0) + speed + 1
            const existing = this.cabState.get(cab)
            const functmap = existing?.functmap ?? 0
            this.cabState.set(cab, { speedByte, functmap })
            return `<l ${cab} 0 ${speedByte} ${functmap}>\n`
        }
        // Throttle status request: <t cab> — echo whatever we last recorded (0 speed if never set).
        const throttleStatusMatch = cmd.match(/^<t (\d+)>$/)
        if (throttleStatusMatch) {
            const cab = Number(throttleStatusMatch[1])
            const existing = this.cabState.get(cab) ?? { speedByte: 128, functmap: 0 }
            this.cabState.set(cab, existing)
            return `<l ${cab} 0 ${existing.speedByte} ${existing.functmap}>\n`
        }
        // Function: <F cab funct state> — no reply on real hardware; track functmap for later <t cab> queries.
        const functionMatch = cmd.match(/^<F (\d+) (\d+) ([01])>$/)
        if (functionMatch) {
            const [, cabStr, funcStr, stateStr] = functionMatch
            const cab = Number(cabStr)
            const func = Number(funcStr)
            const on = stateStr === '1'
            const existing = this.cabState.get(cab) ?? { speedByte: 128, functmap: 0 }
            const functmap = on ? existing.functmap | (1 << func) : existing.functmap & ~(1 << func)
            this.cabState.set(cab, { ...existing, functmap })
            return null
        }
        // Track power: <1> / <0>
        if (cmd === '<1>') return '<p1>\n'
        if (cmd === '<0>') return '<p0>\n'
        // Emergency stop all — no formal reply.
        if (cmd === '<!>') return null
        return null
    }

    private _broadcast(channel: string, payload: unknown): void {
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send(channel, payload)
        })
    }
}

export const mockSerialTransport = new MockSerialTransport()
