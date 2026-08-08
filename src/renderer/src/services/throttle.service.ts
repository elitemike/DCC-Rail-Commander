import { resolve } from 'aurelia'
import { InstallerState } from '../models/installer-state'
import { ConfigEditorState } from '../models/config-editor-state'
import { UsbService } from './usb.service'
import { createLineSplitter } from '../utils/serial-line-buffer'
import { deriveRouteStatus, parseRouteTurnoutCommands, type RouteStatus, type TurnoutLiveState } from '../utils/routeStatus'

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

/** DCC-EX turnout broadcast, sent on change and in reply to `<T>`/`<T id state>`. */
const TURNOUT_RESPONSE_RE = /^<H\s+(\d+)\s+([01])>$/

export interface TurnoutStatus {
    id: number
    state: TurnoutLiveState
}

export interface RouteStatusEntry {
    id: number
    status: RouteStatus
}

/**
 * How often turnout states are re-queried (`<T>`). Locos don't need an
 * equivalent poll: DCC-EX broadcasts `<l cab reg speedByte functmap>` to
 * every connected client whenever a cab's speed *or* function state changes,
 * regardless of which throttle (this app, another instance, WiFi/JMRI, a
 * physical cab) issued the `<t>`/`<F>` command — confirmed by capturing the
 * broadcast in the serial monitor for an `<F>`-only change. So the one-off
 * `<t cab>` sent from acquire() to seed a newly-acquired cab's current state
 * is enough; live changes after that arrive on their own. Turnouts get their
 * own timer here because a `<T>` reply usefully covers every turnout at once,
 * unlike a per-cab request.
 */
const TURNOUT_POLL_INTERVAL_MS = 10_000

/**
 * How long to wait after a `<T>` query before assuming any turnout still
 * showing UNKNOWN is actually CLOSED. A real, defined turnout always answers
 * `<T>` with an `<H id state>` line — there's no such thing as a turnout
 * whose state is genuinely unknown to the command station itself. UNKNOWN is
 * only ever "haven't heard back yet" on our end, so treating it as an
 * indefinite third state left every never-toggled turnout stuck showing
 * Unknown (and its badge never highlighting) even once a real reply would
 * have arrived. A late or missing `<H>` still just means "assume closed,
 * like a fresh device" — a genuine broadcast arriving afterwards overrides it.
 */
const TURNOUT_UNKNOWN_GRACE_MS = 3000

/**
 * ThrottleService — drives locos over the already-open serial connection
 * using the native DCC-EX command set (see NATIVE_COMMAND_DOCS in
 * serial-monitor.ts for the canonical command reference). Tracks one entry
 * per acquired cab; "acquire" is purely local bookkeeping — DCC-EX has no
 * device-side throttle-session concept, any number of cabs can be driven
 * concurrently over one connection, including other throttles entirely
 * outside this app (WiFi apps, JMRI, physical cabs) — their speed/function
 * changes reach us the same way ours do, via the `<l>` broadcast (see
 * TURNOUT_POLL_INTERVAL_MS for why locos don't need a poll but turnouts do).
 *
 * All writes go through a single queue so concurrent throttle cards never
 * interleave bytes on the one open port.
 */
export class ThrottleService {
    private readonly state = resolve(InstallerState)
    private readonly usb = resolve(UsbService)
    private readonly configEditorState = resolve(ConfigEditorState)

    /**
     * Mutated via push()/splice() rather than reassigned, and each cab's
     * fields are mutated in place rather than replaced — the array and its
     * entries keep stable identity across updates so `repeat.for="t of
     * throttleService.throttles"` in throttle-panel only adds/removes the
     * view for the cab that actually changed, instead of tearing down every
     * throttle-card (and its Syncfusion Slider) on every speed update.
     */
    readonly throttles: ThrottleCabState[] = []

    /** Track power state — null until the first `<p0>`/`<p1>` line arrives (seeded by the `<s>` sent from initialize()). */
    trackPower: boolean | null = null

    /**
     * One stable entry per configured turnout, seeded up front (see
     * _seedTurnoutAndRouteStatuses) so views can bind to an entry's object
     * reference before its live state is known, rather than a `find() ??
     * fallback` per render that would leave the view bound to a throwaway
     * object once the real broadcast arrives. Mutated in place, like `throttles`.
     */
    readonly turnoutStatuses: TurnoutStatus[] = []

    /** One stable entry per configured route — see turnoutStatuses for why these are seeded and mutated in place. */
    readonly routeStatuses: RouteStatusEntry[] = []

    private unsubData?: () => void
    private readonly lineSplitter = createLineSplitter((line) => this._handleLine(line))
    private writeQueue: Promise<void> = Promise.resolve()
    private turnoutPollTimer?: ReturnType<typeof setInterval>
    private assumeClosedTimer?: ReturnType<typeof setTimeout>

    /** Starts listening for `<l ...>`/`<p...>`/`<H ...>` broadcasts and polling for full state on the selected device's port. Safe to call more than once. */
    initialize(): void {
        if (this.unsubData || !window.usb) return
        this.unsubData = window.usb.onData(({ path, data }) => {
            if (path !== this.state.selectedDevice?.port) return
            this.lineSplitter.feed(data)
        })
        this._seedTurnoutAndRouteStatuses()
        void this._send('<s>') // seed the initial track-power state
        this._queryTurnouts()
        this.turnoutPollTimer = setInterval(() => this._pollTurnouts(), TURNOUT_POLL_INTERVAL_MS)
    }

