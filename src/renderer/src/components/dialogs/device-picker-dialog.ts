import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { ArduinoCliService } from '../../services/arduino-cli.service'
import type { ArduinoCliBoardInfo } from '../../../../types/ipc'

/**
 * Minimal dialog that scans for connected boards and lets the user pick one.
 * Opened by loadFromFolder() when config.h does not already contain a device header,
 * or when a device is known but its port is empty after resolution.
 *
 * Model (optional):
 *   { initialFqbn?: string }  — base FQBN to pre-select the matching board
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
    private readonly cli = resolve(ArduinoCliService)

    boards: ArduinoCliBoardInfo[] = []
    selectedBoard: ArduinoCliBoardInfo | null = null
    scanning = false
    scanError: string | null = null
    portOnly = false

    private initialFqbn = ''

    activate(model?: { initialFqbn?: string; portOnly?: boolean }): Promise<void> {
        this.initialFqbn = model?.initialFqbn ?? ''
        this.portOnly = model?.portOnly ?? false
        return this.scan()
    }

    async scan(): Promise<void> {
        this.scanning = true
        this.scanError = null
        this.boards = []
        this.selectedBoard = null
        try {
            this.boards = await this.cli.listBoards()
            if (this.boards.length > 0) {
                // Pre-select the board whose base FQBN matches initialFqbn, if provided;
                // otherwise default to the first board in the list.
                const baseFqbn = (fqbn: string) => fqbn.split(':').slice(0, 3).join(':')
                const preselect = this.initialFqbn
                    ? this.boards.find(b => baseFqbn(b.fqbn) === baseFqbn(this.initialFqbn)) ?? this.boards[0]
                    : this.boards[0]
                this.selectedBoard = preselect
            }
        } catch {
            this.scanError = 'Board scan failed. Check that the Arduino CLI is installed.'
        } finally {
            this.scanning = false
        }
    }

    selectBoard(board: ArduinoCliBoardInfo): void {
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
