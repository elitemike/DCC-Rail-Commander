import { describe, expect, it, vi } from 'vitest'

import { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'
import type { Turnout } from '../../src/renderer/src/utils/myAutomationParser'

function makeState(turnouts: Turnout[]) {
    return {
        turnouts,
        turnoutPreservedComments: '',
        hasChanges: false,
        _syncGeneratedTurnoutDefaultsContent: vi.fn(),
        _syncToInstallerState: vi.fn(),
    }
}

describe('ConfigEditorState.setTurnoutsFromRaw — defaultState preservation', () => {
    // myTurnouts.h's SERVO_TURNOUT()/PIN_TURNOUT()/TURNOUT() syntax has no field
    // for defaultState — parseTurnoutFromFile always defaults it to CLOSED, so
    // re-parsing on every raw round-trip (even switching to Raw and back with no
    // edits) must not silently discard a defaultState the user already set via
    // the visual form, or the generated myAutomation.h AUTOSTART block loses its
    // THROW entries.

    it('preserves defaultState for a turnout id that still exists after the raw round-trip', () => {
        const state = makeState([
            { type: 'SERVO', id: 200, pin: 25, activeAngle: 410, inactiveAngle: 205, profile: 'Slow', description: 'Main Line Junction', comment: '', defaultState: 'THROWN' },
        ])

        ConfigEditorState.prototype.setTurnoutsFromRaw.call(
            state,
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
        )

        expect(state.turnouts).toEqual([
            expect.objectContaining({ id: 200, defaultState: 'THROWN' }),
        ])
    })

    it('defaults a genuinely new turnout id to CLOSED (nothing to preserve)', () => {
        const state = makeState([])

        ConfigEditorState.prototype.setTurnoutsFromRaw.call(
            state,
            'SERVO_TURNOUT(300, 25, 410, 205, Slow, "New Turnout")',
        )

        expect(state.turnouts).toEqual([
            expect.objectContaining({ id: 300, defaultState: 'CLOSED' }),
        ])
    })

    it('does not leak a removed turnout\'s defaultState onto an unrelated id', () => {
        const state = makeState([
            { type: 'SERVO', id: 200, pin: 25, activeAngle: 410, inactiveAngle: 205, profile: 'Slow', description: 'Old', comment: '', defaultState: 'THROWN' },
        ])

        ConfigEditorState.prototype.setTurnoutsFromRaw.call(
            state,
            'SERVO_TURNOUT(201, 26, 410, 205, Fast, "Different Turnout")',
        )

        expect(state.turnouts).toEqual([
            expect.objectContaining({ id: 201, defaultState: 'CLOSED' }),
        ])
    })
})
