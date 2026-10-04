import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

describe('TurnoutEditorCustomElement hidden-from-throttles', () => {
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

    it('isHidden reflects the DCC-EX HIDDEN description literal', () => {
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, { editBuffer: { ...TURNOUT, description: 'HIDDEN' } })
        expect(editor.isHidden).toBe(true)

        Object.assign(editor, { editBuffer: { ...TURNOUT, description: 'Main Line Junction' } })
        expect(editor.isHidden).toBe(false)
    })

    it('toggleHidden(true) sets description to the literal HIDDEN and commits', () => {
        const updateTurnoutEntry = vi.fn()
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, {
            state: { turnouts: [TURNOUT], updateTurnoutEntry, getPrimaryAliasNameForId: vi.fn().mockReturnValue('') },
            editBufferIndex: 0,
            editBuffer: { ...TURNOUT },
            aliasInput: '',
        })

        editor.toggleHidden(true)

        expect(editor.editBuffer?.description).toBe('HIDDEN')
        expect(updateTurnoutEntry).toHaveBeenCalledWith(0, expect.objectContaining({ description: 'HIDDEN' }))
    })

    it('toggleHidden(false) clears the description back out', () => {
        const updateTurnoutEntry = vi.fn()
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, {
            state: { turnouts: [{ ...TURNOUT, description: 'HIDDEN' }], updateTurnoutEntry, getPrimaryAliasNameForId: vi.fn().mockReturnValue('') },
            editBufferIndex: 0,
            editBuffer: { ...TURNOUT, description: 'HIDDEN' },
            aliasInput: '',
        })

        editor.toggleHidden(false)

        expect(editor.editBuffer?.description).toBe('')
        expect(updateTurnoutEntry).toHaveBeenCalledWith(0, expect.objectContaining({ description: '' }))
    })

    it('getDisplayName shows a "(hidden)" marker instead of the raw HIDDEN literal', () => {
        const { editor, state } = makeEditor()
        ;(state as unknown as { getPrimaryAliasNameForId: () => string }).getPrimaryAliasNameForId = () => ''
        expect(editor.getDisplayName({ ...TURNOUT, description: 'HIDDEN' })).toBe('Turnout 200 (hidden)')
        expect(editor.getDisplayName({ ...TURNOUT, description: 'Main Line Junction' })).toBe('Main Line Junction (200)')
    })

    it('getDisplayName shows the alias for a hidden turnout that has one', () => {
        const { editor, state } = makeEditor()
        ;(state as unknown as { getPrimaryAliasNameForId: () => string }).getPrimaryAliasNameForId = () => 'Yard_Reverse_Crossover_Hidden'
        const hidden = { ...TURNOUT, description: 'HIDDEN' }
        expect(editor.getDisplayName(hidden)).toBe('Yard_Reverse_Crossover_Hidden (200) (hidden)')
        // the sidebar list omits the word and shows an eye-off icon instead
        expect(editor.getListLabel(hidden)).toBe('Yard_Reverse_Crossover_Hidden (200)')
        expect(editor.isEntryHidden(hidden)).toBe(true)
        expect(editor.isEntryHidden({ ...TURNOUT, description: 'Main Line Junction' })).toBe(false)
    })
})

