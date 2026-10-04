import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import type { TurnoutProfile, TurnoutType } from '../../utils/myAutomationParser'

export interface TurnoutCloneModel {
    sourceType: TurnoutType
    /** Pre-filled ID for the clone (one past the highest existing ID). */
    suggestedId: number
    /** IDs already in use — the clone's ID must not collide with any of them. */
    takenIds: number[]
}

export interface TurnoutCloneResult {
    id: number
    hidden: boolean
    /** Only meaningful when the source is a SERVO. */
    profile: TurnoutProfile
}

/**
 * Small modal shown when cloning a turnout onto the same pin/address. Asks for the new ID, whether
 * the clone should be hidden from throttles, and (servos only) the motion profile — defaults match
 * the common "hidden, instant-throw twin for EXRAIL" use.
 */
export class TurnoutCloneDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)

    readonly profiles: TurnoutProfile[] = ['Instant', 'Fast', 'Medium', 'Slow', 'Bounce']

    isServo = false
    id = 0
    hidden = true
    profile: TurnoutProfile = 'Instant'
    errorMessage = ''
    private takenIds = new Set<number>()

    activate(model: TurnoutCloneModel): void {
        this.isServo = model.sourceType === 'SERVO'
        this.id = model.suggestedId
        this.takenIds = new Set(model.takenIds)
    }

    clearError(): void {
        this.errorMessage = ''
    }

    ok(): void {
        const id = Number(this.id)
        if (!Number.isInteger(id) || id < 0) {
            this.errorMessage = 'ID must be a whole number of 0 or more.'
            return
        }
        if (this.takenIds.has(id)) {
            this.errorMessage = `ID ${id} is already used by another turnout.`
            return
        }
        const result: TurnoutCloneResult = { id, hidden: this.hidden, profile: this.profile }
        void this.$dialog.ok(result)
    }

    cancel(): void {
        void this.$dialog.cancel()
    }
}
