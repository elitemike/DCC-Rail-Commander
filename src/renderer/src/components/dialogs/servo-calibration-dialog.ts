import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { Slider, NumericTextBox } from '@syncfusion/ej2-inputs'
import type { SliderChangeEventArgs } from '@syncfusion/ej2-inputs'
import { UsbService } from '../../services/usb.service'
import type { ServoTurnout, TurnoutProfile } from '../../utils/myAutomationParser'
import {
    SERVO_POSITION_MIN,
    SERVO_POSITION_MAX,
    SERVO_POSITION_SAFE_MIN,
    SERVO_POSITION_SAFE_MAX,
    clampServoPosition,
    validateServoPosition,
    buildServoDiagnosticCommand,
} from '../../utils/servoCommands'

export interface ServoCalibrationModel {
    turnout: ServoTurnout
    devicePort: string | null
}

export interface ServoCalibrationResult {
    activeAngle: number
    inactiveAngle: number
    profile: TurnoutProfile
}

type PortStatus = 'connecting' | 'connected' | 'error' | 'unavailable'
type Endpoint = 'closed' | 'thrown'

/**
 * Live servo calibration modal, opened from the turnout editor for SERVO
 * turnouts only. The range slider is for coarse positioning only — dragging
 * it never moves the physical servo, it just sets the candidate Closed/Thrown
 * values. Fine-tuning the servo live is only possible one step at a time, via
 * the numeric fields' spin-button/arrow-key stepper (see `_isStepperEvent`);
 * typing an arbitrary value into a numeric field behaves like the slider —
 * value only, no live move. Close/Mid/Throw send a one-off move to preview
 * the currently-set values. Accepted Closed/Thrown positions are written back
 * into the turnout on Save.
 *
 * The Slider (type 'Range') always keeps its two handles ordered low ≤ high
 * and won't let a drag cross them, but activeAngle/inactiveAngle aren't
 * guaranteed ordered in the data model. `lowLabel` tracks which semantic
 * field ('closed' | 'thrown') currently sits at the low handle, independent
 * of the handle positions themselves — see swap()/`_onNumericChange` for how
 * it's kept in sync.
 */
