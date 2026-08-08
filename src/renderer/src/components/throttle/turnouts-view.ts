import { resolve } from 'aurelia'
import { ThrottleService, type TurnoutStatus } from '../../services/throttle.service'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { Turnout } from '../../utils/myAutomationParser'

/**
 * Live turnout list — shows each configured turnout's live thrown/closed
 * state and a Close/Throw toggle button pair.
 *
 * Iterates `throttleService.turnoutStatuses` (not `configEditorState.turnouts`)
 * and binds `${status.state}` directly off each loop item: Aurelia only
 * installs a reactive observer for direct member-access expressions bound in
 * the template, not for values read inside a method call — a `stateFor(id)`
 * helper reading the array via `.find()` would compute the right value but
 * never re-render when the service mutates it. Static per-turnout metadata
 * (description/type) doesn't change live, so a method-call lookup is fine there.
 */
export class TurnoutsViewCustomElement {
    readonly throttleService = resolve(ThrottleService)
    private readonly configEditorState = resolve(ConfigEditorState)

    turnoutFor(id: number): Turnout | undefined {
        return this.configEditorState.turnouts.find((t) => t.id === id)
    }

    /** A turnout is binary — Unknown just means "close it" hasn't been confirmed yet, so toggling from Unknown throws it. */
    toggle(status: TurnoutStatus): void {
        if (status.state === 'THROWN') {
            this.throttleService.closeTurnout(status.id)
        } else {
            this.throttleService.throwTurnout(status.id)
        }
    }
}
