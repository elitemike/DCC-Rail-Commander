import { describe, it, expect, vi } from 'vitest'
import { RoutesEditorCustomElement } from '../../src/renderer/src/components/visual-editors/routes-editor'
import type { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'

// ── Factory ───────────────────────────────────────────────────────────────────

function makeEditor(routes: { id: number; description?: string; body?: string }[], aliases: { name: string; value: string; aliasType?: string }[] = []) {
    const editor = Object.create(RoutesEditorCustomElement.prototype) as RoutesEditorCustomElement

    const state = {
        routes,
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
            else aliases.push({ name: trimmed, value: String(nextId), aliasType: 'Route' })
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

describe('RoutesEditorCustomElement.setTab', () => {
    it('seeds rawSnapshot from state.routesRaw when switching to raw', () => {
        const { editor, state } = makeEditor([{ id: 7, description: 'Main to Yard' }])
        editor.activeTab = 'visual'
        ;(state as unknown as { routesRaw: string }).routesRaw = 'ROUTE(7, "Main to Yard")\nDONE'

        editor.setTab('raw')

        expect(editor.rawSnapshot).toBe('ROUTE(7, "Main to Yard")\nDONE')
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

describe('RoutesEditorCustomElement._applyDefaultViewIfUnset', () => {
    it('applies the current default-editor-view preference when the user has not chosen a tab', () => {
        const { editor, state } = makeEditor([{ id: 7, description: 'Main to Yard' }])
        editor.activeTab = 'visual'
        ;(editor as unknown as { editorDefaultView: { value: string } }).editorDefaultView = { value: 'raw' }
        ;(state as unknown as { routesRaw: string }).routesRaw = 'ROUTE(7, "Main to Yard")\nDONE'

        ;(editor as unknown as { _applyDefaultViewIfUnset(): void })._applyDefaultViewIfUnset()

        expect(editor.activeTab).toBe('raw')
        expect(editor.rawSnapshot).toBe('ROUTE(7, "Main to Yard")\nDONE')
    })

    it('does not override a tab the user already picked for this file', () => {
        const { editor } = makeEditor([])
        editor.setTab('visual')
        ;(editor as unknown as { editorDefaultView: { value: string } }).editorDefaultView = { value: 'raw' }

        ;(editor as unknown as { _applyDefaultViewIfUnset(): void })._applyDefaultViewIfUnset()

        expect(editor.activeTab).toBe('visual')
    })
})

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

describe('RoutesEditorCustomElement.updateRoute (id rename)', () => {
    it('carries the alias forward and updates selectedId when the ID is edited', () => {
        const { editor, state } = makeEditor(
            [{ id: 1, description: 'Old', body: '' }],
            [{ name: 'mysiding', value: '1', aliasType: 'Route' }],
        )
        editor.selectedId = 1

        editor.updateRoute(0, { ...state.routes[0], id: 5 })

        expect(editor.selectedId).toBe(5)
        expect(state.syncAliasForId).toHaveBeenCalledWith(1, 5, 'mysiding', 'Route', 'mysiding')
        expect(state.aliases[0]).toMatchObject({ name: 'mysiding', value: '5' })
    })

    it('does not touch aliases when the ID is unchanged', () => {
        const { editor, state } = makeEditor([{ id: 1, description: 'Old', body: '' }])
        editor.selectedId = 1

        editor.updateRoute(0, { ...state.routes[0], description: 'New desc' })

        expect(state.syncAliasForId).not.toHaveBeenCalled()
    })

    it('warns via toast when the new ID collides with the shared ROUTE/AUTOMATION/SEQUENCE namespace', () => {
        const { editor, state, toastShow } = makeEditor([{ id: 1, description: 'Old', body: '' }])
        ;(state.getSequenceIdViolations as any).mockReturnValue([{ kind: 'Route', id: 5, reason: 'ID 5 is already used by Sequence 5.' }])
        editor.selectedId = 1

        editor.updateRoute(0, { ...state.routes[0], id: 5 })

        expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ title: 'Route ID Warning' }))
    })
})

describe('RoutesEditorCustomElement.makeIdChangeHandler', () => {
    it('looks the route up by the id captured at bind time and persists the new id', () => {
        const { editor, state } = makeEditor([{ id: 1, description: 'Old', body: '' }])
        editor.selectedId = 1

        editor.makeIdChangeHandler(1)(5)

        expect(state.routes[0]).toMatchObject({ id: 5 })
        expect(editor.selectedId).toBe(5)
    })

    it('does nothing when the captured id no longer matches any route', () => {
        const { editor, state } = makeEditor([{ id: 1, description: 'Old', body: '' }])

        editor.makeIdChangeHandler(99)(5)

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
