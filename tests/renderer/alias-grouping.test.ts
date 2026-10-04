import { describe, it, expect } from 'vitest'
import { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'
import type { AliasEntry } from '../../src/renderer/src/utils/myAutomationParser'

function makeState(order: 'name' | 'id', aliases: AliasEntry[]): ConfigEditorState {
    const state = Object.create(ConfigEditorState.prototype) as ConfigEditorState
    // `aliases` is an @observable accessor on the prototype, so plain assignment fails on a bare instance.
    const fields: Record<string, unknown> = {
        aliases,
        aliasSortOrder: { value: order },
        installerState: { appVersion: '0.0.0' },
        roster: [], turnouts: [], sensors: [], routes: [], sequences: [],
    }
    for (const [key, value] of Object.entries(fields)) {
        Object.defineProperty(state, key, { value, configurable: true })
    }
    return state
}

const ALIASES: AliasEntry[] = [
    { name: 'YARD', value: '20', aliasType: 'Turnout' },
    { name: 'MAIN', value: '3', aliasType: 'Turnout' },
    { name: 'BOB', value: '1234', aliasType: 'Roster' },
    { name: 'ALPHA', value: '9', aliasType: 'Roster' },
]

describe('ConfigEditorState.groupedAliases', () => {
    it('groups by type and sorts by name within each group', () => {
        const groups = makeState('name', ALIASES).groupedAliases
        expect(groups.map(g => g.label)).toEqual(['Roster', 'Turnout'])
        expect(groups[0].items.map(i => i.alias.name)).toEqual(['ALPHA', 'BOB'])
        expect(groups[1].items.map(i => i.alias.name)).toEqual(['MAIN', 'YARD'])
    })

    it('sorts by numeric ID within each group', () => {
        const groups = makeState('id', ALIASES).groupedAliases
        expect(groups[0].items.map(i => i.alias.name)).toEqual(['ALPHA', 'BOB'])
        expect(groups[1].items.map(i => i.alias.name)).toEqual(['MAIN', 'YARD'])
        const flipped = makeState('id', [
            { name: 'A', value: '50', aliasType: 'Sensor' },
            { name: 'B', value: '5', aliasType: 'Sensor' },
        ]).groupedAliases
        expect(flipped[0].items.map(i => i.alias.name)).toEqual(['B', 'A'])
    })

    it('writes the raw file grouped by type with a comment header per group', () => {
        const raw = makeState('name', ALIASES).aliasesRaw
        expect(raw).toContain('// Roster\nALIAS(ALPHA, 9) // type: Roster\nALIAS(BOB, 1234) // type: Roster\n\n// Turnout\nALIAS(MAIN, 3)')
    })
})
