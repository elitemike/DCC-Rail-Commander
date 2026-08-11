import { describe, it, expect, vi } from 'vitest'
import { DevicePickerDialog } from '../../src/renderer/src/components/dialogs/device-picker-dialog'
import type { DetectedBoardInfo, SerialDeviceInfo } from '../../src/types/ipc'

// ── Factory ───────────────────────────────────────────────────────────────────
// Built like tests/renderer/servo-calibration-dialog.test.ts: a bare prototype
// instance with fields assigned manually, avoiding a full Aurelia DI bootstrap.

const MEGA_PORT: SerialDeviceInfo = {
    path: '/dev/ttyACM0',
    manufacturer: 'Arduino (www.arduino.cc)',
    serialNumber: 'DEV-MEGA-0001',
    vendorId: '2341',
    productId: '0042',
}

const UNO_PORT: SerialDeviceInfo = {
    path: '/dev/ttyACM1',
    manufacturer: 'Arduino (www.arduino.cc)',
    serialNumber: 'DEV-UNO-0001',
    vendorId: '2341',
    productId: '0043',
}

const MEGA_BOARD: DetectedBoardInfo = { name: 'Arduino Mega 2560', port: '/dev/ttyACM0', fqbn: 'arduino:avr:mega', protocol: 'serial' }
const UNO_BOARD: DetectedBoardInfo = { name: 'Arduino Uno', port: '/dev/ttyACM1', fqbn: 'arduino:avr:uno', protocol: 'serial' }

function makeDialog(opts: { serialPorts: SerialDeviceInfo[]; cliBoards?: DetectedBoardInfo[]; listBoardsError?: boolean }) {
    const dialog = Object.create(DevicePickerDialog.prototype) as DevicePickerDialog

    Object.assign(dialog, {
        $dialog: { ok: vi.fn(), cancel: vi.fn() },
        pio: {
            listBoards: opts.listBoardsError
                ? vi.fn().mockRejectedValue(new Error('board scan failed'))
                : vi.fn().mockResolvedValue(opts.cliBoards ?? []),
        },
        usb: {
            initialize: vi.fn().mockResolvedValue(undefined),
            refresh: vi.fn().mockResolvedValue(undefined),
            serialPorts: opts.serialPorts,
        },
        boards: [],
        selectedBoard: null,
        scanning: false,
        scanError: null,
        portOnly: false,
        showTroubleshooting: false,
        previousDeviceNotFound: false,
    })

    return { dialog }
}

// ── scan() preselect logic ───────────────────────────────────────────────────

describe('DevicePickerDialog.scan preselect', () => {
    it('with no initialFqbn, defaults to the first detected board', async () => {
        const { dialog } = makeDialog({ serialPorts: [MEGA_PORT, UNO_PORT], cliBoards: [MEGA_BOARD, UNO_BOARD] })

        await dialog.scan()

        expect(dialog.selectedBoard).toEqual(expect.objectContaining({ port: '/dev/ttyACM0' }))
        expect(dialog.previousDeviceNotFound).toBe(false)
    })

    it('with a matching initialFqbn, pre-selects that board even if not first', async () => {
        const { dialog } = makeDialog({ serialPorts: [MEGA_PORT, UNO_PORT], cliBoards: [MEGA_BOARD, UNO_BOARD] })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).initialFqbn = 'arduino:avr:uno'

        await dialog.scan()

        expect(dialog.selectedBoard).toEqual(expect.objectContaining({ port: '/dev/ttyACM1', fqbn: 'arduino:avr:uno' }))
        expect(dialog.previousDeviceNotFound).toBe(false)
    })

    it('matches on base FQBN, ignoring option suffixes', async () => {
        const esp32Board: DetectedBoardInfo = { name: 'EX-CSB1', port: '/dev/ttyACM0', fqbn: 'esp32:esp32:esp32:FlashFreq=80m', protocol: 'serial' }
        const { dialog } = makeDialog({ serialPorts: [MEGA_PORT], cliBoards: [esp32Board] })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).initialFqbn = 'esp32:esp32:esp32'

        await dialog.scan()

        expect(dialog.selectedBoard).toEqual(expect.objectContaining({ port: '/dev/ttyACM0' }))
        expect(dialog.previousDeviceNotFound).toBe(false)
    })

    it('with initialFqbn set but no connected board matches, does NOT fall back to boards[0]', async () => {
        // Regression: the picker used to silently default to boards[0] here, which could
        // let a user confirm an unrelated board they never actually selected.
        const { dialog } = makeDialog({ serialPorts: [UNO_PORT], cliBoards: [UNO_BOARD] })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).initialFqbn = 'arduino:avr:mega'

        await dialog.scan()

        expect(dialog.selectedBoard).toBeNull()
        expect(dialog.previousDeviceNotFound).toBe(true)
        expect(dialog.boards.length).toBeGreaterThan(0)
    })

    it('with initialFqbn set but the CLI failed to identify a generic clone chip, does NOT fall back to boards[0]', async () => {
        // A generic CH340 clone isn't in KNOWN_BOARDS with a real FQBN (target board type
        // is ambiguous from VID/PID alone), so mergeDetectedBoards's fallback lists it with
        // fqbn: '' when arduino-pio can't identify it either — that must not match.
        const ch340Clone: SerialDeviceInfo = {
            path: '/dev/ttyUSB2',
            manufacturer: 'QinHeng Electronics',
            serialNumber: undefined,
            vendorId: '1a86',
            productId: '7523',
        }
        const { dialog } = makeDialog({ serialPorts: [ch340Clone], listBoardsError: true })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).initialFqbn = 'arduino:avr:uno'

        await dialog.scan()

        expect(dialog.selectedBoard).toBeNull()
        expect(dialog.previousDeviceNotFound).toBe(true)
    })

    it('clears a stale previousDeviceNotFound flag on a re-scan that does match', async () => {
        const { dialog } = makeDialog({ serialPorts: [UNO_PORT], cliBoards: [UNO_BOARD] })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).initialFqbn = 'arduino:avr:mega'
        await dialog.scan()
        expect(dialog.previousDeviceNotFound).toBe(true)

        // Board reconnects / user plugs in the right one, then re-scans.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).usb.serialPorts = [MEGA_PORT]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).pio.listBoards = vi.fn().mockResolvedValue([MEGA_BOARD])

        await dialog.scan()

        expect(dialog.previousDeviceNotFound).toBe(false)
        expect(dialog.selectedBoard).toEqual(expect.objectContaining({ port: '/dev/ttyACM0' }))
    })
})

// ── confirm() / skip() / cancel() ────────────────────────────────────────────

describe('DevicePickerDialog actions', () => {
    it('confirm() resolves with the selected board', () => {
        const { dialog } = makeDialog({ serialPorts: [] })
        dialog.selectedBoard = MEGA_BOARD

        dialog.confirm()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((dialog as any).$dialog.ok).toHaveBeenCalledWith(MEGA_BOARD)
    })

    it('skip() resolves with null', () => {
        const { dialog } = makeDialog({ serialPorts: [] })

        dialog.skip()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((dialog as any).$dialog.ok).toHaveBeenCalledWith(null)
    })

    it('cancel() calls $dialog.cancel and not ok', () => {
        const { dialog } = makeDialog({ serialPorts: [] })

        dialog.cancel()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((dialog as any).$dialog.cancel).toHaveBeenCalledOnce()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((dialog as any).$dialog.ok).not.toHaveBeenCalled()
    })
})
