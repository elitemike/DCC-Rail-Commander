import { describe, expect, it } from 'vitest'

import { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'
import type { RouteEntry, SequenceEntry, AutomationEntry } from '../../src/renderer/src/utils/myAutomationParser'

/**
 * Builds a minimal state stub with `routes`/`sequences`/`automations` as plain own properties
 * (mirroring config-editor-state-alias-sync.test.ts's approach — these are `@observable` on the
 * real class, and Aurelia's generated prototype setter for those rejects assignment on an object
 * that wasn't constructed through DI, so a plain object literal is used instead of
 * `Object.create(ConfigEditorState.prototype)`). The `sequenceIdEntries`/`nextSequenceId` getters
 * and `getSequenceIdViolations()` are copied over individually from the real prototype so `this`
 * inside them resolves against the stub's own properties.
 */
function makeState(fields: {
    routes?: RouteEntry[]
    sequences?: SequenceEntry[]
    automations?: AutomationEntry[]
}): ConfigEditorState {
    const state = {
        routes: fields.routes ?? [],
        sequences: fields.sequences ?? [],
        automations: fields.automations ?? [],
    } as unknown as ConfigEditorState

    for (const prop of ['sequenceIdEntries', 'nextSequenceId'] as const) {
        Object.defineProperty(state, prop, Object.getOwnPropertyDescriptor(ConfigEditorState.prototype, prop)!)
    }
    state.getSequenceIdViolations = ConfigEditorState.prototype.getSequenceIdViolations.bind(state)

    return state
}

describe('ConfigEditorState.sequenceIdEntries', () => {
    it('combines routes, automations, and sequences into one tagged list', () => {
        const state = makeState({
            routes: [{ id: 1, description: 'R', body: '' }],
            sequences: [{ id: 3, description: '', body: '' }],
            automations: [{ id: 2, description: 'A', body: '' }],
        })

        expect(state.sequenceIdEntries).toEqual([
            { kind: 'Route', id: 1 },
            { kind: 'Automation', id: 2 },
            { kind: 'Sequence', id: 3 },
        ])
    })
})

describe('ConfigEditorState.getSequenceIdViolations', () => {
    it('flags a collision between a route and a sequence sharing an id', () => {
        const state = makeState({
            routes: [{ id: 5, description: 'R', body: '' }],
            sequences: [{ id: 5, description: '', body: '' }],
        })

        const violations = state.getSequenceIdViolations()
        expect(violations).toHaveLength(2)
        expect(violations.map((v) => v.kind).sort()).toEqual(['Route', 'Sequence'])
    })

    it('returns no violations for a clean, non-colliding set', () => {
        const state = makeState({
            routes: [{ id: 1, description: 'R', body: '' }],
            sequences: [{ id: 2, description: '', body: '' }],
            automations: [{ id: 3, description: 'A', body: '' }],
        })

        expect(state.getSequenceIdViolations()).toEqual([])
    })
})

describe('ConfigEditorState.nextSequenceId', () => {
    it('starts at 1 when nothing is configured yet — never suggests the reserved id 0', () => {
        const state = makeState({})
        expect(state.nextSequenceId).toBe(1)
    })

    it('skips ids already used by routes, sequences, and automations alike', () => {
        const state = makeState({
            routes: [{ id: 1, description: '', body: '' }],
            sequences: [{ id: 2, description: '', body: '' }],
            automations: [{ id: 3, description: 'A', body: '' }],
        })
        expect(state.nextSequenceId).toBe(4)
    })

    it('fills the first gap rather than always appending after the highest id', () => {
        const state = makeState({
            routes: [{ id: 1, description: '', body: '' }, { id: 3, description: '', body: '' }],
        })
        expect(state.nextSequenceId).toBe(2)
    })
})
