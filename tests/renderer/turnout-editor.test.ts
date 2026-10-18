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

describe('TurnoutEditorCustomElement tree context menu', () => {
    const servo = (id: number, extra: Record<string, unknown> = {}) => ({
        type: 'SERVO' as const, id, pin: 100 + id, activeAngle: 400, inactiveAngle: 100, profile: 'Slow' as const,
        description: `T${id}`, comment: '', defaultState: 'CLOSED' as const, ...extra,
    })
    const virtual = (id: number, extra: Record<string, unknown> = {}) => ({
        type: 'VIRTUAL' as const, id, description: `V${id}`, comment: '', defaultState: 'CLOSED' as const, ...extra,
    })

    function makeMenuEditor(turnouts: unknown[]) {
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        const cloneEntry = vi.fn().mockResolvedValue(undefined)
        const removeEntryByIndex = vi.fn().mockResolvedValue(undefined)
        const addEntry = vi.fn().mockResolvedValue(undefined)
        const promptNewFolder = vi.fn().mockResolvedValue(undefined)
        const promptRenameFolder = vi.fn().mockResolvedValue(undefined)
        const deleteFolder = vi.fn().mockResolvedValue(undefined)
        Object.assign(editor, {
            state: { turnouts },
            _contextMenuNodeId: null,
            cloneEntry, removeEntryByIndex, addEntry, promptNewFolder, promptRenameFolder, deleteFolder,
        })
        const select = (id: string, nodeId: string) => {
            ;(editor as any)._contextMenuNodeId = nodeId
            ;(editor as any)._onMenuSelect({ item: { id } })
        }
        return { editor, select, cloneEntry, removeEntryByIndex, addEntry, promptNewFolder, promptRenameFolder, deleteFolder }
    }

    it('Clone / Delete on a turnout node act on that turnout’s index', () => {
        const { select, cloneEntry, removeEntryByIndex } = makeMenuEditor([servo(1), servo(2)])

        select('clone', 't:1')
        select('delete', 't:0')

        expect(cloneEntry).toHaveBeenCalledWith(1)
        expect(removeEntryByIndex).toHaveBeenCalledWith(0)
    })

    it('Add Turnout Here on a VIRTUAL turnout nests the new one under it; on a plain turnout it does nothing', () => {
        const { select, addEntry } = makeMenuEditor([servo(1), virtual(7)])

        select('add-here', 't:0')
        expect(addEntry).not.toHaveBeenCalled()

        select('add-here', 't:1')
        expect(addEntry).toHaveBeenCalledWith({ parentId: 7 })
    })

    it('folder nodes route New Folder / Rename / Delete / Add Turnout Here to the folder path', () => {
        const { select, promptNewFolder, promptRenameFolder, deleteFolder, addEntry } = makeMenuEditor([])

        select('new-folder', 'folder:Yard/East')
        select('rename-folder', 'folder:Yard/East')
        select('delete-folder', 'folder:Yard/East')
        select('add-here', 'folder:Yard/East')

        expect(promptNewFolder).toHaveBeenCalledWith('Yard/East')
        expect(promptRenameFolder).toHaveBeenCalledWith('Yard/East')
        expect(deleteFolder).toHaveBeenCalledWith('Yard/East')
        expect(addEntry).toHaveBeenCalledWith({ folder: 'Yard/East' })
    })

    it('ignores a menu pick when no node is targeted', () => {
        const { editor, cloneEntry, removeEntryByIndex } = makeMenuEditor([servo(1)])
        ;(editor as any)._onMenuSelect({ item: { id: 'delete' } })
        expect(cloneEntry).not.toHaveBeenCalled()
        expect(removeEntryByIndex).not.toHaveBeenCalled()
    })
})

describe('TurnoutEditorCustomElement tree placement', () => {
    it('commitBuffer keeps the placement held in state, even when the edit buffer’s copy is stale', () => {
        const stored = { type: 'VIRTUAL' as const, id: 200, description: 'Old', comment: '', defaultState: 'CLOSED' as const, folder: 'Moved/Here' }
        const updateTurnoutEntry = vi.fn()
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, {
            state: {
                turnouts: [stored],
                updateTurnoutEntry,
                getPrimaryAliasNameForId: vi.fn().mockReturnValue(''),
                syncAliasForId: vi.fn().mockReturnValue({ ok: true }),
                strictAliases: false,
            },
            // The buffer was taken before the folder was renamed / the turnout was dragged elsewhere.
            editBuffer: { ...stored, description: 'Edited', folder: 'Stale/Folder' },
            editBufferIndex: 0,
            aliasInput: '',
            errorMessage: '',
        })

        editor.commitBuffer()

        expect(updateTurnoutEntry).toHaveBeenCalledTimes(1)
        const written = updateTurnoutEntry.mock.calls[0][1]
        expect(written.description).toBe('Edited')
        expect(written.folder).toBe('Moved/Here')
    })

    it('onLocationChange moves the selected turnout and falls back to its real location if the move is refused', () => {
        const t = { type: 'SERVO' as const, id: 1, pin: 101, activeAngle: 400, inactiveAngle: 100, profile: 'Slow' as const, description: 'T1', comment: '', defaultState: 'CLOSED' as const }
        const moveTurnoutTo = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, {
            state: { turnouts: [t], moveTurnoutTo },
            editBuffer: { ...t },
            editBufferIndex: 0,
            errorMessage: '',
            locationValue: 'folder:Yard',
            commitBuffer: vi.fn(),
            _afterTreeChange: vi.fn(),
        })

        editor.onLocationChange()
        expect(moveTurnoutTo).toHaveBeenLastCalledWith(0, { folder: 'Yard' })

        editor.locationValue = 'parent:9'
        editor.onLocationChange()
        expect(moveTurnoutTo).toHaveBeenLastCalledWith(0, { parentId: 9 })
        expect(editor.locationValue).toBe('root') // refused → snaps back to where the turnout actually is
    })

    it('locationOptions lists top level, folders, and other VIRTUAL turnouts — but not itself or its own descendants', () => {
        const turnouts = [
            { type: 'VIRTUAL', id: 1, description: 'Parent', comment: '', defaultState: 'CLOSED', folder: 'Yard' },
            { type: 'VIRTUAL', id: 2, description: 'Child', comment: '', defaultState: 'CLOSED', parentId: 1 },
            { type: 'VIRTUAL', id: 3, description: 'Other', comment: '', defaultState: 'CLOSED' },
        ]
        const editor = Object.create(TurnoutEditorCustomElement.prototype) as TurnoutEditorCustomElement
        Object.assign(editor, {
            state: { turnouts, turnoutFolders: ['Spare'], getPrimaryAliasNameForId: () => '' },
            editBufferIndex: 0, // "Parent" selected
        })

        const values = editor.locationOptions.map(o => o.value)

        expect(values).toEqual(['root', 'folder:Spare', 'folder:Yard', 'parent:3'])
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
