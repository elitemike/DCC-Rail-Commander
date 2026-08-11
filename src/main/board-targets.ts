/**
 * FQBN → PlatformIO build target mapping.
 *
 * The app's board identity is the Arduino FQBN: it is persisted in
 * `SavedConfiguration.deviceFqbn`, embedded in every user's `config.h` device
 * header, and used throughout the renderer. PlatformIO knows nothing about
 * FQBNs, so this table is the single translation layer between the two.
 *
 * The targets are transcribed from the `platformio.ini` that CommandStation-EX
 * itself ships, so a build produced here matches what upstream builds by hand.
 */

/** A resolved PlatformIO build target for one board. */
export interface BoardTarget {
    /** PlatformIO env name, e.g. "mega2560" — also the `.pio/build/<env>` dir. */
    env: string
    /** PlatformIO platform spec, optionally version-pinned, e.g. "espressif32@6.7.0". */
    platform: string
    /** PlatformIO board id, e.g. "megaatmega2560". */
    board: string
    /** Extra build flags appended to the shared `-Wall -Wextra`. */
    buildFlags: string[]
    /** Optional upload speed override. */
    uploadSpeed?: number
    /** Human-readable label used in error messages. */
    label: string
}

/** Platform id without the version pin, e.g. "espressif32@6.7.0" → "espressif32". */
export function platformName(platform: string): string {
    return platform.split('@')[0].trim()
}

/**
 * Reduces an FQBN to its `vendor:arch:board` base, dropping any option suffix.
 * `arduino:avr:mega:cpu=atmega2560` and `arduino:avr:mega` are the same board.
 */
export function baseFqbn(fqbn: string): string {
    return fqbn.split(':').slice(0, 3).join(':')
}

const TARGETS: Record<string, BoardTarget> = {
    'arduino:avr:mega': {
        env: 'mega2560',
        platform: 'atmelavr',
        board: 'megaatmega2560',
        buildFlags: [],
        label: 'Arduino Mega 2560',
    },
    'arduino:avr:uno': {
        env: 'uno',
        platform: 'atmelavr',
        board: 'uno',
        buildFlags: ['-mcall-prologues'],
        label: 'Arduino Uno',
    },
    'arduino:avr:nano': {
        env: 'nano',
        platform: 'atmelavr',
        board: 'nanoatmega328new',
        buildFlags: ['-mcall-prologues'],
        label: 'Arduino Nano',
    },
    'arduino:megaavr:nanoevery': {
        env: 'nanoevery',
        platform: 'atmelmegaavr',
        board: 'nano_every',
        buildFlags: [],
        uploadSpeed: 19200,
        label: 'Arduino Nano Every',
    },
    'esp32:esp32:esp32': {
        env: 'ESP32',
        platform: 'espressif32@6.7.0',
        board: 'esp32dev',
        buildFlags: ['-std=c++17'],
        label: 'ESP32 Dev Module',
    },
}

/**
 * STM32 Nucleo boards share one base FQBN and are distinguished by the
 * `pnum=NUCLEO_xxx` option, so they can't live in the base-FQBN table above.
 */
const STM32_BASE = 'STMicroelectronics:stm32'
const STM32_TARGETS: Record<string, BoardTarget> = {
    NUCLEO_F411RE: {
        env: 'Nucleo-F411RE',
        platform: 'ststm32@19.0.0',
        board: 'nucleo_f411re',
        buildFlags: ['-std=c++17', '-Os', '-g2'],
        label: 'Nucleo F411RE',
    },
    NUCLEO_F446RE: {
        env: 'Nucleo-F446RE',
        platform: 'ststm32@19.0.0',
        board: 'nucleo_f446re',
        buildFlags: ['-std=c++17', '-Os', '-g2'],
        label: 'Nucleo F446RE',
    },
}

/**
 * Resolves an FQBN to a PlatformIO target, or `null` when the board isn't one
 * this installer knows how to build for.
 */
export function resolveTarget(fqbn: string): BoardTarget | null {
    const trimmed = (fqbn ?? '').trim()
    if (!trimmed) return null

    // STM32 boards all share `STMicroelectronics:stm32:<variant>` and are only
    // told apart by the `pnum=` option, so they can't go through the base-FQBN
    // table below.
    if (trimmed.startsWith(`${STM32_BASE}:`)) {
        const pnum = /(?:^|:)pnum=([^:,]+)/.exec(trimmed)?.[1]
        return (pnum && STM32_TARGETS[pnum.toUpperCase()]) || null
    }

    const base = baseFqbn(trimmed)

    return TARGETS[base] ?? null
}

// The VID/PID → board table is shared with the renderer, so it lives in
// `src/types/boards.ts`. Re-exported here so main-process callers have a single
// board-related import.
export { KNOWN_BOARDS, lookupKnownBoard } from '../types/boards'
