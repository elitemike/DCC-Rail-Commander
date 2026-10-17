import { bindable, BindingMode, resolve } from 'aurelia'
import { ConfigEditorState } from '../models/config-editor-state'
import { InstallerState } from '../models/installer-state'
import type { HalBoardDefinition } from '../config/hal-boards'
import {
    DIRECT_PIN_SOURCE,
    getBoardSources,
    deriveSourceAndChannel,
    computeVpinForChannel,
    getChannelOptions,
    getAvailableChannelOptions,
    isCsb1Project,
} from '../utils/vpin-picker-logic'
import type { HalDeviceInstance } from '../config/hal-devices'

/**
 * vpin-picker — shared VPin entry control used by the turnout, sensor, and
 * signal editors' pin fields.
 *
 * A DCC-EX VPin is ultimately still just a plain number in every generated
 * macro (SERVO_TURNOUT/PIN_TURNOUT/JMRI_SENSOR/SIGNAL) — there's no way to persist
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
    private readonly installerState = resolve(InstallerState)

    @bindable({ mode: BindingMode.twoWay }) value = 0
    /** Optional — called after value changes via this picker (board/channel pick, or blur in Direct mode). Editors using an edit-buffer + blur-commit pattern (e.g. turnout-editor) wire this to their commit handler. */
    @bindable onCommit: (() => void) | null = null
    /** Optional — restricts the board dropdown to boards whose `pinRole` matches (e.g. "servo" for a turnout's pin, "sensor" for a sensor's). Unset shows every board, as before. */
    @bindable role: HalBoardDefinition['pinRole'] | null = null

    /** Optional — when true, board channels already claimed by a turnout/sensor/signal are hidden, and picking a board auto-selects its first free channel. For new entries only (an existing entry's own pin would be hidden). */
    @bindable hideUsed = false

    source: string = DIRECT_PIN_SOURCE
    channel = 1

    private suppressDerive = false

    binding(): void {
        this.deriveFromValue()
        if (this.hideUsed && this.boardsFirst && this.source === DIRECT_PIN_SOURCE) {
            this.source = this.boardSources[0].instanceId
            this.onSourceChange()
        }
    }

    /**
     * On an EX-CSB1 with accessory boards, the boards are listed first and Direct MCU pin is
     * offered only if the current value is already a direct pin (so an old entry doesn't render blank).
     */
    get boardsFirst(): boolean {
        const isCsb1 = isCsb1Project(this.installerState.selectedDevice?.name, this.editorState.configHContent)
        return isCsb1 && this.boardSources.length > 0
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

    private get usedVpins(): Set<number> {
        const used = new Set<number>()
        for (const a of this.editorState.vpinAllocations) {
            if (a.kind !== 'consumer') continue
            for (let p = a.start; p < a.start + a.count; p++) used.add(p)
        }
        return used
    }

    get channelChoices(): number[] {
        if (this.hideUsed) return getAvailableChannelOptions(this.source, this.boardSources, this.usedVpins)
        return getChannelOptions(this.source, this.boardSources)
    }

    onSourceChange(): void {
        if (this.source === DIRECT_PIN_SOURCE) return
        if (this.hideUsed) {
            const free = this.channelChoices
            if (free.length === 0) return
            this.channel = free[0]
        } else {
            this.channel = 1
        }
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