describe('TurnoutEditorCustomElement.applyClone', () => {
    function makeCloneEditor(turnouts: unknown[]) {
        const state = {
            turnouts,
            addTurnoutEntry: vi.fn((entry: unknown) => { turnouts.push(entry) }),
            getPrimaryAliasNameForId: vi.fn().mockReturnValue(''),
        }
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, { state, editBuffer: null, editBufferIndex: null })
        return { editor, state }
    }

    const HIDDEN_INSTANT = { id: 7, hidden: true, profile: 'Instant' as const }
    const SERVO_SOURCE = () => ({
        type: 'SERVO' as const, id: 6, pin: 105, activeAngle: 343, inactiveAngle: 295,
        profile: 'Slow' as const, description: 'Reverse Loop', comment: 'note', defaultState: 'CLOSED' as const,
    })

    it('clones a SERVO turnout with the chosen ID, HIDDEN description and profile, keeping the same pin', () => {
        const source = SERVO_SOURCE()
        const { editor, state } = makeCloneEditor([source])

        editor.applyClone(0, HIDDEN_INSTANT)

        expect(state.addTurnoutEntry).toHaveBeenCalledOnce()
        const [clone] = state.addTurnoutEntry.mock.calls[0]
        // SERVO_TURNOUT(6, 105, 343, 295, Slow, "Reverse Loop") + SERVO_TURNOUT(7, 105, 343, 295, Instant, HIDDEN)
        expect(clone).toEqual({
            type: 'SERVO', id: 7, pin: 105, activeAngle: 343, inactiveAngle: 295,
            profile: 'Instant', description: 'HIDDEN', comment: '', defaultState: 'CLOSED',
        })
        // Original entry is untouched.
        expect(source).toMatchObject({ id: 6, pin: 105, description: 'Reverse Loop', profile: 'Slow' })
    })

    it('applies the profile chosen in the dialog to a servo clone', () => {
        const { editor, state } = makeCloneEditor([SERVO_SOURCE()])

        editor.applyClone(0, { id: 7, hidden: true, profile: 'Bounce' })

        expect(state.addTurnoutEntry.mock.calls[0][0]).toMatchObject({ profile: 'Bounce' })
    })

    it('keeps the source description when the clone is not hidden', () => {
        const { editor, state } = makeCloneEditor([SERVO_SOURCE()])

        editor.applyClone(0, { id: 8, hidden: false, profile: 'Fast' })

        expect(state.addTurnoutEntry.mock.calls[0][0]).toMatchObject({
            id: 8, description: 'Reverse Loop', profile: 'Fast', comment: '',
        })
    })

    it('clones a PIN turnout onto the same pin, without adding a profile', () => {
        const source = { type: 'PIN' as const, id: 5, pin: 22, description: 'GPIO Siding', comment: '', defaultState: 'CLOSED' as const }
        const { editor, state } = makeCloneEditor([source])

        editor.applyClone(0, { id: 6, hidden: true, profile: 'Instant' })

        const [clone] = state.addTurnoutEntry.mock.calls[0]
        expect(clone).toEqual({ type: 'PIN', id: 6, pin: 22, description: 'HIDDEN', comment: '', defaultState: 'CLOSED' })
    })

    it('clones a DCC turnout, keeping its address', () => {
        const source = { type: 'DCC' as const, id: 5, addr: 100, subAddr: 1, description: 'Yard Exit', comment: '', defaultState: 'CLOSED' as const }
        const { editor, state } = makeCloneEditor([source])

        editor.applyClone(0, { id: 6, hidden: true, profile: 'Instant' })

        const [clone] = state.addTurnoutEntry.mock.calls[0]
        expect(clone).toEqual({ type: 'DCC', id: 6, addr: 100, subAddr: 1, description: 'HIDDEN', comment: '', defaultState: 'CLOSED' })
    })

    it('selects the newly-created clone', () => {
        const source = { type: 'DCCL' as const, id: 5, addr: 401, description: 'Linear', comment: '', defaultState: 'CLOSED' as const }
        const { editor } = makeCloneEditor([source])

        editor.applyClone(0, { id: 6, hidden: true, profile: 'Instant' })

        expect(editor.editBufferIndex).toBe(1)
        expect(editor.editBuffer).toMatchObject({ id: 6, description: 'HIDDEN' })
    })

    it('does nothing when the index is out of range', () => {
        const { editor, state } = makeCloneEditor([])

        editor.applyClone(0, HIDDEN_INSTANT)

        expect(state.addTurnoutEntry).not.toHaveBeenCalled()
    })
})

