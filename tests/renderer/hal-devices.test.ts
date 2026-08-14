import { describe, expect, it } from 'vitest'
import {
    generateHalDeviceLine,
    generateHalDevicesBlock,
    parseHalDevicesFromAutomation,
    computeVpinAllocations,
    findNextFreeVpin,
    findVpinConflicts,
    type HalDeviceInstance,
} from '../../src/renderer/src/config/hal-devices'
import type { Turnout, SensorEntry, SignalEntry } from '../../src/renderer/src/utils/myAutomationParser'

function device(overrides: Partial<HalDeviceInstance> = {}): HalDeviceInstance {
    return {
        instanceId: 'hal-test',
        boardId: 'rt_dcd_16',
        label: 'Yard block detector',
        address: 0x20,
        vpinStart: 164,
        ...overrides,
    }
}

describe('generateHalDeviceLine', () => {
    it('emits a plain HAL() line with a metadata comment for a top-level device', () => {
        const d = device()
        const line = generateHalDeviceLine(d, [d])
        expect(line).toBe(
            '// HAL(board=rt_dcd_16, label="Yard block detector")\nHAL(PCA9555, 164, 16, 0x20)',
        )
    })

    it('emits the {I2CMux_n, SubBus_n, address} form for a device behind a multiplexer', () => {
        const mux = device({
            instanceId: 'hal-mux',
            boardId: 'rt_i2c_iso_mux',
            label: 'Yard multiplexer',
            address: 0x71,
            vpinStart: null,
        })
        const child = device({ parentMuxInstanceId: 'hal-mux', muxChannel: 2 })
        const line = generateHalDeviceLine(child, [mux, child])
        expect(line).toContain('HAL(PCA9555, 164, 16, {I2CMux_1, SubBus_2, 0x20})')
    })

    it('emits a comment-only HAL-MUX line for a multiplexer instance (no HAL() call)', () => {
        const mux = device({
            boardId: 'rt_i2c_iso_mux',
            label: 'Yard multiplexer',
            address: 0x71,
            vpinStart: null,
        })
        const line = generateHalDeviceLine(mux, [mux])
        expect(line).toBe('// HAL-MUX(board=rt_i2c_iso_mux, address=0x71, label="Yard multiplexer")')
        expect(line).not.toContain('HAL(')
    })

    it('returns an empty string for an unknown board id', () => {
        expect(generateHalDeviceLine(device({ boardId: 'nonexistent' }), [])).toBe('')
    })

    it('escapes double quotes in the label', () => {
        const d = device({ label: 'Yard "block" detector' })
        const line = generateHalDeviceLine(d, [d])
        expect(line).toContain('label="Yard \\"block\\" detector"')
    })
})

describe('parseHalDevicesFromAutomation — round trip', () => {
    it('round-trips a single top-level device', () => {
        const original = [device()]
        const block = generateHalDevicesBlock(original)
        const parsed = parseHalDevicesFromAutomation(block)

        expect(parsed).toHaveLength(1)
        expect(parsed[0]).toMatchObject({
            boardId: 'rt_dcd_16',
            label: 'Yard block detector',
            address: 0x20,
            vpinStart: 164,
        })
    })

    it('round-trips a multiplexer plus a device behind it, preserving the mux link', () => {
        const mux = device({
            instanceId: 'hal-mux',
            boardId: 'rt_i2c_iso_mux',
            label: 'Yard multiplexer',
            address: 0x71,
            vpinStart: null,
        })
        const child = device({
            instanceId: 'hal-child',
            label: 'Behind mux sensor',
            parentMuxInstanceId: 'hal-mux',
            muxChannel: 2,
        })
        const block = generateHalDevicesBlock([mux, child])
        const parsed = parseHalDevicesFromAutomation(block)

        expect(parsed).toHaveLength(2)
        const parsedMux = parsed.find(d => d.boardId === 'rt_i2c_iso_mux')!
        const parsedChild = parsed.find(d => d.boardId === 'rt_dcd_16')!
        expect(parsedMux.vpinStart).toBeNull()
        expect(parsedChild.muxChannel).toBe(2)
        expect(parsedChild.parentMuxInstanceId).toBe(parsedMux.instanceId)
    })

    it('regenerating from the parsed result produces byte-identical output', () => {
        const original = [
            device({
                instanceId: 'hal-mux',
                boardId: 'rt_i2c_iso_mux',
                label: 'Yard multiplexer',
                address: 0x71,
                vpinStart: null,
            }),
            device({ instanceId: 'hal-child', parentMuxInstanceId: 'hal-mux', muxChannel: 2 }),
        ]
        const block = generateHalDevicesBlock(original)
        const roundTripped = generateHalDevicesBlock(parseHalDevicesFromAutomation(block))
        expect(roundTripped).toBe(block)
    })

    it('returns an empty array for blank content', () => {
        expect(parseHalDevicesFromAutomation('')).toEqual([])
    })

    it('ignores unrelated managed-block content', () => {
        expect(parseHalDevicesFromAutomation('AUTOSTART\n  POWERON\nDONE')).toEqual([])
    })
})

