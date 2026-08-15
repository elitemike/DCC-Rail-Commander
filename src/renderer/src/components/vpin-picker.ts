import { bindable, BindingMode, resolve } from 'aurelia'
import { ConfigEditorState } from '../models/config-editor-state'
import type { HalBoardDefinition } from '../config/hal-boards'
import {
    DIRECT_PIN_SOURCE,
    getBoardSources,
    deriveSourceAndChannel,
    computeVpinForChannel,
    getChannelOptions,
} from '../utils/vpin-picker-logic'
import type { HalDeviceInstance } from '../config/hal-devices'

/**
 * vpin-picker — shared VPin entry control used by the turnout, sensor, and
 * signal editors' pin fields.
 *
 * A DCC-EX VPin is ultimately still just a plain number in every generated
 * macro (SERVO_TURNOUT/PIN_TURNOUT/SENSOR/SIGNAL) — there's no way to persist
 * "this pin came from board X, channel 3" in those files. So this component
 * doesn't change what gets stored; it's a friendlier way to *set* that number:
 * pick "Direct MCU pin" and type a raw number (today's behaviour, unchanged),
 * or pick one of the accessory boards from the Accessories tab and a channel
 * (1..pinCount, matching the physical silkscreen numbering), and the VPin is
 * computed for you. See ../utils/vpin-picker-logic.ts for the actual
 * derive/compute logic (kept out of this file since it's `@bindable`-
 * decorated and can't be imported directly in a plain unit test).
 *
 * On bind (and whenever `value` changes from outside), it reverse-maps the
 * current number against every HAL device's VPin range to decide whether to
 * show "Direct MCU pin" or "Board X, channel N" — so re-opening an existing
 * turnout/sensor/signal that already uses an accessory board's VPin shows it
 * correctly attributed, not just as a bare number.
 */
export class VpinPickerCustomElement {
    private readonly editorState = resolve(ConfigEditorState)

    @bindable({ mode: BindingMode.twoWay }) value = 0
    /** Optional — called after value changes via this picker (board/channel pick, or blur in Direct mode). Editors using an edit-buffer + blur-commit pattern (e.g. turnout-editor) wire this to their commit handler. */
    @bindable onCommit: (() => void) | null = null
    /** Optional — restricts the board dropdown to boards whose `pinRole` matches (e.g. "servo" for a turnout's pin, "sensor" for a sensor's). Unset shows every board, as before. */
    @bindable role: HalBoardDefinition['pinRole'] | null = null

    source: string = DIRECT_PIN_SOURCE
    channel = 1

    private suppressDerive = false

    binding(): void {
        this.deriveFromValue()
    }

    valueChanged(): void {
        if (this.suppressDerive) return
        this.deriveFromValue()
    }

    get boardSources(): HalDeviceInstance[] {
        return getBoardSources(this.editorState.halDevices, this.role ?? undefined)
    }

    boardLabel(instanceId: string): string {
        const d = this.editorState.halDevices.find(x => x.instanceId === instanceId)
        return d?.label ?? ''
    }

    channelOptions(): number[] {
        return getChannelOptions(this.source, this.boardSources)
    }

    onSourceChange(): void {
        if (this.source === DIRECT_PIN_SOURCE) return
        this.channel = 1
        this.recompute()
    }

    onChannelChange(): void {
        this.recompute()
    }

    onDirectBlur(): void {
        this.onCommit?.()
    }

    private deriveFromValue(): void {
        const { source, channel } = deriveSourceAndChannel(this.value, this.boardSources)
        this.source = source
        this.channel = channel
    }

    private recompute(): void {
        const vpin = computeVpinForChannel(this.source, this.channel, this.boardSources)
        if (vpin == null) return
        this.suppressDerive = true
        this.value = vpin
        this.suppressDerive = false
        this.onCommit?.()
    }
}
