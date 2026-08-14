import { describe, expect, it } from 'vitest'
import {
    getBoardSources,
    deriveSourceAndChannel,
    computeVpinForChannel,
    getChannelOptions,
    DIRECT_PIN_SOURCE,
} from '../../src/renderer/src/utils/vpin-picker-logic'
import type { HalDeviceInstance } from '../../src/renderer/src/config/hal-devices'

const boardA: HalDeviceInstance = { instanceId: 'hal-a', boardId: 'rt_dcd_16', label: 'Yard sensor', address: 0x20, vpinStart: 164 }
const boardB: HalDeviceInstance = { instanceId: 'hal-b', boardId: 'rt_pca9685_sh', label: 'Servo driver', address: 0x40, vpinStart: 200 }
const muxDevice: HalDeviceInstance = { instanceId: 'hal-mux', boardId: 'rt_i2c_iso_mux', label: 'Mux', address: 0x71, vpinStart: null }

describe('getBoardSources', () => {
    it('includes pin-consuming devices and excludes multiplexers (0 vpins)', () => {
        expect(getBoardSources([boardA, boardB, muxDevice])).toEqual([boardA, boardB])
    })

    it('excludes a device whose board id no longer exists in the catalog', () => {
        const stale: HalDeviceInstance = { instanceId: 'hal-c', boardId: 'nonexistent', label: 'Stale', address: 0x20, vpinStart: 100 }
        expect(getBoardSources([stale])).toEqual([])
    })

    it('returns an empty array for an empty device list', () => {
        expect(getBoardSources([])).toEqual([])
    })
})

describe('deriveSourceAndChannel', () => {
    it('attributes a vpin inside a board range to that board, with a 1-based channel', () => {
        expect(deriveSourceAndChannel(167, [boardA])).toEqual({ source: 'hal-a', channel: 4 }) // 167 - 164 + 1
    })

    it('the first vpin of a board maps to channel 1, not 0', () => {
        expect(deriveSourceAndChannel(164, [boardA])).toEqual({ source: 'hal-a', channel: 1 })
    })

    it('the last vpin of a 16-pin board maps to channel 16', () => {
        expect(deriveSourceAndChannel(179, [boardA])).toEqual({ source: 'hal-a', channel: 16 }) // 164..179 inclusive
    })

    it('falls back to Direct MCU pin when the value is outside every board range', () => {
        expect(deriveSourceAndChannel(25, [boardA, boardB])).toEqual({ source: DIRECT_PIN_SOURCE, channel: 1 })
    })

    it('falls back to Direct MCU pin exactly one past the end of a board range', () => {
        expect(deriveSourceAndChannel(180, [boardA])).toEqual({ source: DIRECT_PIN_SOURCE, channel: 1 }) // 164+16 = 180, exclusive end
    })

    it('picks the first matching board when ranges happen to overlap', () => {
        const overlapping: HalDeviceInstance = { instanceId: 'hal-d', boardId: 'rt_dcd_16', label: 'Overlap', address: 0x21, vpinStart: 170 }
        expect(deriveSourceAndChannel(172, [boardA, overlapping]).source).toBe('hal-a')
    })

    it('resolves against the correct board when multiple are present', () => {
        expect(deriveSourceAndChannel(205, [boardA, boardB])).toEqual({ source: 'hal-b', channel: 6 }) // 205 - 200 + 1
    })
})

describe('computeVpinForChannel', () => {
    it('computes vpinStart + (channel - 1)', () => {
        expect(computeVpinForChannel('hal-a', 5, [boardA])).toBe(168) // 164 + 4
    })

    it('channel 1 maps back to exactly vpinStart', () => {
        expect(computeVpinForChannel('hal-a', 1, [boardA])).toBe(164)
    })

    it('channel 16 maps to the last pin of a 16-pin board', () => {
        expect(computeVpinForChannel('hal-a', 16, [boardA])).toBe(179)
    })

    it('returns null when the source does not match any known board', () => {
        expect(computeVpinForChannel('hal-missing', 3, [boardA])).toBeNull()
    })

    it('returns null for the Direct MCU pin source', () => {
        expect(computeVpinForChannel(DIRECT_PIN_SOURCE, 1, [boardA])).toBeNull()
    })
})

describe('getChannelOptions', () => {
    it('returns 1..pinCount for the selected board', () => {
        expect(getChannelOptions('hal-a', [boardA])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    })

    it('returns an empty array for the Direct MCU pin source', () => {
        expect(getChannelOptions(DIRECT_PIN_SOURCE, [boardA])).toEqual([])
    })

    it('returns an empty array when the source does not match any known board', () => {
        expect(getChannelOptions('hal-missing', [boardA])).toEqual([])
    })
})

describe('round trip: derive then recompute returns the original value', () => {
    it('holds for every channel of a 16-pin board', () => {
        for (let vpin = boardA.vpinStart!; vpin < boardA.vpinStart! + 16; vpin++) {
            const { source, channel } = deriveSourceAndChannel(vpin, [boardA])
            expect(computeVpinForChannel(source, channel, [boardA])).toBe(vpin)
        }
    })
})
