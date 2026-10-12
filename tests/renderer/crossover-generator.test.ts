import { describe, expect, it } from 'vitest'
import { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'
import { buildCrossover, validateCrossover } from '../../src/renderer/src/utils/new-object-generators/crossover'
import {
    parseEventHandlersFromFile,
    serializeEventHandlersToFile,
    type AliasEntry,
    type Turnout,
} from '../../src/renderer/src/utils/myAutomationParser'

const members = [
    { id: 1, ref: 1 as string | number },
    { id: 2, ref: 'XOVER_B' as string | number },
]

describe('buildCrossover', () => {
    it('builds a closed virtual turnout and ONTHROW/ONCLOSE handlers using each member ref', () => {
        const { turnout, handlers } = buildCrossover({ masterId: 10, masterName: 'Yard', masterRef: 'YARD', members })
        expect(turnout).toEqual({ type: 'VIRTUAL', id: 10, description: 'Yard', defaultState: 'CLOSED' })
        expect(handlers.map(h => h.text)).toEqual([
            'ONTHROW(YARD)\nTHROW(1)\nTHROW(XOVER_B)\nDONE',
            'ONCLOSE(YARD)\nCLOSE(1)\nCLOSE(XOVER_B)\nDONE',
        ])
    })

    it('round-trips through the myEvents.h serializer/parser', () => {
        const { handlers } = buildCrossover({ masterId: 10, masterName: 'Yard', masterRef: 10, members })
        const parsed = parseEventHandlersFromFile(serializeEventHandlersToFile(handlers))
        expect(parsed.map(h => h.command)).toEqual(['ONTHROW', 'ONCLOSE'])
        expect(parsed.map(h => h.text)).toEqual(handlers.map(h => h.text))
    })
})

describe('validateCrossover', () => {
    const opts = { masterId: 10, masterName: 'x', masterRef: 10, members }
    it('accepts valid input', () => expect(validateCrossover(opts, [1, 2])).toBeNull())
    it('rejects an id already in use', () => expect(validateCrossover(opts, [1, 2, 10])).toMatch(/already in use/))
    it('requires at least two members', () =>
        expect(validateCrossover({ ...opts, members: [members[0]] }, [1])).toMatch(/at least 2/))
    it('rejects the master being its own member', () =>
        expect(validateCrossover({ ...opts, masterId: 1 }, [2])).toMatch(/own members/))
    it('rejects duplicate members', () =>
        expect(validateCrossover({ ...opts, members: [members[0], members[0]] }, [1])).toMatch(/at least 2/))
})

function makeState(strictAliases: boolean): ConfigEditorState {
    const state = Object.create(ConfigEditorState.prototype) as any
    const turnout = (id: number): Turnout => ({ type: 'PIN', id, pin: id, description: `T${id}`, defaultState: 'CLOSED' })
    // turnouts/eventHandlers/aliases are @observable accessors on the prototype, so a bare instance
    // can't take plain assignment — shadow them with writable own properties instead.
    const fields: Record<string, unknown> = {
        turnouts: [turnout(1), turnout(2)],
        eventHandlers: [],
        aliases: [{ name: 'XOVER_B', value: '2', aliasType: 'Turnout' }] satisfies AliasEntry[],
        strictAliases,
        hasChanges: false,
        _syncGeneratedTurnoutDefaultsContent: () => {},
        _syncToInstallerState: () => {},
        getObjectIdReferences: (id: number) =>
            state.turnouts.filter((t: Turnout) => t.id === id).map(() => ({ type: 'Turnout' })),
    }
    for (const [key, value] of Object.entries(fields)) {
        Object.defineProperty(state, key, { value, writable: true, configurable: true })
    }
    return state as ConfigEditorState
}

describe('ConfigEditorState.createCrossover', () => {
    it('adds the master, alias and handlers, and hides members', () => {
        const state = makeState(true)
        const result = state.createCrossover({
            masterId: 10,
            masterName: 'Yard',
            masterAlias: 'YARD',
            memberIds: [1, 2],
            hideMembers: true,
        })
        expect(result).toEqual({ ok: true })
        expect(state.turnouts.map(t => [t.id, t.description])).toEqual([[1, 'HIDDEN'], [2, 'HIDDEN'], [10, 'Yard']])
        expect(state.aliases.some(a => a.name === 'YARD' && a.value === '10')).toBe(true)
        expect(state.eventHandlers.map(h => h.text)).toEqual([
            'ONTHROW(YARD)\nTHROW(1)\nTHROW(XOVER_B)\nDONE',
            'ONCLOSE(YARD)\nCLOSE(1)\nCLOSE(XOVER_B)\nDONE',
        ])
    })

    it('leaves member descriptions alone when hideMembers is false', () => {
        const state = makeState(false)
        state.createCrossover({ masterId: 10, masterName: 'Yard', masterAlias: '', memberIds: [1, 2], hideMembers: false })
        expect(state.turnouts.slice(0, 2).map(t => t.description)).toEqual(['T1', 'T2'])
        expect(state.eventHandlers[0].text.startsWith('ONTHROW(10)')).toBe(true)
    })

    it('requires an alias under strict aliases and mutates nothing on failure', () => {
        const state = makeState(true)
        const result = state.createCrossover({ masterId: 10, masterName: 'Yard', masterAlias: '', memberIds: [1, 2], hideMembers: true })
        expect(result.ok).toBe(false)
        expect(state.turnouts).toHaveLength(2)
        expect(state.eventHandlers).toHaveLength(0)
    })

    it('rolls back the new turnout when the alias is rejected', () => {
        const state = makeState(true)
        const result = state.createCrossover({ masterId: 10, masterName: 'Yard', masterAlias: 'THROW', memberIds: [1, 2], hideMembers: true })
        expect(result.ok).toBe(false)
        expect(state.turnouts.map(t => t.id)).toEqual([1, 2])
        expect(state.eventHandlers).toHaveLength(0)
    })
})
