import { describe, it, expect, vi } from 'vitest'
import { TurnoutEditorCustomElement } from '../../src/renderer/src/components/turnout-editor'
import type { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'

// ── Factory ───────────────────────────────────────────────────────────────────

function makeEditor() {
    const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement

    const state = {
        turnouts: [],
        turnoutPreservedComments: '',
        setTurnoutsFromRaw: vi.fn(),
    } as unknown as ConfigEditorState

    const eaPublish = vi.fn()
    const ea = { publish: eaPublish, subscribe: vi.fn() }
    const toastShow = vi.fn()

    Object.assign(editor, {
        state,
        ea,
        toastService: { show: toastShow },
        dialogService: {},
        splitterObj: null,
        activeTab: 'raw' as const,
        editBuffer: null,
        editBufferIndex: null,
        rawEditor: null,
        rawSnapshot: '',
        _rawText: '',
    })

    return { editor, state, eaPublish, toastShow }
}

const VALID_TURNOUT = 'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")'
const VALID_TURNOUT_2 = 'SERVO_TURNOUT(201, 26, 410, 205, Fast, "Yard Entry")'

// ── _processRawLeave: toast publishing ───────────────────────────────────────

describe('TurnoutEditorCustomElement._processRawLeave', () => {
    describe('toast event', () => {
        it('publishes SHOW_TOAST_EVENT when the raw text contains an invalid SERVO_TURNOUT line', () => {
            const { editor, toastShow } = makeEditor()

            editor._processRawLeave('SERVO_TURNOUT(bad input here)')

            expect(toastShow).toHaveBeenCalledOnce()
            const [payload] = toastShow.mock.calls[0]
            expect(payload).toMatchObject({
                title: 'Invalid Lines Commented Out',
                cssClass: 'e-toast-warning',
            })
            expect(payload.content).toContain('1 invalid turnout line is commented out')
        })

        it('pluralises the message for multiple invalid lines', () => {
            const { editor, toastShow } = makeEditor()

            editor._processRawLeave(
                'SERVO_TURNOUT(bad one)\nSERVO_TURNOUT(bad two)',
            )

            expect(toastShow).toHaveBeenCalledOnce()
            const [payload] = toastShow.mock.calls[0]
            expect(payload.content).toContain('2 invalid turnout lines are commented out')
        })

        it('does NOT publish when all SERVO_TURNOUT lines are valid', () => {
            const { editor, toastShow } = makeEditor()

            editor._processRawLeave(VALID_TURNOUT)

            expect(toastShow).not.toHaveBeenCalled()
        })

        it('does NOT publish when the text contains no SERVO_TURNOUT calls at all', () => {
            const { editor, toastShow } = makeEditor()

            editor._processRawLeave('// just a comment\n')

            expect(toastShow).not.toHaveBeenCalled()
        })
    })

    // ── rosterPreservedComments persistence ───────────────────────────────────

    describe('turnoutPreservedComments persistence across multiple toggles', () => {
        it('sets turnoutPreservedComments when an invalid line is first encountered', () => {
            const { editor, state } = makeEditor()

            editor._processRawLeave('SERVO_TURNOUT(bad input)')

            expect(state.turnoutPreservedComments).toMatch(/\/\/ \[INVALID\]/)
            expect(state.turnoutPreservedComments).toContain('SERVO_TURNOUT(bad input)')
        })

        it('preserves the [INVALID] comment on a second toggle (the bug scenario)', () => {
            const { editor, state } = makeEditor()

            // First pass — raw tab has a malformed line; user switches to visual.
            editor._processRawLeave(`SERVO_TURNOUT(bad input)\n${VALID_TURNOUT}`)
            const afterFirstPass = state.turnoutPreservedComments
            expect(afterFirstPass).toContain('// [INVALID]')

            // Simulate the round-trip: the preserved comment + valid serialized lines.
            const rawOnSecondVisit = `${afterFirstPass}\n${VALID_TURNOUT}`

            // Second pass — user switches back to visual again.
            editor._processRawLeave(rawOnSecondVisit)

            expect(state.turnoutPreservedComments).toContain('// [INVALID]')
            expect(state.turnoutPreservedComments).toContain('SERVO_TURNOUT(bad input)')
        })

        it('does NOT publish toast on second toggle when the [INVALID] line is already commented out', () => {
            const { editor, state, toastShow } = makeEditor()

            // First pass: bad line gets commented and toast fires.
            editor._processRawLeave('SERVO_TURNOUT(bad input)')
            expect(toastShow).toHaveBeenCalledOnce()
            toastShow.mockClear()

            // Second pass: text contains the already-commented line.
            // commentInvalidTurnoutLines skips lines starting with '//', so
            // invalidLines is empty → no toast should fire.
            const rawOnSecondVisit = `${state.turnoutPreservedComments}\n${VALID_TURNOUT}`
            editor._processRawLeave(rawOnSecondVisit)

            // Already-commented lines are not re-toasted on subsequent toggles.
            expect(toastShow).not.toHaveBeenCalled()
        })

        it('clears turnoutPreservedComments when all invalid lines have been corrected', () => {
            const { editor, state } = makeEditor()

            // First pass: creates a preserved comment.
            editor._processRawLeave('SERVO_TURNOUT(bad input)')
            expect(state.turnoutPreservedComments).not.toBe('')

            // User fixes the line and switches to visual with only valid content.
            editor._processRawLeave(VALID_TURNOUT)

            expect(state.turnoutPreservedComments).toBe('')
        })
    })
})
