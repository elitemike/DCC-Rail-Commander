import { describe, it, expect } from 'vitest'
import { deriveRouteStatus, type TurnoutLiveState } from '../../src/renderer/src/utils/routeStatus'

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

    it('ignores alias-only references, treating them as UNKNOWN', () => {
        const body = 'THROW(myAlias)\nDONE'
        const live = states([])
        expect(deriveRouteStatus(body, live)).toBe('UNKNOWN')
    })
})
