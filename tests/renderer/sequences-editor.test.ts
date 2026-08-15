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
    } as unknown as ConfigEditorState

    const toastShow = vi.fn()

    Object.assign(editor, {
        state,
        toastService: { show: toastShow },
        activeTab: 'visual' as const,
        rawEditor: null,
        rawSnapshot: '',
        selectedId: null,
        rowTab: {},
    })

    return { editor, state, toastShow }
}

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
