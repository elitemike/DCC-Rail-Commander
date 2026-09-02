import { describe, expect, it } from 'vitest'
import {
    generateHalDeviceLine,
    generateHalDevicesBlock,
    parseHalDevicesFromAutomation,
    computeVpinAllocations,
    countDistinctVpins,
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

describe('parseHalDevicesFromAutomation — bare, untagged HAL(...) lines (hand-written project)', () => {
    it('resolves a bare PCA9685 line — chip+pinCount matches exactly one catalog board', () => {
        const parsed = parseHalDevicesFromAutomation('HAL(PCA9685, 100, 16, 0x40)')
        expect(parsed).toHaveLength(1)
        expect(parsed[0]).toMatchObject({ boardId: 'pca9685_sh', address: 0x40, vpinStart: 100 })
    })

    it('resolves a bare MCP23017 line behind a multiplexer sub-bus, real-world shape', () => {
        // Matches the exact real-world shape: HAL(MCP23017, 164, 16, {I2CMux_0,SubBus_3, 0x20})
        const parsed = parseHalDevicesFromAutomation('HAL(MCP23017, 164, 16, {I2CMux_0,SubBus_3, 0x20})')
        // No tagged HAL-MUX comment exists anywhere in this content, so there's no record of the
        // multiplexer's own identity to link back to — but there's exactly one multiplexer board
        // in the whole catalog, so one is synthesized rather than the link being silently dropped
        // (dropping it would flatten the device to a bare address, changing its wiring topology
        // the next time this regenerates — see hal-devices.ts's own comment on this).
        expect(parsed).toHaveLength(2)
        const mcp = parsed.find(d => d.boardId === 'mcp23017_generic')!
        const mux = parsed.find(d => d.boardId === 'rt_i2c_iso_mux')!
        expect(mcp).toMatchObject({ address: 0x20, vpinStart: 164, muxChannel: 3 })
        expect(mux).toMatchObject({ address: 0x70, vpinStart: null })
        expect(mcp.parentMuxInstanceId).toBe(mux.instanceId)
    })

    it('leaves an ambiguous bare PCA9555 line unrecognized — two catalog boards share that chip+pinCount', () => {
        expect(parseHalDevicesFromAutomation('HAL(PCA9555, 276, 16, 0x20)')).toEqual([])
    })

    it('does not double-count a HAL(...) line that already has its own DCC-Rail-Commander tag comment', () => {
        const block = generateHalDevicesBlock([device()])
        const parsed = parseHalDevicesFromAutomation(block)
        expect(parsed).toHaveLength(1)
    })

    it('parses several bare lines from a real multi-device file, mixing MCP23017 and tagged PCA9555', () => {
        const file = [
            'HAL_IGNORE_DEFAULTS',
            'HAL(MCP23017, 164, 16, {I2CMux_0,SubBus_3, 0x20})',
            'HAL(MCP23017, 180, 16, {I2CMux_0,SubBus_3, 0x21})',
            '// HAL(board=rt_dcd_16, label="Yard block detector")',
            'HAL(PCA9555, 276, 16, {I2CMux_0,SubBus_4, 0x20})',
        ].join('\n')
        const parsed = parseHalDevicesFromAutomation(file)
        // 2 MCP23017 (behind a synthesized mux, sharing it — not one each) + 1 tagged rt_dcd_16
        // (a different address, 0x20 on SubBus_4 vs. 0x20/0x21 on SubBus_3 — no collision since
        // sub-bus channels are independent address spaces) + 1 synthesized multiplexer.
        expect(parsed).toHaveLength(4)
        expect(parsed.filter(d => d.boardId === 'mcp23017_generic')).toHaveLength(2)
        expect(parsed.filter(d => d.boardId === 'rt_dcd_16')).toHaveLength(1)
        const mux = parsed.find(d => d.boardId === 'rt_i2c_iso_mux')!
        expect(mux).toBeDefined()
        expect(parsed.filter(d => d.boardId === 'mcp23017_generic').every(d => d.parentMuxInstanceId === mux.instanceId)).toBe(true)
    })
})

describe('VPin registry', () => {
    const turnouts: Turnout[] = [
        { type: 'SERVO', id: 1, pin: 25, activeAngle: 400, inactiveAngle: 100, profile: 'Slow', description: 'Points', comment: '', defaultState: 'CLOSED' },
    ]
    const sensors: SensorEntry[] = [{ id: 1, pin: 30, description: 'Occupancy' }]
    const signals: SignalEntry[] = [{ type: 'PIN', red: 40, amber: 41, green: 42, description: 'Home' }]
    const halDevices: HalDeviceInstance[] = [device({ vpinStart: 164 })] // rt_dcd_16 -> 16 pins: 164-179

    it('computeVpinAllocations aggregates turnouts, sensors, signals, and HAL devices', () => {
        const allocations = computeVpinAllocations(turnouts, sensors, signals, halDevices)
        expect(allocations).toContainEqual({ start: 25, count: 1, source: 'Turnout: Points', kind: 'consumer' })
        expect(allocations).toContainEqual({ start: 30, count: 1, source: 'Sensor: Occupancy', kind: 'consumer' })
        expect(allocations).toContainEqual({ start: 40, count: 1, source: 'Signal (red): Home', kind: 'consumer' })
        expect(allocations).toContainEqual({ start: 164, count: 16, source: 'RT DCD-16 Block Sensor: Yard block detector', kind: 'device' })
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

    it('findVpinConflicts without onlyKind flags a turnout using one of a device\'s own channels', () => {
        // This is the previously-buggy default behaviour, still needed by the
        // "give me a free direct pin" auto-suggest path — it must keep avoiding
        // both other consumers and HAL device capacity.
        const turnoutOnDevice: Turnout[] = [
            { type: 'SERVO', id: 1, pin: 170, activeAngle: 400, inactiveAngle: 100, profile: 'Slow', description: 'On device', comment: '', defaultState: 'CLOSED' },
        ]
        const allocations = computeVpinAllocations(turnoutOnDevice, [], [], halDevices)
        expect(findVpinConflicts(allocations, 164, 16).map(c => c.source)).toContain('Turnout: On device')
    })

    it('findVpinConflicts with onlyKind "device" does not flag a turnout legitimately using one of the device\'s own channels', () => {
        // This is the bug reported against the Accessories tab: a PCA9685 board
        // showed "VPin range overlaps Turnout: ..." for every turnout that was
        // simply using one of its own channels — not an actual conflict.
        const turnoutOnDevice: Turnout[] = [
            { type: 'SERVO', id: 1, pin: 170, activeAngle: 400, inactiveAngle: 100, profile: 'Slow', description: 'On device', comment: '', defaultState: 'CLOSED' },
        ]
        const allocations = computeVpinAllocations(turnoutOnDevice, [], [], halDevices)
        const source = 'RT DCD-16 Block Sensor: Yard block detector'
        expect(findVpinConflicts(allocations, 164, 16, source, 'device')).toEqual([])
    })

    it('findVpinConflicts with onlyKind "device" still flags a genuinely overlapping second device', () => {
        const overlappingDevice = device({ boardId: 'pca9555_sh', label: 'Second board', vpinStart: 170 })
        const allocations = computeVpinAllocations([], [], [], [...halDevices, overlappingDevice])
        const source = 'RT DCD-16 Block Sensor: Yard block detector'
        const conflicts = findVpinConflicts(allocations, 164, 16, source, 'device')
        expect(conflicts.map(c => c.source)).toContain('PCA9555: Second board')
    })

    it('countDistinctVpins de-duplicates an overlapping device range and consumer pins', () => {
        // Raw building block behind ConfigEditorState.vpinsInUse — counting every
        // allocation (device ranges included) without dedup would double-count a
        // consumer sitting inside a device's own range.
        const board: HalDeviceInstance[] = [device({ boardId: 'pca9685_sh', label: 'Servo board', vpinStart: 164 })] // 164-179
        const boardTurnouts: Turnout[] = Array.from({ length: 5 }, (_, i) => ({
            type: 'SERVO',
            id: i + 1,
            pin: 164 + i,
            activeAngle: 400,
            inactiveAngle: 100,
            profile: 'Slow',
            description: `Point ${i + 1}`,
            comment: '',
            defaultState: 'CLOSED',
        }))
        const allocations = computeVpinAllocations(boardTurnouts, [], [], board)
        expect(countDistinctVpins(allocations)).toBe(16)
    })

    it('countDistinctVpins sums non-overlapping allocations normally', () => {
        const allocations = computeVpinAllocations(turnouts, sensors, signals, halDevices)
        // 5 distinct consumer pins (turnout 25, sensor 30, signal 40/41/42) + 16-pin device range, none overlapping.
        expect(countDistinctVpins(allocations)).toBe(5 + 16)
    })

    it('"VPins assigned" (kind: consumer only) reports actually-wired channels, not a board\'s whole reserved range', () => {
        // This is what the Accessories tab's "VPins assigned" summary computes
        // (ConfigEditorState.vpinsInUse): a 16-pin board with only 5 channels
        // wired to turnouts should report 5, not the board's full 16-pin capacity.
        const board: HalDeviceInstance[] = [device({ boardId: 'pca9685_sh', label: 'Servo board', vpinStart: 164 })] // 164-179
        const boardTurnouts: Turnout[] = Array.from({ length: 5 }, (_, i) => ({
            type: 'SERVO',
            id: i + 1,
            pin: 164 + i,
            activeAngle: 400,
            inactiveAngle: 100,
            profile: 'Slow',
            description: `Point ${i + 1}`,
            comment: '',
            defaultState: 'CLOSED',
        }))
        const allocations = computeVpinAllocations(boardTurnouts, [], [], board)
        const assigned = allocations.filter(a => a.kind === 'consumer')
        expect(countDistinctVpins(assigned)).toBe(5)
    })

    it('"VPins assigned" reports 0 for a freshly-added board with no channels wired up yet', () => {
        const allocations = computeVpinAllocations([], [], [], halDevices)
        const assigned = allocations.filter(a => a.kind === 'consumer')
        expect(countDistinctVpins(assigned)).toBe(0)
    })
})

describe('parseHalDevicesFromAutomation — deterministic instance ids', () => {
    it('parsing the same text twice produces the same instance ids', () => {
        const block = generateHalDevicesBlock([device()])
        const firstParse = parseHalDevicesFromAutomation(block)
        const secondParse = parseHalDevicesFromAutomation(block)
        expect(secondParse[0].instanceId).toBe(firstParse[0].instanceId)
    })

    it('a device behind a multiplexer resolves to the same parentMuxInstanceId across repeated parses', () => {
        const mux = device({ instanceId: 'hal-mux', boardId: 'rt_i2c_iso_mux', label: 'Yard multiplexer', address: 0x71, vpinStart: null })
        const child = device({ instanceId: 'hal-child', parentMuxInstanceId: 'hal-mux', muxChannel: 2 })
        const block = generateHalDevicesBlock([mux, child])

        const first = parseHalDevicesFromAutomation(block)
        const second = parseHalDevicesFromAutomation(block)
        const firstChild = first.find(d => d.boardId === 'rt_dcd_16')!
        const secondChild = second.find(d => d.boardId === 'rt_dcd_16')!

        expect(secondChild.parentMuxInstanceId).toBe(firstChild.parentMuxInstanceId)
    })
})
