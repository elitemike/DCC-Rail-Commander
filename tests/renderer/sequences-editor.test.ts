import { describe, it, expect, vi } from 'vitest'
import { SequencesEditorCustomElement } from '../../src/renderer/src/components/visual-editors/sequences-editor'
import type { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'

// ── Factory ───────────────────────────────────────────────────────────────────

function makeEditor(sequences: { id: number; description?: string; body?: string }[], aliases: { name: string; value: string; aliasType?: string }[] = []) {
    const editor = Object.create(SequencesEditorCustomElement.prototype) as SequencesEditorCustomElement

    const state = {
        sequences,
        aliases,
        syncAll: vi.fn(),
        getPrimaryAliasNameForId: vi.fn((id: number, type?: string) => {
            const match = aliases.find(a => Number(a.value) === id && (!type || a.aliasType === type))
            return match?.name ?? ''
        }),
        syncAliasForId: vi.fn((previousId: number, nextId: number, name: string) => {
            const trimmed = name.trim()
            if (trimmed === '') return { ok: true }
            const idx = aliases.findIndex(a => Number(a.value) === previousId)
            if (idx !== -1) aliases[idx] = { ...aliases[idx], name: trimmed, value: String(nextId) }
            else aliases.push({ name: trimmed, value: String(nextId), aliasType: 'Sequence' })
            return { ok: true }
        }),
        getSequenceIdViolations: vi.fn(() => []),
    } as unknown as ConfigEditorState

    const toastShow = vi.fn()

    Object.assign(editor, {
        state,
        toastService: { show: toastShow },
        editorDefaultView: { value: 'visual' as const },
        activeTab: 'visual' as const,
        _userChoseTab: false,
        rawEditor: null,
        rawSnapshot: '',
        selectedId: null,
        rowTab: {},
        rowRawEditor: null,
        rowRawSnapshot: '',
    })

    return { editor, state, toastShow }
}

// ── setTab: raw snapshot seeding ─────────────────────────────────────────────
// rawSnapshot is only ever populated as a side effect of setTab('raw') —
// attached() routes a 'raw' default-editor-view preference through this same
// method (rather than seeding activeTab directly) specifically so the raw
// Monaco editor doesn't open empty. This covers the seeding logic that
// guarantee depends on.

describe('SequencesEditorCustomElement.setTab', () => {
    it('seeds rawSnapshot from state.sequencesRaw when switching to raw', () => {
        const { editor, state } = makeEditor([{ id: 1, description: 'Yard shunt' }])
        editor.activeTab = 'visual'
        ;(state as unknown as { sequencesRaw: string }).sequencesRaw = 'SEQUENCE(1)\nDONE'

        editor.setTab('raw')

        expect(editor.rawSnapshot).toBe('SEQUENCE(1)\nDONE')
        expect(editor.activeTab).toBe('raw')
    })

    it('marks the tab as a user choice, so a later attached() visit will not override it', () => {
        const { editor } = makeEditor([])

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

describe('SequencesEditorCustomElement._applyDefaultViewIfUnset', () => {
    it('applies the current default-editor-view preference when the user has not chosen a tab', () => {
        const { editor, state } = makeEditor([{ id: 1, description: 'Yard shunt' }])
        editor.activeTab = 'visual'
        ;(editor as unknown as { editorDefaultView: { value: string } }).editorDefaultView = { value: 'raw' }
        ;(state as unknown as { sequencesRaw: string }).sequencesRaw = 'SEQUENCE(1)\nDONE'

        ;(editor as unknown as { _applyDefaultViewIfUnset(): void })._applyDefaultViewIfUnset()

        expect(editor.activeTab).toBe('raw')
        expect(editor.rawSnapshot).toBe('SEQUENCE(1)\nDONE')
    })

    it('does not override a tab the user already picked for this file', () => {
        const { editor } = makeEditor([])
        editor.setTab('visual')
        ;(editor as unknown as { editorDefaultView: { value: string } }).editorDefaultView = { value: 'raw' }

        ;(editor as unknown as { _applyDefaultViewIfUnset(): void })._applyDefaultViewIfUnset()

        expect(editor.activeTab).toBe('visual')
    })
})

// ── makeAliasChangeHandler ────────────────────────────────────────────────────

describe('SequencesEditorCustomElement.makeAliasChangeHandler', () => {
    it('persists a new alias name for the sequence at the given id', () => {
        const { editor, state } = makeEditor([{ id: 1, description: 'Yard shunt' }])

        editor.makeAliasChangeHandler(1)('YARD_SHUNT')

        expect(state.syncAliasForId).toHaveBeenCalledWith(1, 1, 'YARD_SHUNT', 'Sequence', '')
    })

    it('passes the existing alias name through so a rename/clear resolves the same alias entry', () => {
        const { editor, state } = makeEditor(
            [{ id: 1, description: 'Yard shunt' }],
            [{ name: 'YARD_SHUNT', value: '1', aliasType: 'Sequence' }],
        )

        editor.makeAliasChangeHandler(1)('YARD_SHUNT_2')

        expect(state.syncAliasForId).toHaveBeenCalledWith(1, 1, 'YARD_SHUNT_2', 'Sequence', 'YARD_SHUNT')
    })

    it('shows a warning toast when the alias name conflicts', () => {
        const { editor, state, toastShow } = makeEditor([{ id: 1, description: 'Yard shunt' }])
        ;(state.syncAliasForId as ReturnType<typeof vi.fn>).mockReturnValueOnce({ ok: false, reason: 'Alias name "YARD_SHUNT" is already used for a different ID. Choose a unique name.' })

        editor.makeAliasChangeHandler(1)('YARD_SHUNT')

        expect(toastShow).toHaveBeenCalledOnce()
        const [payload] = toastShow.mock.calls[0]
        expect(payload).toMatchObject({ title: 'Alias Error', cssClass: 'e-toast-warning' })
        expect(payload.content).toContain('YARD_SHUNT')
    })
})

// ── updateSequence (id rename) ──────────────────────────────────────────────

describe('SequencesEditorCustomElement.updateSequence (id rename)', () => {
    it('carries the alias forward and updates selectedId when the ID is edited', () => {
        const { editor, state } = makeEditor(
            [{ id: 1, description: 'Yard shunt' }],
            [{ name: 'YARD_SHUNT', value: '1', aliasType: 'Sequence' }],
        )
        editor.selectedId = 1

        editor.updateSequence(0, { ...state.sequences[0], id: 5 })

        expect(editor.selectedId).toBe(5)
        expect(state.syncAliasForId).toHaveBeenCalledWith(1, 5, 'YARD_SHUNT', 'Sequence', 'YARD_SHUNT')
        expect(state.aliases[0]).toMatchObject({ name: 'YARD_SHUNT', value: '5' })
    })

    it('does not touch aliases when the ID is unchanged', () => {
        const { editor, state } = makeEditor([{ id: 1, description: 'Yard shunt' }])
        editor.selectedId = 1

        editor.updateSequence(0, { ...state.sequences[0], description: 'New desc' })

        expect(state.syncAliasForId).not.toHaveBeenCalled()
    })

    it('warns via toast when the new ID collides with the shared ROUTE/AUTOMATION/SEQUENCE namespace', () => {
        const { editor, state, toastShow } = makeEditor([{ id: 1, description: 'Yard shunt' }])
        ;(state.getSequenceIdViolations as any).mockReturnValue([{ kind: 'Sequence', id: 5, reason: 'ID 5 is already used by Route 5.' }])
        editor.selectedId = 1

        editor.updateSequence(0, { ...state.sequences[0], id: 5 })

        expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sequence ID Warning' }))
    })
})

describe('SequencesEditorCustomElement strict aliases', () => {
    it('blocks updateSequence — including a body-only edit routed through makeBodyChangeHandler — when strictAliases is on and no alias is set', () => {
        const { editor, state } = makeEditor([{ id: 1, description: 'Yard shunt', body: '' }])
        state.strictAliases = true
        editor.selectedId = 1

        editor.makeBodyChangeHandler(1)('THROW(1)\nDONE')

        expect(state.sequences).toEqual([{ id: 1, description: 'Yard shunt', body: '' }])
    })

    it('shows a warning toast when updateSequence is blocked', () => {
        const { editor, state, toastShow } = makeEditor([{ id: 1, description: 'Yard shunt' }])
        state.strictAliases = true

        editor.updateSequence(0, { ...state.sequences[0], description: 'New desc' })

        expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ title: 'Alias Required' }))
    })

    it('allows updateSequence when strictAliases is on and an alias is present', () => {
        const { editor, state } = makeEditor(
            [{ id: 1, description: 'Yard shunt' }],
            [{ name: 'yardshunt', value: '1', aliasType: 'Sequence' }],
        )
        state.strictAliases = true

        editor.updateSequence(0, { ...state.sequences[0], description: 'New desc' })

        expect(state.sequences[0]).toMatchObject({ description: 'New desc' })
    })

    it('allows an aliasless updateSequence when strictAliases is off', () => {
        const { editor, state } = makeEditor([{ id: 1, description: 'Yard shunt' }])
        state.strictAliases = false

        editor.updateSequence(0, { ...state.sequences[0], description: 'New desc' })

        expect(state.sequences[0]).toMatchObject({ description: 'New desc' })
    })

    it('uses the pre-edit id to look up the alias when a rename is in flight, so an aliased sequence can still be renamed', () => {
        const { editor, state } = makeEditor(
            [{ id: 1, description: 'Yard shunt' }],
            [{ name: 'yardshunt', value: '1', aliasType: 'Sequence' }],
        )
        state.strictAliases = true
        editor.selectedId = 1

        editor.updateSequence(0, { ...state.sequences[0], id: 5 })

        expect(state.sequences[0]).toMatchObject({ id: 5 })
    })
})

describe('SequencesEditorCustomElement.makeIdChangeHandler', () => {
    it('looks the sequence up by the id captured at bind time and persists the new id', () => {
        const { editor, state } = makeEditor([{ id: 1, description: 'Yard shunt' }])
        editor.selectedId = 1

        editor.makeIdChangeHandler(1)(5)

        expect(state.sequences[0]).toMatchObject({ id: 5 })
        expect(editor.selectedId).toBe(5)
    })

    it('does nothing when the captured id no longer matches any sequence', () => {
        const { editor, state } = makeEditor([{ id: 1, description: 'Yard shunt' }])

        editor.makeIdChangeHandler(99)(5)

        expect(state.syncAll).not.toHaveBeenCalled()
    })
})

// ── rowRawFilename / onRowRawChange (per-row Raw Monaco editor) ────────────────

describe('SequencesEditorCustomElement.rowRawFilename', () => {
    it('scopes the synthetic filename to the currently selected sequence id', () => {
        const { editor } = makeEditor([{ id: 42, description: '', body: '' }])
        editor.selectedId = 42

        expect(editor.rowRawFilename).toBe('mySequences.h#42')
    })

    it('falls back to the plain filename when nothing is selected', () => {
        const { editor } = makeEditor([])
        editor.selectedId = null

        expect(editor.rowRawFilename).toBe('mySequences.h')
    })
})

describe('SequencesEditorCustomElement.applyRowRawChange', () => {
    it('parses the header line back into the selected sequence and persists via updateSequence', () => {
        const { editor, state } = makeEditor([{ id: 1, description: 'Old', body: 'THROW(200)' }])
        editor.selectedId = 1

        editor.applyRowRawChange('SEQUENCE(1) // New desc\nCLOSE(201)')

        expect(state.sequences[0]).toMatchObject({ description: 'New desc', body: 'CLOSE(201)' })
        expect(state.syncAll).toHaveBeenCalled()
        expect(editor.rowRawSnapshot).toBe('SEQUENCE(1) // New desc\nCLOSE(201)')
    })

    it('does nothing when no sequence is selected', () => {
        const { editor, state } = makeEditor([{ id: 1, description: '', body: '' }])
        editor.selectedId = null

        editor.applyRowRawChange('SEQUENCE(1)\nTHROW(200)')

        expect(state.syncAll).not.toHaveBeenCalled()
    })
})

describe('SequencesEditorCustomElement.flushPending', () => {
    it('flushes both the whole-file and per-row Raw Monaco editors', () => {
        const { editor } = makeEditor([])
        const rawFlush = vi.fn()
        const rowRawFlush = vi.fn()
        editor.rawEditor = { flush: rawFlush }
        editor.rowRawEditor = { flush: rowRawFlush, switchModel: vi.fn() }

        editor.flushPending()

        expect(rawFlush).toHaveBeenCalledOnce()
        expect(rowRawFlush).toHaveBeenCalledOnce()
    })
})
