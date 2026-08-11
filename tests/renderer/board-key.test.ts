/**
 * Unit tests for renderer/utils/board-key.ts
 *
 * Build directories used to be named after a timestamp alone, and a new
 * configuration reused the first saved config for the same *product* — so with
 * two boards running EX-CommandStation, one board's config.h could be carried
 * into the other. These tests pin the behaviour that prevents that.
 */
import { describe, it, expect } from 'vitest'
import { boardKey, boardDirSlug, buildScratchPath, findReusableConfig } from '../../src/renderer/src/utils/board-key'
import type { SavedConfiguration } from '../../src/renderer/src/models/saved-configuration'

const MEGA = 'arduino:avr:mega'
const ESP32 = 'esp32:esp32:esp32'

function savedConfig(over: Partial<SavedConfiguration>): SavedConfiguration {
    return {
        id: '1',
        name: 'cfg',
        deviceName: 'Board',
        devicePort: '/dev/ttyACM0',
        deviceFqbn: MEGA,
        product: 'ex_commandstation',
        productName: 'EX-CommandStation',
        version: 'v5.4.0-Prod',
        repoPath: '/repos/CommandStation-EX',
        scratchPath: '/repos/_build/x/CommandStation-EX',
        configFiles: [],
        lastModified: '2026-01-01T00:00:00.000Z',
        ...over,
    }
}

describe('boardKey()', () => {
    it('combines board type and the specific unit', () => {
        expect(boardKey({ fqbn: MEGA, serialNumber: 'SN1' })).not.toBe(boardKey({ fqbn: MEGA, serialNumber: 'SN2' }))
    })

    it('distinguishes two different board types on the same port', () => {
        expect(boardKey({ fqbn: MEGA, port: '/dev/ttyACM0' }))
            .not.toBe(boardKey({ fqbn: ESP32, port: '/dev/ttyACM0' }))
    })

    it('prefers the serial number so a board keeps its identity across ports', () => {
        expect(boardKey({ fqbn: MEGA, serialNumber: 'SN1', port: '/dev/ttyACM0' }))
            .toBe(boardKey({ fqbn: MEGA, serialNumber: 'SN1', port: '/dev/ttyACM7' }))
    })

    it('falls back to the port for boards that report no serial number', () => {
        expect(boardKey({ fqbn: MEGA, port: '/dev/ttyACM0' }))
            .not.toBe(boardKey({ fqbn: MEGA, port: '/dev/ttyACM1' }))
    })

    it('ignores surrounding whitespace', () => {
        expect(boardKey({ fqbn: ` ${MEGA} `, serialNumber: ' SN1 ' })).toBe(boardKey({ fqbn: MEGA, serialNumber: 'SN1' }))
    })
})

describe('boardDirSlug()', () => {
    it('is stable for the same board', () => {
        const board = { fqbn: MEGA, serialNumber: 'SN1' }
        expect(boardDirSlug(board)).toBe(boardDirSlug({ ...board }))
    })

    it('differs between two identical boards with different serial numbers', () => {
        expect(boardDirSlug({ fqbn: MEGA, serialNumber: 'SN1' }))
            .not.toBe(boardDirSlug({ fqbn: MEGA, serialNumber: 'SN2' }))
    })

    it('is filesystem-safe', () => {
        const slug = boardDirSlug({ fqbn: 'STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F411RE', port: 'COM3' })
        expect(slug).toMatch(/^[a-z0-9-]+$/)
    })

    it('stays short — PlatformIO package trees are deep and Windows paths are not', () => {
        const slug = boardDirSlug({ fqbn: 'STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F411RE', port: 'COM3' })
        expect(slug.length).toBeLessThanOrEqual(24)
    })

    it('carries a readable hint of which board it is', () => {
        expect(boardDirSlug({ fqbn: MEGA, serialNumber: 'SN1' })).toMatch(/^mega-/)
        expect(boardDirSlug({ fqbn: ESP32, serialNumber: 'SN1' })).toMatch(/^esp32-/)
    })
})

