import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { Turnout } from '../../utils/myAutomationParser'

/**
 * turnout-defaults-summary — read-only view of which turnouts start THROWN
 * at power-on, shown on the Startup row alongside TrackManager.
 *
 * Deliberately no edit surface here: defaultState is set per-turnout in the
 * Turnouts editor (myTurnouts.h has no field for it — see
 * config-editor-state-turnouts-raw.test.ts) and this component only reads
 * `editorState.turnouts`. "Edit in Turnouts" navigates there via a small
 * window CustomEvent, mirroring the exinst:config-switched pattern already
 * used elsewhere in this app.
 */
export class TurnoutDefaultsSummaryCustomElement {
    private readonly editorState = resolve(ConfigEditorState)

    get thrownTurnouts(): Turnout[] {
        return this.editorState.turnouts.filter(t => t.defaultState === 'THROWN')
    }

    goToTurnouts(): void {
        try {
            window.dispatchEvent(new CustomEvent('exinst:navigate-file', { detail: { filename: 'myTurnouts.h' } }))
        } catch {
            // noop in non-browser contexts
        }
    }
}
