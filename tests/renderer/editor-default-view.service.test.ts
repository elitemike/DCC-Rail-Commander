import { describe, it, expect, vi } from 'vitest'
import { EditorDefaultViewService } from '../../src/renderer/src/services/editor-default-view.service'

// ── Factory ───────────────────────────────────────────────────────────────────
// Built like tests/renderer/turnout-editor.test.ts: a bare prototype instance
// with fields assigned manually, avoiding a full Aurelia DI bootstrap (this
// service's only field is a resolve()'d PreferencesService).

function makeService(stored?: 'visual' | 'raw') {
    const service = Object.create(EditorDefaultViewService.prototype) as EditorDefaultViewService

    const getFn = vi.fn().mockResolvedValue(stored)
    const setFn = vi.fn().mockResolvedValue(undefined)

    Object.assign(service, {
        preferences: { get: getFn, set: setFn },
        value: 'visual',
    })

    return { service, getFn, setFn }
}

describe('EditorDefaultViewService.init', () => {
    it('defaults to visual when no preference is stored', async () => {
        const { service, getFn } = makeService(undefined)

        await service.init()

        expect(getFn).toHaveBeenCalledWith('defaultEditorView')
        expect(service.value).toBe('visual')
    })

    it('loads a persisted raw preference', async () => {
        const { service } = makeService('raw')

        await service.init()

        expect(service.value).toBe('raw')
    })
})

describe('EditorDefaultViewService.setValue', () => {
    it('updates value and persists it under the defaultEditorView key', async () => {
        const { service, setFn } = makeService()

        await service.setValue('raw')

        expect(service.value).toBe('raw')
        expect(setFn).toHaveBeenCalledWith('defaultEditorView', 'raw')
    })
})
