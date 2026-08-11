import type { DetectedBoardInfo, SerialDeviceInfo } from '../../../types/ipc'

// The VID/PID → board table is shared with the main process (which does the
// same identification when it enumerates boards), so it lives in
// `src/types/boards.ts`. Re-exported here for existing renderer imports.
import { KNOWN_BOARDS } from '../../../types/boards'
export { KNOWN_BOARDS }

/**
 * Merges raw OS-level serial port enumeration with the board list reported by
 * the main process, falling back to the known VID/PID table for boards/clones
 * that weren't identified (e.g. generic CH340/FTDI adapters).
 *
 * Every physically connected serial port ends up in the result — even one
 * neither source recognises shows up as an "Unknown device" with an empty
 * FQBN — so a board never silently disappears from a picker just because
 * detection is still starting up. `serialPorts` (the raw port list) is always
 * the base; detected boards only ever add detail on top of a port that's
 * already there.
 */
export function mergeDetectedBoards(
    serialPorts: SerialDeviceInfo[],
    cliBoards: DetectedBoardInfo[],
): DetectedBoardInfo[] {
    const cliMap = new Map<string, DetectedBoardInfo>()
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
        } satisfies DetectedBoardInfo
    })
}
