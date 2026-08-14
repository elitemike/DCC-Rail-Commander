/**
 * vpin-picker-logic.ts — pure logic behind the <vpin-picker> component,
 * split out from vpin-picker.ts (which is `@bindable`-decorated and can't be
 * imported in a plain unit test — Aurelia's decorator metadata isn't set up
 * outside a bootstrapped app, so even importing the module throws).
 *
 * See vpin-picker.ts for the reasoning behind "Direct MCU pin" vs
 * "board + 1-based channel".
 */
import { getHalBoard } from '../config/hal-boards'
import type { HalDeviceInstance } from '../config/hal-devices'

export const DIRECT_PIN_SOURCE = 'direct'

export interface VpinSourceChannel {
    source: string
    channel: number
}

/** HAL devices that expose selectable VPin channels (excludes multiplexers, which consume none). */
export function getBoardSources(halDevices: HalDeviceInstance[]): HalDeviceInstance[] {
    return halDevices.filter(d => {
        const board = getHalBoard(d.boardId)
        return !!board && board.pinCount > 0 && d.vpinStart != null
    })
}

/** Reverse-maps a raw VPin number to whichever board+channel it falls within, if any. */
export function deriveSourceAndChannel(value: number, boardSources: HalDeviceInstance[]): VpinSourceChannel {
    for (const d of boardSources) {
        const board = getHalBoard(d.boardId)
        if (!board || d.vpinStart == null) continue
        if (value >= d.vpinStart && value < d.vpinStart + board.pinCount) {
            return { source: d.instanceId, channel: value - d.vpinStart + 1 }
        }
    }
    return { source: DIRECT_PIN_SOURCE, channel: 1 }
}

/** Computes the VPin for a selected board + 1-based channel. Returns null if the source isn't a known board. */
export function computeVpinForChannel(source: string, channel: number, boardSources: HalDeviceInstance[]): number | null {
    const d = boardSources.find(x => x.instanceId === source)
    const board = d ? getHalBoard(d.boardId) : undefined
    if (!d || !board || d.vpinStart == null) return null
    return d.vpinStart + (channel - 1)
}

/** 1-based channel numbers (1..pinCount) for the selected board source — matches the physical silkscreen numbering. */
export function getChannelOptions(source: string, boardSources: HalDeviceInstance[]): number[] {
    const d = boardSources.find(x => x.instanceId === source)
    const board = d ? getHalBoard(d.boardId) : undefined
    const count = board?.pinCount ?? 0
    return Array.from({ length: count }, (_, i) => i + 1)
}
