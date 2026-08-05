import type { ArduinoCliBoardInfo, SerialDeviceInfo } from '../../../types/ipc'

/**
 * Known USB Vendor/Product IDs → board name and FQBN.
 * Used as a fallback when Arduino CLI doesn't recognise a detected serial port.
 * Leave fqbn empty for generic serial adapters where the target board type is unknown.
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

/**
 * Merges raw OS-level serial port enumeration with whatever Arduino CLI
 * recognises for the same ports, falling back to the known VID/PID table for
 * boards/clones the CLI doesn't identify (e.g. generic CH340/FTDI adapters).
 *
 * Every physically connected serial port ends up in the result — even one
 * neither the CLI nor the known-board table recognises shows up as an
 * "Unknown device" with an empty FQBN — so a board never silently disappears
 * from a picker just because Arduino CLI hasn't indexed it or is still
 * starting up. `serialPorts` (the raw port list) is always the base; CLI
 * results only ever add detail on top of a port that's already there.
 */
export function mergeDetectedBoards(
    serialPorts: SerialDeviceInfo[],
    cliBoards: ArduinoCliBoardInfo[],
): ArduinoCliBoardInfo[] {
    const cliMap = new Map<string, ArduinoCliBoardInfo>()
    for (const b of cliBoards) cliMap.set(b.port, b)

    return serialPorts.map((sp) => {
        const cliMatch = cliMap.get(sp.path)
        if (cliMatch) return { ...cliMatch, serialNumber: cliMatch.serialNumber ?? sp.serialNumber }
        const vid = sp.vendorId?.toLowerCase() ?? ''
        const pid = sp.productId?.toLowerCase() ?? ''
        const vidPid = vid && pid ? `${vid}:${pid}` : ''
        const knownBoard = KNOWN_BOARDS[vidPid]
        return {
            name: knownBoard?.name ?? sp.manufacturer ?? 'Unknown device',
            fqbn: knownBoard?.fqbn ?? '',
            port: sp.path,
            protocol: 'serial',
            serialNumber: sp.serialNumber,
        } satisfies ArduinoCliBoardInfo
    })
}
