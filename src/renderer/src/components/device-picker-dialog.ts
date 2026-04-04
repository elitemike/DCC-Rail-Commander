import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { ArduinoCliService } from '../services/arduino-cli.service'
import type { ArduinoCliBoardInfo } from '../../../types/ipc'

/**
 * Minimal dialog that scans for connected boards and lets the user pick one.
 * Opened by loadFromFolder() when config.h does not already contain a device header.
 *
 * Resolution outcomes:
 *   ok(board)  — user selected a board
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

    async activate(): Promise<void> {
        await this.scan()
    }

    async scan(): Promise<void> {
        this.scanning = true
        this.scanError = null
        this.boards = []
        this.selectedBoard = null
        try {
            this.boards = await this.cli.listBoards()
            if (this.boards.length > 0) {
                this.selectedBoard = this.boards[0]
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
