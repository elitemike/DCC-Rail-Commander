import { describe, it, expect } from 'vitest'
import { deriveRouteStatus, parseRouteTurnoutCommands, type TurnoutLiveState } from '../../src/renderer/src/utils/routeStatus'

function states(entries: Array<[number, TurnoutLiveState]>): Map<number, TurnoutLiveState> {
    return new Map(entries)
}

describe('deriveRouteStatus', () => {
    it('is MATCHED when every referenced turnout is live and matches', () => {
        const body = 'THROW(5)\nCLOSE(6)\nDONE'
        const live = states([
            [5, 'THROWN'],
            [6, 'CLOSED'],
        ])
        expect(deriveRouteStatus(body, live)).toBe('MATCHED')
    })

    it('is MISMATCHED when a referenced turnout is live but in the wrong state', () => {
        const body = 'THROW(5)\nDONE'
        const live = states([[5, 'CLOSED']])
        expect(deriveRouteStatus(body, live)).toBe('MISMATCHED')
    })

    it('is UNKNOWN when a referenced turnout has never been seen live', () => {
        const body = 'THROW(5)\nDONE'
        const live = states([])
        expect(deriveRouteStatus(body, live)).toBe('UNKNOWN')
    })

    it('is UNKNOWN when the body has no numeric THROW/CLOSE calls', () => {
        const body = 'SPEED(20)\nDONE'
        const live = states([[5, 'THROWN']])
        expect(deriveRouteStatus(body, live)).toBe('UNKNOWN')
    })

    it('is UNKNOWN when mixing a matched turnout with an unseen one (no mismatch present)', () => {
        const body = 'THROW(5)\nCLOSE(6)\nDONE'
        const live = states([[5, 'THROWN']])
        expect(deriveRouteStatus(body, live)).toBe('UNKNOWN')
    })

    it('is MISMATCHED when a mismatch is present alongside unseen turnouts', () => {
        const body = 'THROW(5)\nCLOSE(6)\nDONE'
        const live = states([[5, 'CLOSED']])
        expect(deriveRouteStatus(body, live)).toBe('MISMATCHED')
    })

    it('ignores alias-only references when no resolver is given, treating them as UNKNOWN', () => {
        const body = 'THROW(myAlias)\nDONE'
        const live = states([])
        expect(deriveRouteStatus(body, live)).toBe('UNKNOWN')
    })
})

describe('deriveRouteStatus — alias resolution', () => {
    const resolve = (name: string): number | undefined => (name === 'myAlias' ? 5 : undefined)

    it('resolves an alias to its turnout id when a resolver is given', () => {
        const body = 'THROW(myAlias)\nDONE'
        const live = states([[5, 'THROWN']])
        expect(deriveRouteStatus(body, live, resolve)).toBe('MATCHED')
    })

    it('is MISMATCHED when a resolved alias turnout is live but in the wrong state', () => {
        const body = 'THROW(myAlias)\nDONE'
        const live = states([[5, 'CLOSED']])
        expect(deriveRouteStatus(body, live, resolve)).toBe('MISMATCHED')
    })

    it('mixes alias and numeric references in the same route', () => {
        const body = 'THROW(myAlias)\nCLOSE(6)\nDONE'
        const live = states([
            [5, 'THROWN'],
            [6, 'CLOSED'],
        ])
        expect(deriveRouteStatus(body, live, resolve)).toBe('MATCHED')
    })

    it('is UNKNOWN when the resolver cannot resolve the alias name', () => {
        const body = 'THROW(unknownAlias)\nDONE'
        const live = states([])
        expect(deriveRouteStatus(body, live, resolve)).toBe('UNKNOWN')
    })
})

describe('parseRouteTurnoutCommands — alias resolution', () => {
    const resolve = (name: string): number | undefined => (name === 'myAlias' ? 5 : undefined)

    it('resolves alias tokens via the given resolver, preserving order alongside numeric tokens', () => {
        const body = 'THROW(myAlias)\nCLOSE(6)\nDONE'
        expect(parseRouteTurnoutCommands(body, resolve)).toEqual([
            { id: 5, state: 'THROWN' },
            { id: 6, state: 'CLOSED' },
        ])
    })

    it('skips an alias token when no resolver is given', () => {
        const body = 'THROW(myAlias)\nCLOSE(6)\nDONE'
        expect(parseRouteTurnoutCommands(body)).toEqual([{ id: 6, state: 'CLOSED' }])
    })

    it('skips an alias token the resolver cannot resolve', () => {
        const body = 'THROW(unknownAlias)\nDONE'
        expect(parseRouteTurnoutCommands(body, resolve)).toEqual([])
    })
})
