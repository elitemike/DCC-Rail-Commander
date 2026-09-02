import { describe, it, expect, vi } from 'vitest'
import { TurnoutEditorCustomElement } from '../../src/renderer/src/components/visual-editors/turnout-editor'
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
        editorDefaultView: { value: 'visual' as const },
        splitterObj: null,
        activeTab: 'raw' as const,
        _userChoseTab: false,
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

// ── setTab: raw snapshot seeding ─────────────────────────────────────────────
// rawSnapshot/_rawText are only ever populated as a side effect of setTab('raw') —
// attached() routes a 'raw' default-editor-view preference through this same
// method (rather than seeding activeTab directly) specifically so the raw Monaco
// editor doesn't open empty. This covers the seeding logic that guarantee depends on.

describe('TurnoutEditorCustomElement.setTab', () => {
    it('seeds rawSnapshot and _rawText from state.turnoutsRaw when switching to raw', () => {
        const { editor, state } = makeEditor()
        ;(state as unknown as { turnoutsRaw: string }).turnoutsRaw = VALID_TURNOUT

        editor.setTab('raw')

        expect(editor.rawSnapshot).toBe(VALID_TURNOUT)
        expect(editor._rawText).toBe(VALID_TURNOUT)
        expect(editor.activeTab).toBe('raw')
    })

    it('marks the tab as a user choice, so a later attached() visit will not override it', () => {
        const { editor } = makeEditor()

        editor.setTab('visual')

        expect((editor as unknown as { _userChoseTab: boolean })._userChoseTab).toBe(true)
    })
})

// ── _applyDefaultViewIfUnset(): re-applies the default-editor-view preference ─
// Aurelia's if.bind caches and reuses this same component instance across
// hide/show cycles, so attached() calls this on every visit (not just
// construction) — see it directly, not via attached() itself, since attached()
// also touches `document` (deferred Splitter setup) which isn't available in
// this Node-environment test run.

describe('TurnoutEditorCustomElement._applyDefaultViewIfUnset', () => {
    it('applies the current default-editor-view preference when the user has not chosen a tab', () => {
        const { editor, state } = makeEditor()
        editor.activeTab = 'visual'
        ;(editor as unknown as { editorDefaultView: { value: string } }).editorDefaultView = { value: 'raw' }
        ;(state as unknown as { turnoutsRaw: string }).turnoutsRaw = VALID_TURNOUT

        ;(editor as unknown as { _applyDefaultViewIfUnset(): void })._applyDefaultViewIfUnset()

        expect(editor.activeTab).toBe('raw')
        expect(editor.rawSnapshot).toBe(VALID_TURNOUT)
    })

    it('does not override a tab the user already picked for this file', () => {
        const { editor } = makeEditor()
        editor.setTab('visual')
        ;(editor as unknown as { editorDefaultView: { value: string } }).editorDefaultView = { value: 'raw' }

        ;(editor as unknown as { _applyDefaultViewIfUnset(): void })._applyDefaultViewIfUnset()

        expect(editor.activeTab).toBe('visual')
    })
})

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

describe('TurnoutEditorCustomElement default state', () => {
    it('commits defaultState changes to turnout entries', () => {
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        const updateTurnoutEntry = vi.fn()
        Object.assign(editor, {
            state: { updateTurnoutEntry },
            editBufferIndex: 0,
            editBuffer: {
                type: 'SERVO',
                id: 200,
                pin: 25,
                activeAngle: 410,
                inactiveAngle: 205,
                profile: 'Slow',
                description: 'Main Line Junction',
                comment: '',
                defaultState: 'CLOSED',
            },
        })

        editor.updateDefaultState('THROWN')

        expect(updateTurnoutEntry).toHaveBeenCalledOnce()
        const [, updated] = updateTurnoutEntry.mock.calls[0]
        expect(updated.defaultState).toBe('THROWN')
    })
})