export class ServoCalibrationDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)
    private readonly usb = resolve(UsbService)

    readonly profiles: TurnoutProfile[] = ['Instant', 'Fast', 'Medium', 'Slow', 'Bounce']
    readonly min = SERVO_POSITION_MIN
    readonly max = SERVO_POSITION_MAX
    readonly safeMinPercent = (SERVO_POSITION_SAFE_MIN / SERVO_POSITION_MAX) * 100
    readonly safeMaxPercent = (SERVO_POSITION_SAFE_MAX / SERVO_POSITION_MAX) * 100

    turnout!: ServoTurnout
    devicePort: string | null = null
    closedPosition = 0
    thrownPosition = 0
    lowLabel: Endpoint = 'closed'
    profile: TurnoutProfile = 'Slow'
    errorMessage = ''
    sendError: string | null = null
    /** Exact string last written to the port — surfaced in the UI so "nothing happened" is diagnosable (command not sent vs. sent-but-ignored by the firmware). */
    lastSentCommand: string | null = null
    portStatus: PortStatus = 'connecting'

    private portOpenedByUs = false
    private _prevLow = 0
    private _prevHigh = 0
    /**
     * Syncfusion's Slider/NumericTextBox re-fire their own `change` callback
     * when `.value` is set programmatically (not just on user interaction) —
     * and that dispatch is asynchronous (a render-cycle hop, not synchronous
     * inside the `.value =` setter), so a time-based "suppress for the next
     * tick" guard can't reliably distinguish it from a genuine following user
     * drag/edit. Instead, each _set*Value() helper records the exact value it
     * just wrote; the matching `change` handler consumes (and clears) that
     * recorded value once, treating it as an echo rather than user input,
     * and falls through to normal handling for anything else — including a
     * later `change` that happens to carry the same value again.
     */
    private _closedNumPendingValue: number | null = null
    private _thrownNumPendingValue: number | null = null
    private _sliderPendingValue: [number, number] | null = null

    // Element refs set by Aurelia template ref binding — plain mount points,
    // no Aurelia value binding on them (SF widgets are constructed imperatively).
    sliderEl!: HTMLElement
    closedNumEl!: HTMLInputElement
    thrownNumEl!: HTMLInputElement

    private sfSlider?: Slider
    private sfClosedNum?: NumericTextBox
    private sfThrownNum?: NumericTextBox

    get turnoutLabel(): string {
        return this.turnout.description ? `${this.turnout.description} (${this.turnout.id})` : `Turnout ${this.turnout.id}`
    }

    /** Midpoint of the two calibrated endpoints, rounded to the nearest whole servo position. */
    get midPosition(): number {
        return Math.round((this.closedPosition + this.thrownPosition) / 2)
    }

    get canTestMove(): boolean {
        return this.portStatus === 'connected'
    }

    activate(model: ServoCalibrationModel): void {
        this.turnout = { ...model.turnout }
        this.devicePort = model.devicePort
        this.closedPosition = model.turnout.inactiveAngle
        this.thrownPosition = model.turnout.activeAngle
        this.profile = model.turnout.profile
        this.lowLabel = this.closedPosition <= this.thrownPosition ? 'closed' : 'thrown'
        this._prevLow = Math.min(this.closedPosition, this.thrownPosition)
        this._prevHigh = Math.max(this.closedPosition, this.thrownPosition)
        // Deliberately not awaited — @aurelia/dialog doesn't show the dialog
        // until activate() settles, so the dialog would stay invisible while
        // the port opens. Firing it lets the dialog render immediately with
        // a "connecting…" status instead.
        void this._openPort()
    }

    attached(): void {
        this.sfSlider = new Slider({
            type: 'Range',
            min: this.min,
            max: this.max,
            value: [this._prevLow, this._prevHigh],
            tooltip: { isVisible: true, placement: 'Before' },
            change: (args: SliderChangeEventArgs) => {
                const raw = args.value
                const pending = this._sliderPendingValue
                if (Array.isArray(raw) && pending && raw[0] === pending[0] && raw[1] === pending[1]) {
                    this._sliderPendingValue = null
                    return
                }
                this._onSliderChange(args)
            },
        })
        this.sfSlider.appendTo(this.sliderEl)
        // The Slider computes each handle's pixel position from the track's
        // width at the moment it's constructed. Inside a just-mounted dialog
        // the track can still be 0-width on that first pass (layout hasn't
        // settled yet), which strands both handles at the left edge even
        // though their underlying values (and the tooltip/aria attrs) are
        // correct. reposition() recalculates from the now-laid-out track —
        // deferred one frame so the dialog's layout has actually settled.
        requestAnimationFrame(() => this.sfSlider?.reposition())

        this.sfClosedNum = new NumericTextBox({
            min: this.min,
            max: this.max,
            value: this.closedPosition,
            format: 'n0',
            change: (args) => {
                if (args.value != null && this._closedNumPendingValue === args.value) {
                    this._closedNumPendingValue = null
                    return
                }
                if (args.value != null) this._onNumericChange('closed', args.value, this._isStepperEvent(args.event))
            },
        })
        this.sfClosedNum.appendTo(this.closedNumEl)

        this.sfThrownNum = new NumericTextBox({
            min: this.min,
            max: this.max,
            value: this.thrownPosition,
            format: 'n0',
            change: (args) => {
                if (args.value != null && this._thrownNumPendingValue === args.value) {
                    this._thrownNumPendingValue = null
                    return
                }
                if (args.value != null) this._onNumericChange('thrown', args.value, this._isStepperEvent(args.event))
            },
        })
        this.sfThrownNum.appendTo(this.thrownNumEl)
    }

    detaching(): void {
        this.sfSlider?.destroy()
        this.sfClosedNum?.destroy()
        this.sfThrownNum?.destroy()
        if (this.portOpenedByUs && this.devicePort) {
            this.usb.closePort(this.devicePort).catch(() => { /* best-effort */ })
        }
    }

    swap(): void {
        const oldClosed = this.closedPosition
        this.closedPosition = this.thrownPosition
        this.thrownPosition = oldClosed
        this.lowLabel = this.lowLabel === 'closed' ? 'thrown' : 'closed'
        this._setNumBoxValue('closed', this.closedPosition)
        this._setNumBoxValue('thrown', this.thrownPosition)
        // Handle positions (and the slider's [min,max] array) are unchanged —
        // only the Closed/Thrown labels swap. No live move is sent.
    }

    save(): void {
        const closedCheck = validateServoPosition(this.closedPosition)
        const thrownCheck = validateServoPosition(this.thrownPosition)
        if (!closedCheck.ok) { this.errorMessage = closedCheck.reason; return }
        if (!thrownCheck.ok) { this.errorMessage = thrownCheck.reason; return }
        const result: ServoCalibrationResult = {
            activeAngle: this.thrownPosition,
            inactiveAngle: this.closedPosition,
            profile: this.profile,
        }
        void this.$dialog.ok(result)
    }

    cancel(): void {
        void this.$dialog.cancel()
    }

    private _fieldForHandle(handle: 'low' | 'high'): Endpoint {
        if (handle === 'low') return this.lowLabel
        return this.lowLabel === 'closed' ? 'thrown' : 'closed'
    }

    /** Handles a Range slider drag — dragging can't cross handles, so lowLabel never needs to change here. */
    private _onSliderChange(args: SliderChangeEventArgs): void {
        const raw = args.value
        if (!Array.isArray(raw) || raw.length !== 2) return
        const v0 = clampServoPosition(raw[0])
        const v1 = clampServoPosition(raw[1])
        if (v0 !== this._prevLow) this._applyFieldFromDrag(this._fieldForHandle('low'), v0)
        if (v1 !== this._prevHigh) this._applyFieldFromDrag(this._fieldForHandle('high'), v1)
        this._prevLow = v0
        this._prevHigh = v1
    }

    /** Handles a slider drag — coarse positioning only, never moves the physical servo. */
    private _applyFieldFromDrag(field: Endpoint, value: number): void {
        if (field === 'closed') this.closedPosition = value
        else this.thrownPosition = value
        this._setNumBoxValue(field, value)
    }

    /**
     * Handles a NumericTextBox change — this is the only path that can invert which end is
     * lower. `isStepperMove` distinguishes the spin-button/arrow-key ±1 step (fine-tune: sends
     * a live move so the servo can be dialed in one point at a time) from typing an arbitrary
     * value or a programmatic write (value only, same as a slider drag).
     */
    private _onNumericChange(field: Endpoint, value: number, isStepperMove: boolean): void {
        const v = clampServoPosition(value)
        if (field === 'closed') this.closedPosition = v
        else this.thrownPosition = v

        this.lowLabel = this.closedPosition <= this.thrownPosition ? 'closed' : 'thrown'
        this._prevLow = Math.min(this.closedPosition, this.thrownPosition)
        this._prevHigh = Math.max(this.closedPosition, this.thrownPosition)
        this._setSliderValue(this._prevLow, this._prevHigh)

        if (isStepperMove) void this._sendLiveMove(v)
    }

    /**
     * A NumericTextBox's spin-button click or focused-arrow-key press both increment/decrement
     * by exactly one step and reach `change` via the underlying DOM event that triggered them
     * (a mousedown/mouseup on the spin button, or a keydown for the arrow key) — see
     * NumericTextBox.prototype.mouseDownOnSpinner/keyDownHandler. Typing followed by blur/Enter
     * instead reaches `change` via the input's native 'change' event, and a programmatic
     * `.value =` write (our own echo-suppression) carries no event at all.
     */
    private _isStepperEvent(event: Event | undefined): boolean {
        return event?.type === 'mousedown' || event?.type === 'mouseup' || event?.type === 'keydown'
    }

    /**
     * Sends a one-off move to a fixed position (Close/Mid/Throw quick-test buttons) —
     * independent of the numeric-stepper fine-tune path above. Unlike stepper moves
     * (always 'Instant', for responsiveness), this uses the selected Profile so it
     * previews the actual movement the saved turnout will produce.
     */
    testMove(position: number): void {
        if (!this.canTestMove) return
        void this._sendLiveMove(clampServoPosition(position), this.profile)
    }

    /** Writes a NumericTextBox's value, recording it so the matching `change` echo is consumed instead of treated as user input. */
    private _setNumBoxValue(field: Endpoint, value: number): void {
        const box = field === 'closed' ? this.sfClosedNum : this.sfThrownNum
        if (!box || box.value === value) return
        if (field === 'closed') this._closedNumPendingValue = value
        else this._thrownNumPendingValue = value
        box.value = value
    }

    /** Writes the Slider's [low, high] value, recording it so the matching `change` echo is consumed instead of treated as user input. */
    private _setSliderValue(low: number, high: number): void {
        if (!this.sfSlider) return
        const current = this.sfSlider.value
        if (Array.isArray(current) && current[0] === low && current[1] === high) return
        this._sliderPendingValue = [low, high]
        this.sfSlider.value = [low, high]
    }

    private async _openPort(): Promise<void> {
        if (!this.devicePort) { this.portStatus = 'unavailable'; return }
        try {
            const alreadyOpen = await this.usb.isPortOpen(this.devicePort)
            await this.usb.openPort(this.devicePort, 115200)
            this.portOpenedByUs = !alreadyOpen
            this.portStatus = 'connected'
        } catch (err) {
            this.portStatus = 'error'
            this.sendError = `Unable to open ${this.devicePort}: ${(err as Error).message}`
        }
    }

    private async _sendLiveMove(position: number, profile: TurnoutProfile | number = 'Instant'): Promise<void> {
        if (!this.devicePort || this.portStatus !== 'connected') return
        const cmd = buildServoDiagnosticCommand(this.turnout.pin, position, profile)
        try {
            await this.usb.write(this.devicePort, cmd + '\n')
            this.sendError = null
            this.lastSentCommand = cmd
        } catch (err) {
            this.sendError = `Failed to move servo: ${(err as Error).message}`
        }
    }
}