describe('buildScratchPath()', () => {
    it('nests the sketch under a board-specific build dir', () => {
        const path = buildScratchPath('/repos', 'CommandStation-EX', { fqbn: MEGA, serialNumber: 'SN1' }, '1700000000000')
        expect(path).toMatch(/^\/repos\/_build\/mega-[a-z0-9]+-1700000000000\/CommandStation-EX$/)
    })

    it('gives two boards on the same product distinct build dirs', () => {
        const mega = buildScratchPath('/repos', 'CommandStation-EX', { fqbn: MEGA, serialNumber: 'SN1' }, '1')
        const esp32 = buildScratchPath('/repos', 'CommandStation-EX', { fqbn: ESP32, serialNumber: 'SN2' }, '1')
        expect(mega).not.toBe(esp32)
    })

    it('gives two identical boards distinct build dirs', () => {
        const a = buildScratchPath('/repos', 'CommandStation-EX', { fqbn: MEGA, serialNumber: 'SN1' }, '1')
        const b = buildScratchPath('/repos', 'CommandStation-EX', { fqbn: MEGA, serialNumber: 'SN2' }, '1')
        expect(a).not.toBe(b)
    })
})

describe('findReusableConfig()', () => {
    const megaSN1 = savedConfig({ id: 'mega-1', deviceFqbn: MEGA, deviceSerialNumber: 'SN1', scratchPath: '/b/mega1' })
    const megaSN2 = savedConfig({ id: 'mega-2', deviceFqbn: MEGA, deviceSerialNumber: 'SN2', scratchPath: '/b/mega2' })
    const esp32 = savedConfig({ id: 'esp-1', deviceFqbn: ESP32, deviceSerialNumber: 'SN9', scratchPath: '/b/esp' })

    it('prefers the same physical board', () => {
        const found = findReusableConfig([megaSN2, esp32, megaSN1], 'ex_commandstation', {
            fqbn: MEGA,
            serialNumber: 'SN1',
        })
        expect(found?.id).toBe('mega-1')
    })

    it('never returns a different board type — the collision this exists to prevent', () => {
        // An ESP32 being configured must not inherit the Mega's config.h just
        // because both are EX-CommandStation.
        const found = findReusableConfig([megaSN1, megaSN2], 'ex_commandstation', {
            fqbn: ESP32,
            serialNumber: 'SN9',
        })
        expect(found).toBeUndefined()
    })

    it('falls back to another board of the same type when this one is new', () => {
        // Replacing a board should not lose the user's settings.
        const found = findReusableConfig([megaSN1], 'ex_commandstation', { fqbn: MEGA, serialNumber: 'SN-NEW' })
        expect(found?.id).toBe('mega-1')
    })

    it('ignores configurations for another product', () => {
        const turntable = savedConfig({ id: 'tt', product: 'ex_turntable', deviceFqbn: MEGA, deviceSerialNumber: 'SN1' })
        expect(findReusableConfig([turntable], 'ex_commandstation', { fqbn: MEGA, serialNumber: 'SN1' })).toBeUndefined()
    })

    it('ignores configurations that never got a scratch dir', () => {
        const noScratch = savedConfig({ id: 'x', deviceSerialNumber: 'SN1', scratchPath: '' })
        expect(findReusableConfig([noScratch], 'ex_commandstation', { fqbn: MEGA, serialNumber: 'SN1' })).toBeUndefined()
    })

    it('matches on port for older configurations saved without a serial number', () => {
        const legacy = savedConfig({ id: 'legacy', devicePort: '/dev/ttyACM3', deviceSerialNumber: undefined })
        const found = findReusableConfig([legacy], 'ex_commandstation', { fqbn: MEGA, port: '/dev/ttyACM3' })
        expect(found?.id).toBe('legacy')
    })

    it('tolerates a missing or non-array configuration list', () => {
        expect(findReusableConfig(undefined, 'ex_commandstation', { fqbn: MEGA })).toBeUndefined()
        expect(findReusableConfig([], 'ex_commandstation', { fqbn: MEGA })).toBeUndefined()
    })
})