describe('VPin registry', () => {
    const turnouts: Turnout[] = [
        { type: 'SERVO', id: 1, pin: 25, activeAngle: 400, inactiveAngle: 100, profile: 'Slow', description: 'Points', comment: '', defaultState: 'CLOSED' },
    ]
    const sensors: SensorEntry[] = [{ id: 1, pin: 30, description: 'Occupancy' }]
    const signals: SignalEntry[] = [{ red: 40, amber: 41, green: 42, description: 'Home' }]
    const halDevices: HalDeviceInstance[] = [device({ vpinStart: 164 })] // rt_dcd_16 -> 16 pins: 164-179

    it('computeVpinAllocations aggregates turnouts, sensors, signals, and HAL devices', () => {
        const allocations = computeVpinAllocations(turnouts, sensors, signals, halDevices)
        expect(allocations).toContainEqual({ start: 25, count: 1, source: 'Turnout: Points' })
        expect(allocations).toContainEqual({ start: 30, count: 1, source: 'Sensor: Occupancy' })
        expect(allocations).toContainEqual({ start: 40, count: 1, source: 'Signal (red): Home' })
        expect(allocations).toContainEqual({ start: 164, count: 16, source: 'RT DCD-16 Block Sensor: Yard block detector' })
    })

    it('excludes a multiplexer from allocations (0 vpins)', () => {
        const mux = [device({ boardId: 'rt_i2c_iso_mux', vpinStart: null })]
        const allocations = computeVpinAllocations([], [], [], mux)
        expect(allocations).toEqual([])
    })

    it('findNextFreeVpin skips every claimed range and returns the first true gap', () => {
        // A HAL device starting exactly at the default search floor (100) — the
        // next free vpin must jump past its whole 16-pin range, not land inside it.
        const deviceAt100 = [device({ vpinStart: 100 })]
        const allocations = computeVpinAllocations([], [], [], deviceAt100)
        expect(findNextFreeVpin(allocations)).toBe(116)
    })

    it('findNextFreeVpin returns 100 when nothing occupies the 100+ range yet', () => {
        // Turnouts/sensors/signals here all sit well below 100 (25, 30, 40-42),
        // and the HAL device starts at 164 — 100 itself is genuinely free.
        const allocations = computeVpinAllocations(turnouts, sensors, signals, halDevices)
        expect(findNextFreeVpin(allocations)).toBe(100)
    })

    it('findNextFreeVpin defaults to 100 when nothing is allocated in that range', () => {
        expect(findNextFreeVpin([])).toBe(100)
    })

    it('findVpinConflicts finds an overlapping HAL device range', () => {
        const allocations = computeVpinAllocations([], [], [], halDevices)
        const conflicts = findVpinConflicts(allocations, 170, 1)
        expect(conflicts).toHaveLength(1)
        expect(conflicts[0].source).toContain('Yard block detector')
    })

    it('findVpinConflicts excludes the given source (editing a device against itself)', () => {
        const allocations = computeVpinAllocations([], [], [], halDevices)
        const source = 'RT DCD-16 Block Sensor: Yard block detector'
        expect(findVpinConflicts(allocations, 164, 16, source)).toEqual([])
    })

    it('findVpinConflicts returns nothing for a non-overlapping range', () => {
        const allocations = computeVpinAllocations([], [], [], halDevices)
        expect(findVpinConflicts(allocations, 200, 5)).toEqual([])
    })
})