    /** Sends `<T>` and schedules the UNKNOWN -> CLOSED grace-period fallback — see TURNOUT_UNKNOWN_GRACE_MS. */
    private _queryTurnouts(): void {
        void this._send('<T>')
        if (this.assumeClosedTimer) clearTimeout(this.assumeClosedTimer)
        this.assumeClosedTimer = setTimeout(() => this._assumeUnknownTurnoutsClosed(), TURNOUT_UNKNOWN_GRACE_MS)
    }

    private _assumeUnknownTurnoutsClosed(): void {
        let changed = false
        for (const entry of this.turnoutStatuses) {
            if (entry.state === 'UNKNOWN') {
                entry.state = 'CLOSED'
                changed = true
            }
        }
        if (changed) this._recomputeRouteStatuses()
    }

    /**
     * Ensures every currently-configured turnout/route has a stable status
     * entry before any view binds to it — find-or-create, never replaces an
     * existing entry. Re-run on every poll (cheap) so turnouts/routes added
     * or removed via the config editor while the panel is open still get an
     * entry without waiting for a remount.
     */
    private _seedTurnoutAndRouteStatuses(): void {
        for (const turnout of this.configEditorState.turnouts) {
            if (!this.turnoutStatuses.some((s) => s.id === turnout.id)) {
                this.turnoutStatuses.push({ id: turnout.id, state: 'UNKNOWN' })
            }
        }
        for (const route of this.configEditorState.routes) {
            if (!this.routeStatuses.some((s) => s.id === route.id)) {
                this.routeStatuses.push({ id: route.id, status: 'UNKNOWN' })
            }
        }
    }

    dispose(): void {
        this.unsubData?.()
        this.unsubData = undefined
        if (this.turnoutPollTimer) clearInterval(this.turnoutPollTimer)
        this.turnoutPollTimer = undefined
        if (this.assumeClosedTimer) clearTimeout(this.assumeClosedTimer)
        this.assumeClosedTimer = undefined
    }

    /** Re-requests turnout states — see TURNOUT_POLL_INTERVAL_MS. */
    private _pollTurnouts(): void {
        this._seedTurnoutAndRouteStatuses()
        this._queryTurnouts()
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

    /**
     * Requests a turnout throw/close. Deliberately does not optimistically
     * mutate local state — turnout movement isn't instant, so the badge only
     * updates once the command station's own `<H id state>` echo arrives.
     */
    throwTurnout(id: number): void {
        void this._send(`<T ${id} 1>`)
    }

    closeTurnout(id: number): void {
        void this._send(`<T ${id} 0>`)
    }

    /**
     * Runs a route's EX-RAIL sequence. `</ START id>` is fire-and-forget on
     * real hardware — the command station's own firmware throws/closes the
     * turnouts and broadcasts <H> as it goes. The mock transport has no
     * EXRAIL interpreter, so nothing would visibly happen there otherwise;
     * replaying the route's THROW/CLOSE calls as explicit <T id state>
     * commands afterward makes the mock actually update turnout state (and
     * is harmless on real hardware — same end state, briefly redundant).
     */
    triggerRoute(id: number): void {
        void this._send(`</ START ${id}>`)
        const route = this.configEditorState.routes.find((r) => r.id === id)
        if (!route) return
        for (const { id: turnoutId, state } of parseRouteTurnoutCommands(route.body)) {
            void this._send(`<T ${turnoutId} ${state === 'THROWN' ? 1 : 0}>`)
        }
    }

    powerOn(): void {
        this.trackPower = true
        void this._send('<1>')
    }

    powerOff(): void {
        this.trackPower = false
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
        const trimmed = line.trim()
        if (trimmed === '<p1>') { this.trackPower = true; return }
        if (trimmed === '<p0>') { this.trackPower = false; return }

        const turnoutMatch = TURNOUT_RESPONSE_RE.exec(trimmed)
        if (turnoutMatch) {
            const id = Number(turnoutMatch[1])
            const state: TurnoutLiveState = turnoutMatch[2] === '1' ? 'THROWN' : 'CLOSED'
            let entry = this.turnoutStatuses.find((s) => s.id === id)
            if (!entry) {
                entry = { id, state: 'UNKNOWN' }
                this.turnoutStatuses.push(entry)
            }
            if (entry.state !== state) {
                entry.state = state
                this._recomputeRouteStatuses()
            }
            return
        }

        const match = LOCO_RESPONSE_RE.exec(trimmed)
        if (!match) return
        const cab = Number(match[1])
        const t = this._find(cab)
        if (!t) return
        const { speed, direction } = decodeSpeedByte(Number(match[3]))
        t.speed = speed
        t.direction = direction
        t.functions = decodeFunctionMap(Number(match[4]))
    }

    /** Recomputes every route's status from current live turnout state. Cheap enough to run in full on every `<H>` line rather than tracking a reverse turnout->route index. */
    private _recomputeRouteStatuses(): void {
        const live = new Map<number, TurnoutLiveState>(this.turnoutStatuses.map((s) => [s.id, s.state]))
        for (const entry of this.routeStatuses) {
            const route = this.configEditorState.routes.find((r) => r.id === entry.id)
            if (!route) continue
            const status = deriveRouteStatus(route.body, live)
            if (entry.status !== status) entry.status = status
        }
    }
}