describe('TurnoutEditorCustomElement alias integration', () => {
    it('populates aliasInput from myAliases.h when selecting a turnout entry', () => {
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, {
            state: { getPrimaryAliasNameForId: vi.fn().mockReturnValue('MAIN_YARD') },
            aliasInput: '',
        })

            ; (editor as any)._setBuffer(0, {
                type: 'DCC',
                id: 200,
                addr: 10,
                subAddr: 1,
                description: 'Yard Exit',
                comment: '',
                defaultState: 'CLOSED',
            })

        expect(editor.aliasInput).toBe('MAIN_YARD')
    })

    it('syncs the matching alias when the turnout ID or alias changes', () => {
        const existing = {
            type: 'SERVO' as const,
            id: 200,
            pin: 25,
            activeAngle: 410,
            inactiveAngle: 205,
            profile: 'Slow' as const,
            description: 'Main Line Junction',
            comment: '',
            defaultState: 'CLOSED' as const,
        }
        const updateTurnoutEntry = vi.fn()
        const syncAliasForId = vi.fn().mockReturnValue({ ok: true })
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, {
            state: {
                turnouts: [existing],
                updateTurnoutEntry,
                syncAliasForId,
                getPrimaryAliasNameForId: vi.fn().mockReturnValue('OLD_TURNOUT'),
            },
            editBufferIndex: 0,
            editBuffer: { ...existing, id: 201 },
            aliasInput: 'NEW_TURNOUT',
        })

        editor.commitBuffer()

        expect(updateTurnoutEntry).toHaveBeenCalledWith(0, { ...existing, id: 201 })
        expect(syncAliasForId).toHaveBeenCalledWith(200, 201, 'NEW_TURNOUT', 'Turnout', 'OLD_TURNOUT')
    })

    it('coerces numeric fields back to numbers before persisting (value.bind on <input type="number"> yields strings)', () => {
        const existing = {
            type: 'SERVO' as const,
            id: 200,
            pin: 25,
            activeAngle: 410,
            inactiveAngle: 205,
            profile: 'Slow' as const,
            description: 'Main Line Junction',
            comment: '',
            defaultState: 'CLOSED' as const,
        }
        const updateTurnoutEntry = vi.fn()
        const syncAliasForId = vi.fn().mockReturnValue({ ok: true })
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, {
            state: {
                turnouts: [existing],
                updateTurnoutEntry,
                syncAliasForId,
                getPrimaryAliasNameForId: vi.fn().mockReturnValue(''),
            },
            editBufferIndex: 0,
            // Simulate what the DOM actually hands back from a number input: strings.
            editBuffer: { ...existing, id: '3' as unknown as number, pin: '25' as unknown as number, activeAngle: '410' as unknown as number, inactiveAngle: '205' as unknown as number },
            aliasInput: '',
        })

        editor.commitBuffer()

        const [, persisted] = updateTurnoutEntry.mock.calls[0]
        expect(persisted).toEqual({ ...existing, id: 3 })
        expect(typeof persisted.id).toBe('number')
        expect(typeof persisted.pin).toBe('number')
        expect(typeof persisted.activeAngle).toBe('number')
        expect(typeof persisted.inactiveAngle).toBe('number')
        // syncAliasForId must also see the coerced numeric ID, not the raw string.
        expect(syncAliasForId).toHaveBeenCalledWith(200, 3, '', 'Turnout', '')
    })

    it('rejects committing an ID that collides with another turnout and does not persist', () => {
        const other = {
            type: 'SERVO' as const,
            id: 201,
            pin: 26,
            activeAngle: 410,
            inactiveAngle: 205,
            profile: 'Fast' as const,
            description: 'Yard Entry',
            comment: '',
            defaultState: 'CLOSED' as const,
        }
        const editing = {
            type: 'SERVO' as const,
            id: 200,
            pin: 25,
            activeAngle: 410,
            inactiveAngle: 205,
            profile: 'Slow' as const,
            description: 'Main Line Junction',
            comment: '',
            defaultState: 'CLOSED' as const,
        }
        const updateTurnoutEntry = vi.fn()
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, {
            state: { turnouts: [editing, other], updateTurnoutEntry },
            editBufferIndex: 0,
            editBuffer: { ...editing, id: 201 },
            aliasInput: '',
            errorMessage: '',
        })

        editor.commitBuffer()

        expect(updateTurnoutEntry).not.toHaveBeenCalled()
        expect(editor.errorMessage).toContain('201')
        expect(editor.errorMessage).toContain('Yard Entry')
    })
})

describe('TurnoutEditorCustomElement strict aliases', () => {
    const TURNOUT = {
        type: 'SERVO' as const,
        id: 200,
        pin: 25,
        activeAngle: 410,
        inactiveAngle: 205,
        profile: 'Slow' as const,
        description: 'Main Line Junction',
        comment: '',
        defaultState: 'CLOSED' as const,
    }

    it('blocks the commit — even of an unrelated field, not just the alias — when strictAliases is on and no alias is set', () => {
        const updateTurnoutEntry = vi.fn()
        const syncAliasForId = vi.fn()
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, {
            state: { turnouts: [TURNOUT], strictAliases: true, updateTurnoutEntry, syncAliasForId, getPrimaryAliasNameForId: vi.fn().mockReturnValue('') },
            editBufferIndex: 0,
            // Only the description changed — the alias field was never touched.
            editBuffer: { ...TURNOUT, description: 'Renamed' },
            aliasInput: '',
            errorMessage: '',
        })

        editor.commitBuffer()

        expect(updateTurnoutEntry).not.toHaveBeenCalled()
        expect(syncAliasForId).not.toHaveBeenCalled()
        expect(editor.errorMessage).toContain('alias')
    })

    it('allows the commit when strictAliases is on and an alias is present', () => {
        const updateTurnoutEntry = vi.fn()
        const syncAliasForId = vi.fn().mockReturnValue({ ok: true })
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, {
            state: { turnouts: [TURNOUT], strictAliases: true, updateTurnoutEntry, syncAliasForId, getPrimaryAliasNameForId: vi.fn().mockReturnValue('YARD_TURNOUT') },
            editBufferIndex: 0,
            editBuffer: { ...TURNOUT, description: 'Renamed' },
            aliasInput: 'YARD_TURNOUT',
            errorMessage: '',
        })

        editor.commitBuffer()

        expect(updateTurnoutEntry).toHaveBeenCalledWith(0, { ...TURNOUT, description: 'Renamed' })
        expect(editor.errorMessage).toBe('')
    })

    it('allows an aliasless commit when strictAliases is off', () => {
        const updateTurnoutEntry = vi.fn()
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, {
            state: { turnouts: [TURNOUT], strictAliases: false, updateTurnoutEntry, getPrimaryAliasNameForId: vi.fn().mockReturnValue('') },
            editBufferIndex: 0,
            editBuffer: { ...TURNOUT, description: 'Renamed' },
            aliasInput: '',
            errorMessage: '',
        })

        editor.commitBuffer()

        expect(updateTurnoutEntry).toHaveBeenCalledWith(0, { ...TURNOUT, description: 'Renamed' })
        expect(editor.errorMessage).toBe('')
    })
})