describe('TurnoutEditorCustomElement.cloneEntry', () => {
    const SOURCE = { type: 'VIRTUAL' as const, id: 3, description: 'Sim Siding', comment: '', defaultState: 'CLOSED' as const }
    const OTHER = { type: 'VIRTUAL' as const, id: 50, description: 'Other', comment: '', defaultState: 'CLOSED' as const }

    function makeEditorWithDialog(closed: { status: string; value?: unknown }) {
        const turnouts: unknown[] = [SOURCE, OTHER]
        const state = {
            turnouts,
            addTurnoutEntry: vi.fn((entry: unknown) => { turnouts.push(entry) }),
            getPrimaryAliasNameForId: vi.fn().mockReturnValue(''),
        }
        const open = vi.fn().mockResolvedValue({ dialog: { closed: Promise.resolve(closed) } })
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, { state, dialogService: { open }, editBuffer: null, editBufferIndex: null })
        return { editor, state, open }
    }

    it('opens the dialog suggesting one past the highest ID, not source.id + 1, and passing all taken IDs', async () => {
        const { editor, open } = makeEditorWithDialog({ status: 'cancel' })

        await editor.cloneEntry(0)

        expect(open).toHaveBeenCalledOnce()
        expect(open.mock.calls[0][0].model).toEqual({ sourceType: 'VIRTUAL', suggestedId: 51, takenIds: [3, 50] })
    })

    it('creates the clone from the dialog result', async () => {
        const { editor, state } = makeEditorWithDialog({ status: 'ok', value: { id: 60, hidden: true, profile: 'Instant' } })

        await editor.cloneEntry(0)

        expect(state.addTurnoutEntry.mock.calls[0][0]).toMatchObject({ id: 60, description: 'HIDDEN' })
    })

    it('creates nothing when the dialog is cancelled', async () => {
        const { editor, state } = makeEditorWithDialog({ status: 'cancel' })

        await editor.cloneEntry(0)

        expect(state.addTurnoutEntry).not.toHaveBeenCalled()
    })

    it('does not open the dialog when the index is out of range', async () => {
        const { editor, open } = makeEditorWithDialog({ status: 'cancel' })

        await editor.cloneEntry(9)

        expect(open).not.toHaveBeenCalled()
    })
})

describe('TurnoutEditorCustomElement row context menu', () => {
    // vitest runs in node here — openMenu reads window.innerWidth to right-align the popup
    beforeEach(() => { vi.stubGlobal('window', { innerWidth: 1000 }) })
    afterEach(() => { vi.unstubAllGlobals() })

    function makeMenuEditor() {
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        const cloneEntry = vi.fn().mockResolvedValue(undefined)
        const removeEntryByIndex = vi.fn().mockResolvedValue(undefined)
        Object.assign(editor, { menuIndex: null, menuStyle: '', cloneEntry, removeEntryByIndex })
        return { editor, cloneEntry, removeEntryByIndex }
    }

    function clickEvent(rect: { bottom: number; right: number }) {
        const stopPropagation = vi.fn()
        return {
            event: { stopPropagation, currentTarget: { getBoundingClientRect: () => rect } } as unknown as Event,
            stopPropagation,
        }
    }

    it('openMenu opens the menu for that row, anchored under the button, and does not select the row', () => {
        const { editor } = makeMenuEditor()
        const { event, stopPropagation } = clickEvent({ bottom: 100, right: 300 })

        editor.openMenu(2, event)

        expect(editor.menuIndex).toBe(2)
        expect(editor.menuStyle).toBe(`top:102px;right:${Math.round(window.innerWidth - 300)}px`)
        expect(stopPropagation).toHaveBeenCalled()
    })

    it('openMenu on the already-open row closes it', () => {
        const { editor } = makeMenuEditor()
        editor.openMenu(2, clickEvent({ bottom: 100, right: 300 }).event)

        editor.openMenu(2, clickEvent({ bottom: 100, right: 300 }).event)

        expect(editor.menuIndex).toBeNull()
    })

    it('openMenu on a different row moves the menu to it', () => {
        const { editor } = makeMenuEditor()
        editor.openMenu(2, clickEvent({ bottom: 100, right: 300 }).event)

        editor.openMenu(4, clickEvent({ bottom: 160, right: 300 }).event)

        expect(editor.menuIndex).toBe(4)
    })

    it('menuClone closes the menu and starts the clone flow for the menu row', () => {
        const { editor, cloneEntry } = makeMenuEditor()
        editor.menuIndex = 3

        editor.menuClone()

        expect(editor.menuIndex).toBeNull()
        expect(cloneEntry).toHaveBeenCalledWith(3)
    })

    it('menuDelete closes the menu and starts the delete flow for the menu row', () => {
        const { editor, removeEntryByIndex } = makeMenuEditor()
        editor.menuIndex = 1

        editor.menuDelete()

        expect(editor.menuIndex).toBeNull()
        expect(removeEntryByIndex).toHaveBeenCalledWith(1)
    })

    it('menuClone / menuDelete do nothing when no menu is open', () => {
        const { editor, cloneEntry, removeEntryByIndex } = makeMenuEditor()

        editor.menuClone()
        editor.menuDelete()

        expect(cloneEntry).not.toHaveBeenCalled()
        expect(removeEntryByIndex).not.toHaveBeenCalled()
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
