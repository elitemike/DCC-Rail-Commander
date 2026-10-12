import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { ConfigEditorState } from '../../models/config-editor-state'
import { MIN_CROSSOVER_MEMBERS } from '../../utils/new-object-generators/crossover'

export type NewItemResult = { kind: 'raw' } | { kind: 'crossover' }

type Step = 'select' | 'crossover'

interface NewItemChoice {
    id: 'raw' | 'crossover'
    title: string
    description: string
    /** Object types need existing config; undefined means always available. */
    disabledReason?: () => string
}

/**
 * "+" button dialog in the Configuration list. Step 1 picks what to create — a blank custom file
 * (handled by the caller's existing inline name input) or a wizard-driven object. Adding another
 * object type means adding a choice here, a step below, and a generator under
 * utils/new-object-generators/.
 */
export class NewItemDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)
    readonly state = resolve(ConfigEditorState)

    step: Step = 'select'
    errorMessage = ''

    readonly minMembers = MIN_CROSSOVER_MEMBERS

    // Crossover form
    selectedIds: number[] = []
    masterId = 0
    masterName = ''
    masterAlias = ''
    hideMembers = true

    readonly choices: NewItemChoice[] = [
        {
            id: 'raw',
            title: 'New raw file',
            description: 'A blank custom .h file for your own EXRAIL or DCC-EX commands.',
        },
        {
            id: 'crossover',
            title: 'Multi-turnout crossover',
            description: 'Combine several existing turnouts into one control using ONTHROW / ONCLOSE.',
            disabledReason: () =>
                this.state.turnouts.length < MIN_CROSSOVER_MEMBERS
                    ? `Needs at least ${MIN_CROSSOVER_MEMBERS} turnouts to be defined first.`
                    : '',
        },
    ]

    disabledReason(choice: NewItemChoice): string {
        return choice.disabledReason?.() ?? ''
    }

    choose(choice: NewItemChoice): void {
        if (this.disabledReason(choice)) return
        if (choice.id === 'raw') {
            void this.$dialog.ok({ kind: 'raw' } satisfies NewItemResult)
            return
        }
        this.masterId = this.state.turnouts.reduce((max, t) => Math.max(max, t.id), -1) + 1
        this.errorMessage = ''
        this.step = 'crossover'
    }

    turnoutAlias(id: number): string {
        return this.state.getPrimaryAliasNameForId(id, 'Turnout')
    }

    back(): void {
        this.errorMessage = ''
        this.step = 'select'
    }

    clearError(): void {
        this.errorMessage = ''
    }

    get canCreate(): boolean {
        return this.selectedIds.length >= MIN_CROSSOVER_MEMBERS
    }

    create(): void {
        const result = this.state.createCrossover({
            masterId: Number(this.masterId),
            masterName: this.masterName,
            masterAlias: this.masterAlias,
            memberIds: [...this.selectedIds],
            hideMembers: this.hideMembers,
        })
        if (!result.ok) {
            this.errorMessage = result.reason
            return
        }
        void this.$dialog.ok({ kind: 'crossover' } satisfies NewItemResult)
    }

    cancel(): void {
        void this.$dialog.cancel()
    }
}
