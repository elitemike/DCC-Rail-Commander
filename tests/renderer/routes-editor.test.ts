import { describe, it, expect, vi } from 'vitest'
import { RoutesEditorCustomElement } from '../../src/renderer/src/components/visual-editors/routes-editor'
import type { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'

// ── Factory ───────────────────────────────────────────────────────────────────

function makeEditor(routes: { id: number; description?: string; body?: string }[]) {
    const editor = Object.create(RoutesEditorCustomElement.prototype) as RoutesEditorCustomElement

    const state = {
        routes,
        syncAll: vi.fn(),
    } as unknown as ConfigEditorState

    Object.assign(editor, {
        state,
        activeTab: 'visual' as const,
        rawEditor: null,
        rawSnapshot: '',
        selectedId: null,
        rowTab: {},
        rowRawEditor: null,
        rowRawSnapshot: '',
    })

    return { editor, state }
}

// ── rowRawFilename / onRowRawChange (per-row Raw Monaco editor) ────────────────

describe('RoutesEditorCustomElement.rowRawFilename', () => {
    it('scopes the synthetic filename to the currently selected route id', () => {
        const { editor } = makeEditor([{ id: 7, description: '', body: '' }])
        editor.selectedId = 7

        expect(editor.rowRawFilename).toBe('myRoutes.h#7')
    })

    it('falls back to the plain filename when nothing is selected', () => {
        const { editor } = makeEditor([])
        editor.selectedId = null

        expect(editor.rowRawFilename).toBe('myRoutes.h')
    })
})

describe('RoutesEditorCustomElement.applyRowRawChange', () => {
    it('parses the header line back into the selected route and persists via updateRoute', () => {
        const { editor, state } = makeEditor([{ id: 1, description: 'Old', body: 'THROW(200)' }])
        editor.selectedId = 1

        editor.applyRowRawChange('ROUTE(1, "New desc")\nCLOSE(201)')

        expect(state.routes[0]).toMatchObject({ description: 'New desc', body: 'CLOSE(201)' })
        expect(state.syncAll).toHaveBeenCalled()
        expect(editor.rowRawSnapshot).toBe('ROUTE(1, "New desc")\nCLOSE(201)')
    })

    it('does nothing when no route is selected', () => {
        const { editor, state } = makeEditor([{ id: 1, description: '', body: '' }])
        editor.selectedId = null

        editor.applyRowRawChange('ROUTE(1, "")\nTHROW(200)')

        expect(state.syncAll).not.toHaveBeenCalled()
    })
})

describe('RoutesEditorCustomElement.flushPending', () => {
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
