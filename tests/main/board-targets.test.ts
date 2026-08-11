/**
 * Unit tests for main/board-targets.ts
 *
 * The FQBN stays the app-wide board identity, so this table is the only place
 * that knows how to turn one into something PlatformIO can build. Getting it
 * wrong means a board silently builds for the wrong chip.
 */
import { describe, it, expect } from 'vitest'
import {
    resolveTarget,
    baseFqbn,
    platformName,
    KNOWN_BOARDS,
    lookupKnownBoard,
} from '../../src/main/board-targets'

describe('baseFqbn()', () => {
    it('keeps vendor:arch:board and drops option suffixes', () => {
        expect(baseFqbn('arduino:avr:mega:cpu=atmega2560')).toBe('arduino:avr:mega')
    })

    it('leaves a plain FQBN unchanged', () => {
        expect(baseFqbn('arduino:avr:uno')).toBe('arduino:avr:uno')
    })
})

describe('platformName()', () => {
    it('strips the version pin', () => {
        expect(platformName('espressif32@6.7.0')).toBe('espressif32')
    })

    it('passes an unpinned platform through', () => {
        expect(platformName('atmelavr')).toBe('atmelavr')
    })
})

describe('resolveTarget()', () => {
    it('maps the Mega to the atmelavr mega2560 env', () => {
        const target = resolveTarget('arduino:avr:mega')
        expect(target).toMatchObject({
            env: 'mega2560',
            platform: 'atmelavr',
            board: 'megaatmega2560',
        })
    })

    it('resolves an FQBN carrying a cpu option identically to the base FQBN', () => {
        expect(resolveTarget('arduino:avr:mega:cpu=atmega2560')).toEqual(resolveTarget('arduino:avr:mega'))
    })

    it('maps the Uno and Nano to their AVR boards', () => {
        expect(resolveTarget('arduino:avr:uno')).toMatchObject({ platform: 'atmelavr', board: 'uno' })
        expect(resolveTarget('arduino:avr:nano')).toMatchObject({
            platform: 'atmelavr',
            board: 'nanoatmega328new',
        })
    })

    it('maps the Nano Every to atmelmegaavr with its slower upload speed', () => {
        const target = resolveTarget('arduino:megaavr:nanoevery')
        expect(target).toMatchObject({ platform: 'atmelmegaavr', board: 'nano_every', uploadSpeed: 19200 })
    })

    it('pins the ESP32 platform version', () => {
        const target = resolveTarget('esp32:esp32:esp32')
        expect(target?.platform).toBe('espressif32@6.7.0')
        expect(target?.board).toBe('esp32dev')
    })

    it('builds ESP32 and STM32 targets as C++17', () => {
        expect(resolveTarget('esp32:esp32:esp32')?.buildFlags).toContain('-std=c++17')
        expect(
            resolveTarget('STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F411RE')?.buildFlags,
        ).toContain('-std=c++17')
    })

    it('distinguishes STM32 Nucleo boards by their pnum option', () => {
        expect(resolveTarget('STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F411RE')).toMatchObject({
            env: 'Nucleo-F411RE',
            board: 'nucleo_f411re',
        })
        expect(resolveTarget('STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F446RE')).toMatchObject({
            env: 'Nucleo-F446RE',
            board: 'nucleo_f446re',
        })
    })

    it('returns null for an STM32 FQBN with no recognised pnum', () => {
        expect(resolveTarget('STMicroelectronics:stm32:Nucleo_64')).toBeNull()
        expect(resolveTarget('STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_Z999ZZ')).toBeNull()
    })

    it('returns null for an unknown board', () => {
        expect(resolveTarget('teensy:avr:teensy41')).toBeNull()
    })

    it('returns null for an empty or whitespace FQBN', () => {
        expect(resolveTarget('')).toBeNull()
        expect(resolveTarget('   ')).toBeNull()
    })

    it('gives every target a distinct env so two boards never share a build dir', () => {
        const fqbns = [
            'arduino:avr:mega',
            'arduino:avr:uno',
            'arduino:avr:nano',
            'arduino:megaavr:nanoevery',
            'esp32:esp32:esp32',
            'STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F411RE',
            'STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F446RE',
        ]
        const envs = fqbns.map((f) => resolveTarget(f)?.env)
        expect(envs.every(Boolean)).toBe(true)
        expect(new Set(envs).size).toBe(fqbns.length)
    })
})

describe('KNOWN_BOARDS / lookupKnownBoard()', () => {
    it('identifies the EX-CSB1 by its Espressif VID/PID', () => {
        expect(lookupKnownBoard('303a', '1001')?.fqbn).toBe('esp32:esp32:esp32')
    })

    it('is case-insensitive about VID/PID', () => {
        expect(lookupKnownBoard('303A', '1001')).toEqual(lookupKnownBoard('303a', '1001'))
    })

    it('returns undefined when either id is missing', () => {
        expect(lookupKnownBoard(undefined, '1001')).toBeUndefined()
        expect(lookupKnownBoard('303a', undefined)).toBeUndefined()
    })

    it('returns undefined for an unknown VID/PID', () => {
        expect(lookupKnownBoard('dead', 'beef')).toBeUndefined()
    })

    it('leaves generic USB-serial adapters without an FQBN', () => {
        // A CH340 or FTDI cable says nothing about what board is behind it.
        expect(KNOWN_BOARDS['1a86:7523'].fqbn).toBe('')
        expect(KNOWN_BOARDS['0403:6001'].fqbn).toBe('')
    })

    it('only maps boards to FQBNs that have a build target', () => {
        for (const [vidPid, board] of Object.entries(KNOWN_BOARDS)) {
            if (!board.fqbn) continue
            expect(resolveTarget(board.fqbn), `${vidPid} → ${board.fqbn}`).not.toBeNull()
        }
    })
})
