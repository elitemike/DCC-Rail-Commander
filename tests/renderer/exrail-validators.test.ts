import { describe, it, expect, vi } from 'vitest'

// Minimal Monaco mock — only the constants the validators actually use.
vi.mock('monaco-editor', () => ({
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: {
        setModelMarkers: vi.fn(),
        getModels: () => [],
        onDidCreateModel: vi.fn(),
    },
}))

import { _runValidatorsForTest } from '../../src/renderer/src/config/dccex-validators'
import type { ExrailCompletionData } from '../../src/renderer/src/utils/exrail-completions'

const DATA: ExrailCompletionData = {
    roster: [{ dccAddress: 3, name: 'Thomas', functions: [], comment: '' }],
    turnouts: [{ id: 200, description: 'Main Junction', defaultState: 'CLOSED', type: 'DCC', addr: 1, subAddr: 0 }],
    sensors: [{ id: 30, pin: 2, description: 'Occupancy' }],
    routes: [{ id: 1, description: 'Main to Siding', body: '' }],
    sequences: [{ id: 5, body: '' }],
    aliases: [{ name: 'MAIN_JUNCTION', value: '200', aliasType: 'Turnout' }],
}

describe('validateExrailReferences — THROW/CLOSE turnout arguments', () => {
    it('produces no marker for a configured turnout ID', () => {
        const markers = _runValidatorsForTest('myAutomation.h', 'THROW(200)', DATA)
        expect(markers).toHaveLength(0)
    })

    it('produces no marker for a turnout alias', () => {
        const markers = _runValidatorsForTest('myAutomation.h', 'CLOSE(MAIN_JUNCTION)', DATA)
        expect(markers).toHaveLength(0)
    })

    it('flags a turnout ID that is not configured', () => {
        const markers = _runValidatorsForTest('myAutomation.h', 'THROW(999)', DATA)
        expect(markers).toHaveLength(1)
        expect(markers[0].message).toContain("'999' is not a configured Turnout ID or alias")
    })

    it('flags an alias that exists but is the wrong type', () => {
        const data: ExrailCompletionData = {
            ...DATA,
            aliases: [{ name: 'MY_SENSOR', value: '30', aliasType: 'Sensor' }],
        }
        const markers = _runValidatorsForTest('myAutomation.h', 'THROW(MY_SENSOR)', data)
        expect(markers).toHaveLength(1)
        expect(markers[0].message).toContain('MY_SENSOR')
    })

    it('flags an alias name that does not exist at all', () => {
        const markers = _runValidatorsForTest('myAutomation.h', 'CLOSE(NOT_DEFINED)', DATA)
        expect(markers).toHaveLength(1)
    })

    it('does not run without exrailData supplied (backward compatible no-op)', () => {
        const markers = _runValidatorsForTest('myAutomation.h', 'THROW(999)')
        expect(markers).toHaveLength(0)
    })

    it('does not validate THROW/CLOSE outside EXRAIL files', () => {
        const markers = _runValidatorsForTest('config.h', 'THROW(999)', DATA)
        expect(markers).toHaveLength(0)
    })
})

describe('validateExrailReferences — other reference-taking commands', () => {
    it('validates AT/IF sensor references', () => {
        expect(_runValidatorsForTest('myAutomation.h', 'AT(30)', DATA)).toHaveLength(0)
        expect(_runValidatorsForTest('myAutomation.h', 'AT(999)', DATA)).toHaveLength(1)
    })

    it('validates SETLOCO roster references', () => {
        expect(_runValidatorsForTest('myAutomation.h', 'SETLOCO(3)', DATA)).toHaveLength(0)
        expect(_runValidatorsForTest('myAutomation.h', 'SETLOCO(4)', DATA)).toHaveLength(1)
    })

    it('validates START/FOLLOW route-or-sequence references', () => {
        expect(_runValidatorsForTest('myAutomation.h', 'START(1)', DATA)).toHaveLength(0)
        expect(_runValidatorsForTest('myAutomation.h', 'FOLLOW(5)', DATA)).toHaveLength(0)
        expect(_runValidatorsForTest('myAutomation.h', 'START(999)', DATA)).toHaveLength(1)
    })

    it('works inside myRoutes.h and mySequences.h too', () => {
        expect(_runValidatorsForTest('myRoutes.h', 'ROUTE(1, "Test")\nTHROW(999)\nDONE', DATA)).toHaveLength(1)
        expect(_runValidatorsForTest('mySequences.h', 'SEQUENCE(1)\nCLOSE(999)\nDONE', DATA)).toHaveLength(1)
    })

    it('ignores unrelated macro calls', () => {
        expect(_runValidatorsForTest('myAutomation.h', 'DELAY(500)', DATA)).toHaveLength(0)
    })
})

describe('ALIAS validator (myAliases.h)', () => {
    it('produces no marker for a valid ALIAS with a value', () => {
        expect(_runValidatorsForTest('myAliases.h', 'ALIAS(YARD_SWITCH, 200)')).toHaveLength(0)
    })

    it('flags an ALIAS missing its required value', () => {
        const markers = _runValidatorsForTest('myAliases.h', 'ALIAS(YARD_SWITCH)')
        expect(markers.length).toBeGreaterThanOrEqual(1)
        expect(markers[0].message).toContain('requires a value')
    })

    it('flags a name that does not start with a letter or underscore', () => {
        const markers = _runValidatorsForTest('myAliases.h', 'ALIAS(1SWITCH, 200)')
        expect(markers.length).toBeGreaterThanOrEqual(1)
        expect(markers[0].message).toContain('1SWITCH')
    })

    it('flags a name matching a reserved EXRAIL command', () => {
        const markers = _runValidatorsForTest('myAliases.h', 'ALIAS(THROW, 200)')
        expect(markers.length).toBeGreaterThanOrEqual(1)
        expect(markers[0].message).toContain('reserved')
    })

    it('flags a value with a leading zero (interpreted as octal by C)', () => {
        const markers = _runValidatorsForTest('myAliases.h', 'ALIAS(YARD_SWITCH, 010)')
        expect(markers.length).toBeGreaterThanOrEqual(1)
        expect(markers[0].message).toContain('octal')
    })

    it('flags a duplicate alias name defined more than once', () => {
        const markers = _runValidatorsForTest('myAliases.h', 'ALIAS(YARD_SWITCH, 200)\nALIAS(YARD_SWITCH, 300)')
        expect(markers.some(m => m.message.includes('defined more than once'))).toBe(true)
    })

    it('flags the wrong number of arguments', () => {
        const markers = _runValidatorsForTest('myAliases.h', 'ALIAS(A, 1, 2)')
        expect(markers.length).toBeGreaterThanOrEqual(1)
        expect(markers[0].message).toContain('expects 1 or 2 arguments')
    })
})
