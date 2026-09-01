/**
 * Unit tests for renderer/utils/board-key.ts
 *
 * Build directories used to be named after a timestamp alone, with no
 * board-specific naming at all. Keying the directory (and its hash) on the
 * board's own identity keeps every board's build output distinct.
 */
import { describe, it, expect } from 'vitest'
import { boardKey, boardDirSlug, buildScratchPath } from '../../src/renderer/src/utils/board-key'

const MEGA = 'arduino:avr:mega'
const ESP32 = 'esp32:esp32:esp32'

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
