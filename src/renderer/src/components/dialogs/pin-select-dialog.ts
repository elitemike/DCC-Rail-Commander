import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import type { HalBoardDefinition } from '../../config/hal-boards'

export interface PinSelectModel {
    title?: string
    message?: string
    pin: number
    /** Restricts the board dropdown to boards of this pinRole — see vpin-picker's `role` bindable. */
    role?: HalBoardDefinition['pinRole']
}

export interface PinSelectResult {
    pin: number
}

/**
 * Small modal for picking a VPin before a new entry is created — used by the
 * turnout editor's "Add" flow so a servo's pin (Direct MCU pin, or a
 * PWM-capable HAL board's channel) is chosen up front, before the calibration
 * dialog opens for angle/position tuning.
 */
export class PinSelectDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)

    title = 'Select Pin'
    message = 'Choose the VPin for this entry.'
    pin = 0
    role: HalBoardDefinition['pinRole'] | null = null

    activate(model: PinSelectModel): void {
        this.title = model.title ?? this.title
        this.message = model.message ?? this.message
        this.pin = model.pin
        this.role = model.role ?? null
    }

    ok(): void {
        const result: PinSelectResult = { pin: this.pin }
        void this.$dialog.ok(result)
    }

    cancel(): void {
        void this.$dialog.cancel()
    }
}
