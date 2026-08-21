import { describe, it, expect, vi } from 'vitest'
import { SensorsEditorCustomElement } from '../../src/renderer/src/components/visual-editors/sensors-editor'
import type { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'

// ── Factory ───────────────────────────────────────────────────────────────────

function makeEditor(sensors: { id: number; pin: number; description: string }[], aliases: { name: string; value: string; aliasType?: string }[] = []) {
    const editor = Object.create(SensorsEditorCustomElement.prototype) as SensorsEditorCustomElement

    const state = {
        sensors,
        aliases,
        nextFreeVpin: 100,
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
            else aliases.push({ name: trimmed, value: String(nextId), aliasType: 'Sensor' })
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
        _idBeforeEdit: new Map<number, number>(),
    })

    return { editor, state, toastShow }
}

// ── setTab: raw snapshot seeding ─────────────────────────────────────────────
// rawSnapshot is only ever populated as a side effect of setTab('raw') — the
// constructor routes a 'raw' default-editor-view preference through this same
// method (rather than seeding activeTab directly) specifically so the raw
// Monaco editor doesn't open empty. This covers the seeding logic that
// guarantee depends on.

describe('SensorsEditorCustomElement.setTab', () => {
    it('seeds rawSnapshot from state.sensorsRaw when switching to raw', () => {
        const { editor, state } = makeEditor([{ id: 10, pin: 5, description: 'Block Detector' }])
        editor.activeTab = 'visual'
        ;(state as unknown as { sensorsRaw: string }).sensorsRaw = 'SENSOR(10, 5)'

        editor.setTab('raw')

        expect(editor.rawSnapshot).toBe('SENSOR(10, 5)')
        expect(editor.activeTab).toBe('raw')
    })
})

// ── updateSensor: alias follows an ID rename ─────────────────────────────────

describe('SensorsEditorCustomElement.updateSensor', () => {
    it('carries an existing alias forward when the sensor ID is renamed', () => {
        const { editor, state } = makeEditor(
            [{ id: 10, pin: 5, description: 'Block Detector' }],
            [{ name: 'BLOCK_1', value: '10', aliasType: 'Sensor' }],
        )

        editor.captureIdBeforeEdit(0)
        state.sensors[0].id = 20
        editor.updateSensor(0, state.sensors[0])

        expect(state.syncAliasForId).toHaveBeenCalledWith(10, 20, 'BLOCK_1', 'Sensor', 'BLOCK_1')
    })

    it('does not touch aliases when the ID is unchanged', () => {
        const { editor, state } = makeEditor(
            [{ id: 10, pin: 5, description: 'Block Detector' }],
            [{ name: 'BLOCK_1', value: '10', aliasType: 'Sensor' }],
        )

        editor.captureIdBeforeEdit(0)
        editor.updateSensor(0, state.sensors[0])

        expect(state.syncAliasForId).not.toHaveBeenCalled()
    })

    it('does not call syncAliasForId on rename when there was no alias to carry', () => {
        const { editor, state } = makeEditor([{ id: 10, pin: 5, description: 'Block Detector' }])

        editor.captureIdBeforeEdit(0)
        state.sensors[0].id = 20
        editor.updateSensor(0, state.sensors[0])

        expect(state.syncAliasForId).not.toHaveBeenCalled()
    })
})

// ── makeAliasChangeHandler ────────────────────────────────────────────────────

describe('SensorsEditorCustomElement.makeAliasChangeHandler', () => {
    it('persists a new alias name for the sensor at the given index', () => {
        const { editor, state } = makeEditor([{ id: 10, pin: 5, description: 'Block Detector' }])

        editor.makeAliasChangeHandler(0)('BLOCK_1')

        expect(state.syncAliasForId).toHaveBeenCalledWith(10, 10, 'BLOCK_1', 'Sensor', '')
    })

    it('shows a warning toast when the alias name conflicts', () => {
        const { editor, state, toastShow } = makeEditor([{ id: 10, pin: 5, description: 'Block Detector' }])
        ;(state.syncAliasForId as ReturnType<typeof vi.fn>).mockReturnValueOnce({ ok: false, reason: 'Alias name "BLOCK_1" is already used for a different ID. Choose a unique name.' })

        editor.makeAliasChangeHandler(0)('BLOCK_1')

        expect(toastShow).toHaveBeenCalledOnce()
        const [payload] = toastShow.mock.calls[0]
        expect(payload).toMatchObject({ title: 'Alias Error', cssClass: 'e-toast-warning' })
        expect(payload.content).toContain('BLOCK_1')
    })
})
