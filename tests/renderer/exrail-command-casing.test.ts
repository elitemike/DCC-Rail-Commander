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

describe('validateExrailCommandCasing', () => {
    it('produces no marker for correctly-cased commands', () => {
        expect(_runValidatorsForTest('myAutomation.h', 'THROW(200)')).toHaveLength(0)
        expect(_runValidatorsForTest('myAutomation.h', 'CLOSE(200)')).toHaveLength(0)
        expect(_runValidatorsForTest('myAutomation.h', 'DONE')).toHaveLength(0)
    })

    it('flags a lowercase command call', () => {
        const markers = _runValidatorsForTest('myAutomation.h', 'throw(200)')
        expect(markers).toHaveLength(1)
        expect(markers[0].message).toContain("'throw' should be 'THROW'")
    })

    it('flags a mixed-case command call', () => {
        const markers = _runValidatorsForTest('myAutomation.h', 'Close(200)')
        expect(markers).toHaveLength(1)
        expect(markers[0].message).toContain("'Close' should be 'CLOSE'")
    })

    it('flags a miscased bare (paren-less) keyword on its own line', () => {
        const markers = _runValidatorsForTest('myAutomation.h', 'ROUTE(1, "Test")\n  Throw(200)\ndone\nDONE')
        // Throw(200) and the bare "done" line should both be flagged.
        expect(markers.map(m => m.message)).toEqual([
            "EXRAIL commands are case-sensitive — 'Throw' should be 'THROW'.",
            "EXRAIL commands are case-sensitive — 'done' should be 'DONE'.",
        ])
    })

    it('does not flag identifiers/aliases used as arguments even if they collide in case', () => {
        // "close" here is an argument to SETLOCO, not a command invocation.
        const markers = _runValidatorsForTest('myAutomation.h', 'SETLOCO(close)')
        expect(markers).toHaveLength(0)
    })

    it('does not flag command-like words inside comments', () => {
        const markers = _runValidatorsForTest('myAutomation.h', '// remember to throw(200) later\nTHROW(200)')
        expect(markers).toHaveLength(0)
    })

    it('does not flag command-like words inside quoted strings', () => {
        const markers = _runValidatorsForTest('myAutomation.h', 'PRINT("please throw(200) now")')
        expect(markers).toHaveLength(0)
    })

    it('works for myRoutes.h and mySequences.h block starters', () => {
        expect(_runValidatorsForTest('myRoutes.h', 'route(1, "Test")\nDONE')[0].message)
            .toContain("'route' should be 'ROUTE'")
        expect(_runValidatorsForTest('mySequences.h', 'sequence(1)\nDONE')[0].message)
            .toContain("'sequence' should be 'SEQUENCE'")
    })

    it('does not run for files with no defined command vocabulary (e.g. config.h)', () => {
        expect(_runValidatorsForTest('config.h', 'throw(200)')).toHaveLength(0)
    })

    it('does not flag words that are not EXRAIL commands at all', () => {
        expect(_runValidatorsForTest('myAutomation.h', 'myCustomFunction(200)')).toHaveLength(0)
    })
})

describe('validateExrailCommandCasing — ROSTER / TURNOUT / SENSOR / SIGNAL files', () => {
    it('flags a lowercase ROSTER call in myRoster.h', () => {
        const markers = _runValidatorsForTest('myRoster.h', 'roster(3, "Thomas", "LIGHT/HORN")')
        expect(markers.some(m => m.message.includes("'roster' should be 'ROSTER'"))).toBe(true)
    })

    it('produces no casing marker for a correctly-cased ROSTER call', () => {
        const markers = _runValidatorsForTest('myRoster.h', 'ROSTER(3, "Thomas", "LIGHT/HORN")')
        expect(markers.filter(m => m.message.includes('case-sensitive'))).toHaveLength(0)
    })

    it('flags lowercase/mixed-case turnout macros in myTurnouts.h', () => {
        expect(
            _runValidatorsForTest('myTurnouts.h', 'servo_turnout(200, 25, 410, 205, Slow, "Main Line")')
                .some(m => m.message.includes("'servo_turnout' should be 'SERVO_TURNOUT'")),
        ).toBe(true)
        expect(
            _runValidatorsForTest('myTurnouts.h', 'Turnout(1, 100, 0, "Yard Exit")')
                .some(m => m.message.includes("'Turnout' should be 'TURNOUT'")),
        ).toBe(true)
        expect(
            _runValidatorsForTest('myTurnouts.h', 'pin_turnout(2, 22, "Siding")')
                .some(m => m.message.includes("'pin_turnout' should be 'PIN_TURNOUT'")),
        ).toBe(true)
    })

    it('does not flag TURNOUT as a false match inside SERVO_TURNOUT/PIN_TURNOUT when correctly cased', () => {
        const markers = _runValidatorsForTest(
            'myTurnouts.h',
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main")\nPIN_TURNOUT(2, 22, "Siding")\nTURNOUT(1, 100, 0, "Yard")',
        )
        expect(markers.filter(m => m.message.includes('case-sensitive'))).toHaveLength(0)
    })

    it('flags a lowercase SENSOR call in mySensors.h', () => {
        const markers = _runValidatorsForTest('mySensors.h', 'sensor(1, 17, "Yard Entrance")')
        expect(markers.some(m => m.message.includes("'sensor' should be 'SENSOR'"))).toBe(true)
    })

    it('flags a lowercase SIGNAL call in mySignals.h', () => {
        const markers = _runValidatorsForTest('mySignals.h', 'signal(5, 6, 13)')
        expect(markers.some(m => m.message.includes("'signal' should be 'SIGNAL'"))).toBe(true)
    })
})
