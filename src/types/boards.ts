/**
 * Known USB Vendor/Product IDs → board name and FQBN.
 *
 * Shared by the main process (which identifies connected boards) and the
 * renderer (which merges that identification with the raw serial-port list).
 * Board detection no longer runs an external CLI, so this table is the only
 * thing standing between a plugged-in board and a usable FQBN.
 *
 * Leave `fqbn` empty for generic serial adapters where the target board
 * genuinely can't be inferred from the VID/PID alone.
 */
export const KNOWN_BOARDS: Record<string, { name: string; fqbn: string }> = {
    '2341:0042': { name: 'Arduino Mega 2560', fqbn: 'arduino:avr:mega' },
    '2341:0010': { name: 'Arduino Mega 2560', fqbn: 'arduino:avr:mega' },
    '2341:0242': { name: 'Arduino Mega 2560 (DFU)', fqbn: 'arduino:avr:mega' },
    '2341:0043': { name: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
    '2341:0001': { name: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
    '2341:0243': { name: 'Arduino Uno (DFU)', fqbn: 'arduino:avr:uno' },
    '2341:0058': { name: 'Arduino Nano', fqbn: 'arduino:avr:nano' },
    '2341:0037': { name: 'Arduino Nano Every', fqbn: 'arduino:megaavr:nanoevery' },
    '1a86:7523': { name: 'CH340 Serial (Nano/Mega clone)', fqbn: '' },
    '10c4:ea60': { name: 'CP2102 Serial (ESP32)', fqbn: '' },
    '0403:6001': { name: 'FTDI Serial Adapter', fqbn: '' },
    '0403:6015': { name: 'FTDI Serial Adapter', fqbn: '' },
    '0483:374b': { name: 'STM32 Nucleo (ST-Link)', fqbn: '' },
    '0483:3748': { name: 'STM32 ST-Link V2', fqbn: '' },
    '303a:1001': { name: 'EX-CSB1 (DCC-EX CommandStation Board 1)', fqbn: 'esp32:esp32:esp32' },
}

/** Looks up a board by lowercase `vid:pid`, tolerating missing/odd-cased ids. */
export function lookupKnownBoard(
    vendorId?: string,
    productId?: string,
): { name: string; fqbn: string } | undefined {
    const vid = vendorId?.toLowerCase() ?? ''
    const pid = productId?.toLowerCase() ?? ''
    if (!vid || !pid) return undefined
    return KNOWN_BOARDS[`${vid}:${pid}`]
}
