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

describe('validateUnknownExrailCommand', () => {
    it('flags a typo\'d macro name that is not a case variant of any known command', () => {
        const markers = _runValidatorsForTest('myRoster.h', 'Ros("")')
        expect(markers.some(m => m.message === "'Ros' is not a recognised EXRAIL command.")).toBe(true)
    })

    it('does not flag a correctly-cased command', () => {
        const markers = _runValidatorsForTest('myRoster.h', 'ROSTER(3, "Thomas", "LIGHT/HORN")')
        expect(markers.filter(m => m.message.includes('not a recognised'))).toHaveLength(0)
    })

    it('leaves genuine case-mismatches to validateExrailCommandCasing, not this validator', () => {
        // "roster" uppercases to a real command name — should get exactly the casing marker,
        // not also an "unrecognised command" one.
        const markers = _runValidatorsForTest('myRoster.h', 'roster(3, "Thomas", "LIGHT/HORN")')
        expect(markers).toHaveLength(1)
        expect(markers[0].message).toContain("should be 'ROSTER'")
    })

    it('does not flag identifiers used as arguments, only genuine command position', () => {
        const markers = _runValidatorsForTest('mySignals.h', 'SIGNAL(myRedPin, 6, 13)')
        expect(markers).toHaveLength(0)
    })

    it('does not flag unrecognised-looking words inside comments or quoted strings', () => {
        expect(_runValidatorsForTest('myRoster.h', '// Ros(1, "x", "y") — todo\nROSTER(1, "x", "y")')).toHaveLength(0)
        expect(_runValidatorsForTest('myRoster.h', 'ROSTER(1, "Ros(200)", "y")')).toHaveLength(0)
    })

    it('flags an unrecognised macro across every closed-vocabulary file', () => {
        expect(_runValidatorsForTest('myTurnouts.h', 'MADE_UP_TURNOUT(1, 25, "x")')
            .some(m => m.message.includes('not a recognised'))).toBe(true)
        expect(_runValidatorsForTest('mySensors.h', 'SENSER(1, 17, "x")')
            .some(m => m.message.includes('not a recognised'))).toBe(true)
        expect(_runValidatorsForTest('mySignals.h', 'SIGNALS(5, 6, 13)')
            .some(m => m.message.includes('not a recognised'))).toBe(true)
        expect(_runValidatorsForTest('myAliases.h', 'ALIASS(FOO, 1)')
            .some(m => m.message.includes('not a recognised'))).toBe(true)
    })

    it('also runs on EXRAIL script files — EXRAIL is a closed macro DSL, a stray function call cannot compile there either', () => {
        expect(_runValidatorsForTest('myAutomation.h', 'myCustomFunction(200)')
            .some(m => m.message.includes('not a recognised'))).toBe(true)
        expect(_runValidatorsForTest('myRoutes.h', 'ROUTE(1, "Test")\n  myCustomFunction(200)\nDONE')
            .some(m => m.message.includes('not a recognised'))).toBe(true)
        expect(_runValidatorsForTest('mySequences.h', 'SEQUENCE(1)\n  myCustomFunction(200)\nDONE')
            .some(m => m.message.includes('not a recognised'))).toBe(true)
        expect(_runValidatorsForTest('myEvents.h', 'ONSENSOR(1)\n  myCustomFunction(200)\nDONE')
            .some(m => m.message.includes('not a recognised'))).toBe(true)
        expect(_runValidatorsForTest('myStartup.h', 'AUTOSTART\n  myCustomFunction(200)\nDONE')
            .some(m => m.message.includes('not a recognised'))).toBe(true)
    })

    it('does not flag valid EXRAIL commands in a script file, only genuinely unknown ones', () => {
        const markers = _runValidatorsForTest('myAutomation.h', 'ROUTE(1, "Test")\n  THROW(200)\n  DELAY(500)\nDONE')
        expect(markers.filter(m => m.message.includes('not a recognised'))).toHaveLength(0)
    })
})
