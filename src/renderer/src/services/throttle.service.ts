import { resolve } from 'aurelia'
import { InstallerState } from '../models/installer-state'
import { UsbService } from './usb.service'
import { createLineSplitter } from '../utils/serial-line-buffer'

/** F0-F28 — matches the 29-function cap already enforced by the roster editor. */
export const MAX_FUNCTIONS = 29

export interface ThrottleCabState {
    cab: number
    name: string
    /** Plain 0-126 speed (not the wire-encoded byte used by the `<l>` response). */
    speed: number
    direction: 0 | 1
    /** functions[n] === state of Fn */
    functions: boolean[]
}

/**
 * Decodes the speed byte from a DCC-EX `<l cab reg speedByte functmap>`
 * broadcast. Per the DCC-EX native command reference: reverse direction is
 * byte 0 (stop) / 1 (e-stop) / 2-127 (speed 1-126); forward direction adds a
 * +128 offset (128 stop / 129 e-stop / 130-255 speed 1-126). E-stop collapses
 * to speed 0 here since this app has no separate per-cab e-stop control.
 */
export function decodeSpeedByte(byte: number): { speed: number; direction: 0 | 1 } {
    const direction: 0 | 1 = byte >= 128 ? 1 : 0
    const rel = byte - (direction ? 128 : 0)
    const speed = rel <= 1 ? 0 : rel - 1
    return { speed, direction }
}

/** Bit N of `functmap` is the state of function Fn. */
export function decodeFunctionMap(functmap: number, count: number = MAX_FUNCTIONS): boolean[] {
    return Array.from({ length: count }, (_, i) => (functmap & (1 << i)) !== 0)
}

const LOCO_RESPONSE_RE = /^<l\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)>$/

/**
 * How often each acquired cab's full state (speed/direction/functions) is
 * re-requested via `<t cab>`. Needed because DCC-EX only *broadcasts* an
 * `<l>` update when a `<t>` (speed/direction) command runs — a `<F>`
 * (function) command from another throttle produces no broadcast at all, so
 * without this poll we'd never learn that someone else toggled a function on
 * a loco we're also watching.
 */
const POLL_INTERVAL_MS = 2000

/**
 * ThrottleService — drives locos over the already-open serial connection
 * using the native DCC-EX command set (see NATIVE_COMMAND_DOCS in
 * serial-monitor.ts for the canonical command reference). Tracks one entry
 * per acquired cab; "acquire" is purely local bookkeeping — DCC-EX has no
 * device-side throttle-session concept, any number of cabs can be driven
 * concurrently over one connection, including other throttles entirely
 * outside this app (WiFi apps, JMRI, physical cabs) — see POLL_INTERVAL_MS
 * for how their changes make it back into our state.
 *
 * All writes go through a single queue so concurrent throttle cards never
 * interleave bytes on the one open port.
 */
export class ThrottleService {
    private readonly state = resolve(InstallerState)
    private readonly usb = resolve(UsbService)
    private pollTimer?: ReturnType<typeof setInterval>

    /**
     * Mutated via push()/splice() rather than reassigned, and each cab's
     * fields are mutated in place rather than replaced — the array and its
     * entries keep stable identity across updates so `repeat.for="t of
     * throttleService.throttles"` in throttle-panel only adds/removes the
     * view for the cab that actually changed, instead of tearing down every
     * throttle-card (and its Syncfusion Slider) on every speed update.
     */
    readonly throttles: ThrottleCabState[] = []

    private unsubData?: () => void
    private readonly lineSplitter = createLineSplitter((line) => this._handleLine(line))
    private writeQueue: Promise<void> = Promise.resolve()

    /** Starts listening for `<l ...>` broadcasts and polling for full state on the selected device's port. Safe to call more than once. */
    initialize(): void {
        if (this.unsubData || !window.usb) return
        this.unsubData = window.usb.onData(({ path, data }) => {
            if (path !== this.state.selectedDevice?.port) return
            this.lineSplitter.feed(data)
        })
        this.pollTimer = setInterval(() => this._pollAll(), POLL_INTERVAL_MS)
    }

    dispose(): void {
        this.unsubData?.()
        this.unsubData = undefined
        if (this.pollTimer) clearInterval(this.pollTimer)
        this.pollTimer = undefined
    }

    /** Re-requests every acquired cab's full state — see POLL_INTERVAL_MS. */
    private _pollAll(): void {
        for (const t of this.throttles) {
            void this._send(`<t ${t.cab}>`)
        }
    }

    isAcquired(cab: number): boolean {
        return this.throttles.some((t) => t.cab === cab)
    }

    private _find(cab: number): ThrottleCabState | undefined {
        return this.throttles.find((t) => t.cab === cab)
    }

    acquire(cab: number, name?: string): void {
        if (this.isAcquired(cab)) return
        this.throttles.push({
            cab,
            name: name ?? `Cab ${cab}`,
            speed: 0,
            direction: 1,
            functions: new Array(MAX_FUNCTIONS).fill(false),
        })
        // Pull whatever speed/direction/functions the cab is already running
        // at (e.g. set by another throttle) via the <l> broadcast this triggers.
        void this._send(`<t ${cab}>`)
    }

    release(cab: number): void {
        const idx = this.throttles.findIndex((t) => t.cab === cab)
        if (idx !== -1) this.throttles.splice(idx, 1)
    }

    setSpeed(cab: number, speed: number, direction: 0 | 1): void {
        const t = this._find(cab)
        if (!t) return
        t.speed = Math.max(0, Math.min(126, Math.round(speed)))
        t.direction = direction
        void this._send(`<t ${cab} ${t.speed} ${direction}>`)
    }

    setFunction(cab: number, func: number, active: boolean): void {
        const t = this._find(cab)
        if (!t) return
        // Reassign (rather than mutate index in place) so the `cab.functions`
        // dot-access binding in throttle-card.html — which Aurelia's binding
        // system observes — picks up the change; a bare index write on the
        // existing array is invisible to it.
        const functions = [...t.functions]
        functions[func] = active
        t.functions = functions
        void this._send(`<F ${cab} ${func} ${active ? 1 : 0}>`)
    }

    powerOn(): void {
        void this._send('<1>')
    }

    powerOff(): void {
        void this._send('<0>')
    }

    emergencyStopAll(): void {
        void this._send('<!>')
    }

    private async _send(cmd: string): Promise<void> {
        const port = this.state.selectedDevice?.port
        if (!port) return
        this.writeQueue = this.writeQueue.then(() => this.usb.write(port, cmd + '\n')).catch(() => { })
        return this.writeQueue
    }

    private _handleLine(line: string): void {
        const match = LOCO_RESPONSE_RE.exec(line.trim())
        if (!match) return
        const cab = Number(match[1])
        const t = this._find(cab)
        if (!t) return
        const { speed, direction } = decodeSpeedByte(Number(match[3]))
        t.speed = speed
        t.direction = direction
        t.functions = decodeFunctionMap(Number(match[4]))
    }
}
