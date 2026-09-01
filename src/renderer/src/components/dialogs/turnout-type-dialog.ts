import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import type { TurnoutType } from '../../utils/myAutomationParser'

export interface TurnoutTypeOption {
    value: TurnoutType
    label: string
    description: string
}

export interface TurnoutTypeResult {
    type: TurnoutType
}

/**
 * Kind picker shown before a new turnout entry is created — lets the user choose
 * SERVO/DCC/DCCL/PIN/VIRTUAL up front instead of always starting as SERVO and
 * switching kind afterward via the detail panel's Kind dropdown.
 */
export class TurnoutTypeDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)

    readonly options: TurnoutTypeOption[] = [
        { value: 'SERVO', label: 'Servo', description: 'Servo motor driven via a VPin (Direct MCU pin or PWM-capable HAL board).' },
        { value: 'DCC', label: 'DCC accessory (addr + sub-addr)', description: 'Standard DCC accessory decoder addressed by address + sub-address.' },
        { value: 'DCCL', label: 'DCC accessory (linear address)', description: 'DCC accessory decoder addressed by a single linear address.' },
        { value: 'PIN', label: 'GPIO pin', description: 'Directly driven digital output pin, no servo motion.' },
        { value: 'VIRTUAL', label: 'Virtual (no hardware)', description: 'No hardware — driven entirely by ONCLOSE/ONTHROW event handlers.' },
    ]

    selected: TurnoutType = 'SERVO'

    ok(): void {
        const result: TurnoutTypeResult = { type: this.selected }
        void this.$dialog.ok(result)
    }

    cancel(): void {
        void this.$dialog.cancel()
    }
}
