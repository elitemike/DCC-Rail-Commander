import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { PlatformIoService } from '../../services/platformio.service'
import { UsbService } from '../../services/usb.service'
import { mergeDetectedBoards } from '../../utils/device-scan'
import type { DetectedBoardInfo } from '../../../../types/ipc'

/**
 * Minimal dialog that scans for connected boards and lets the user pick one.
 * Opened by loadFromFolder() when config.h does not already contain a device header,
 * or when a device is known but its port is empty after resolution.
 *
 * Model (optional):
 *   { initialFqbn?: string }  — base FQBN to pre-select the matching board. If no
 *                               connected board matches, nothing is pre-selected
 *                               (never silently falls back to an unrelated board).
 *   { portOnly?: boolean }    — when true, the header copy says "Select Port" rather
 *                               than "Select Your Board" (device identity is already known)
 *
 * Resolution outcomes:
 *   ok(board)  — user selected a board (board.port is always populated)
 *   ok(null)   — user clicked "Continue without device" (compile won't work until set)
 *   cancel()   — user closed the dialog entirely (folder load is aborted)
 */
export class DevicePickerDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)
    private readonly pio = resolve(PlatformIoService)
    private readonly usb = resolve(UsbService)

    boards: DetectedBoardInfo[] = []
    selectedBoard: DetectedBoardInfo | null = null
    scanning = false
    scanError: string | null = null
    portOnly = false
    showTroubleshooting = false
    /** True once a scan has completed with initialFqbn set but no board matched it — drives the "not found" hint. */
    previousDeviceNotFound = false

    private initialFqbn = ''

    activate(model?: { initialFqbn?: string; portOnly?: boolean }): void {
        // Deliberately not awaited: @aurelia/dialog doesn't attach/show the dialog
        // until this hook's return value settles, so awaiting scan() here (USB +
        // board enumeration, can take a second or more) would leave the dialog
        // invisible the whole time it's "opening". Firing it without awaiting lets
        // the dialog show immediately with its scanning spinner instead.
        this.initialFqbn = model?.initialFqbn ?? ''
        this.portOnly = model?.portOnly ?? false
        void this.scan()
    }

    async scan(): Promise<void> {
        this.scanning = true
        this.scanError = null
        this.boards = []
        this.selectedBoard = null
        this.previousDeviceNotFound = false
        try {
            await this.usb.initialize()
            await this.usb.refresh()

            // Raw serial-port enumeration is the base list so a physically connected
            // board is never missing just because Arduino CLI hasn't recognised it yet
            // (still installing, generic/clone chip, or a momentary lag right after a
            // replug) — CLI results only ever add detail on top.
            let cliBoards: DetectedBoardInfo[] = []
            try {
                cliBoards = await this.pio.listBoards()
            } catch { /* fall back silently to the raw serial-port list */ }

            this.boards = mergeDetectedBoards(this.usb.serialPorts, cliBoards)
            if (this.boards.length > 0) {
                if (this.initialFqbn) {
                    // Pre-select the board whose base FQBN matches the previously
                    // configured device. If nothing matches, leave selectedBoard
                    // unset rather than silently falling back to boards[0] — that
                    // would let the user confirm a board they never actually chose
                    // (see reconcileDevicePort in configHeaderParser.ts, which
                    // applies the same "match or leave alone" rule for uploads).
                    const baseFqbn = (fqbn: string) => fqbn.split(':').slice(0, 3).join(':')
                    const match = this.boards.find(b => baseFqbn(b.fqbn) === baseFqbn(this.initialFqbn))
                    this.selectedBoard = match ?? null
                    this.previousDeviceNotFound = !match
                } else {
                    // No prior device to match against — default to the first
                    // detected board purely as a convenience for a first-time pick.
                    this.selectedBoard = this.boards[0]
                }
            }
        } catch {
            this.scanError = 'Board scan failed. Check that your device drivers are installed and the board is connected.'
        } finally {
            this.scanning = false
        }
    }

    selectBoard(board: DetectedBoardInfo): void {
        this.selectedBoard = board
    }

    confirm(): void {
        void this.$dialog.ok(this.selectedBoard)
    }

    skip(): void {
        void this.$dialog.ok(null)
    }

    cancel(): void {
        void this.$dialog.cancel()
    }
}
