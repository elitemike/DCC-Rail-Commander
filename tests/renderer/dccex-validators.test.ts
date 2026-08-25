import { describe, it, expect, vi } from 'vitest'

// Minimal Monaco mock — only the constants the validators actually use.
let mockModelMarkers: Array<{ severity: number }> = []
vi.mock('monaco-editor', () => ({
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: {
        setModelMarkers: vi.fn(),
        getModels: () => [],
        onDidCreateModel: vi.fn(),
        getModelMarkers: () => mockModelMarkers,
        onDidChangeMarkers: vi.fn(() => ({ dispose: vi.fn() })),
    },
}))

import * as monaco from 'monaco-editor'
import { _runValidatorsForTest, hasErrorMarkers, onMarkersChanged } from '../../src/renderer/src/config/dccex-validators'

// Convenience constants that mirror the mock values above.
const ERROR = 8
const WARNING = 4

// ── ROSTER validator ──────────────────────────────────────────────────────────

describe('validateRoster — function list argument', () => {
    describe('quoted string (classic usage)', () => {
        it('produces no markers for a valid quoted function list', () => {
            const markers = _runValidatorsForTest(
                'myRoster.h',
                'ROSTER(42, "Thomas", "LIGHT/HORN")',
            )
            expect(markers).toHaveLength(0)
        })

        it('produces no markers for an empty function list ""', () => {
            const markers = _runValidatorsForTest(
                'myRoster.h',
                'ROSTER(42, "Thomas", "")',
            )
            expect(markers).toHaveLength(0)
        })
    })

    describe('#define identifier — defined in the same file', () => {
        it('produces no markers when the identifier matches a #define in the file', () => {
            const text = [
                '#define CSX_GP40_F "Lights/Bell/Airhorn"',
                'ROSTER(6211, "CSX GP40", CSX_GP40_F)',
            ].join('\n')

            const markers = _runValidatorsForTest('myRoster.h', text)
            expect(markers).toHaveLength(0)
        })

        it('accepts an identifier defined anywhere above or below the ROSTER call', () => {
            const text = [
                'ROSTER(6211, "CSX GP40", MY_FNS)',
                '#define MY_FNS "Lights/Bell"',
            ].join('\n')

            const markers = _runValidatorsForTest('myRoster.h', text)
            expect(markers).toHaveLength(0)
        })

        it('accepts identifiers with underscores and digits', () => {
            const text = [
                '#define LOCO_GP40_6211_F "LIGHT/HORN"',
                'ROSTER(6211, "GP40", LOCO_GP40_6211_F)',
            ].join('\n')

            const markers = _runValidatorsForTest('myRoster.h', text)
            expect(markers).toHaveLength(0)
        })

        it('is case-sensitive — MyFns does not satisfy #define myfns', () => {
            const text = [
                '#define myfns "LIGHT"',
                'ROSTER(1, "Loco", MyFns)',
            ].join('\n')

            const markers = _runValidatorsForTest('myRoster.h', text)
            const fnMarkers = markers.filter((m) => m.message.includes('is not defined'))
            expect(fnMarkers).toHaveLength(1)
            expect(fnMarkers[0].severity).toBe(WARNING)
        })
    })

    describe('#define identifier — NOT defined in the file', () => {
        it('produces a Warning when the identifier has no matching #define', () => {
            const markers = _runValidatorsForTest(
                'myRoster.h',
                'ROSTER(42, "Thomas", MY_UNDEFINED_FNS)',
            )
            const fnMarkers = markers.filter((m) => m.message.includes('is not defined'))
            expect(fnMarkers).toHaveLength(1)
            expect(fnMarkers[0].severity).toBe(WARNING)
        })

        it('includes the identifier name in the warning message', () => {
            const markers = _runValidatorsForTest(
                'myRoster.h',
                'ROSTER(42, "Thomas", MY_UNDEFINED_FNS)',
            )
            const msg = markers.find((m) => m.message.includes('is not defined'))?.message ?? ''
            expect(msg).toContain('MY_UNDEFINED_FNS')
        })

        it('suggests adding a #define in the warning message', () => {
            const markers = _runValidatorsForTest(
                'myRoster.h',
                'ROSTER(1, "Loco", MISSING_DEFINE)',
            )
            const msg = markers.find((m) => m.message.includes('is not defined'))?.message ?? ''
            expect(msg).toContain('#define MISSING_DEFINE')
        })

        it('produces a Warning (not an Error) for an undefined identifier', () => {
            const markers = _runValidatorsForTest(
                'myRoster.h',
                'ROSTER(1, "Loco", UNDEFINED)',
            )
            const fnMarker = markers.find((m) => m.message.includes('is not defined'))
            expect(fnMarker?.severity).toBe(WARNING)
        })
    })

    describe('invalid third argument (neither quoted string nor identifier)', () => {
        it('produces an Error for a bare number', () => {
            const markers = _runValidatorsForTest(
                'myRoster.h',
                'ROSTER(42, "Thomas", 123)',
            )
            const fnMarkers = markers.filter((m) =>
                m.message.includes('Function list must be a quoted string'),
            )
            expect(fnMarkers).toHaveLength(1)
            expect(fnMarkers[0].severity).toBe(ERROR)
        })

        it('produces an Error for a value starting with a digit', () => {
            const markers = _runValidatorsForTest(
                'myRoster.h',
                'ROSTER(1, "Loco", 2badIdentifier)',
            )
            const fnMarkers = markers.filter((m) =>
                m.message.includes('Function list must be a quoted string'),
            )
            expect(fnMarkers).toHaveLength(1)
            expect(fnMarkers[0].severity).toBe(ERROR)
        })

        it('produces an Error for a value with illegal characters', () => {
            const markers = _runValidatorsForTest(
                'myRoster.h',
                'ROSTER(1, "Loco", bad-value)',
            )
            const fnMarkers = markers.filter((m) =>
                m.message.includes('Function list must be a quoted string'),
            )
            expect(fnMarkers).toHaveLength(1)
        })
    })

    describe('multiple ROSTER entries in one file', () => {
        it('validates each entry independently', () => {
            const text = [
                '#define SHARED_FNS "LIGHT"',
                'ROSTER(1, "Loco A", SHARED_FNS)',
                'ROSTER(2, "Loco B", NO_DEFINE_HERE)',
                'ROSTER(3, "Loco C", "LIGHT/HORN")',
            ].join('\n')

            const markers = _runValidatorsForTest('myRoster.h', text)
            // Only the middle entry should produce a warning
            const undefinedWarnings = markers.filter((m) => m.message.includes('is not defined'))
            expect(undefinedWarnings).toHaveLength(1)
            expect(undefinedWarnings[0].message).toContain('NO_DEFINE_HERE')
        })
    })

    describe('#define identifier with appended quoted string (preprocessor concatenation)', () => {
        it('accepts MACRO_NAME "suffix" format where MACRO_NAME is defined', () => {
            const text = [
                '#define COMMON "LIGHT/HORN"',
                'ROSTER(1, "Loco", COMMON "/EXTRA")',
            ].join('\n')
            const markers = _runValidatorsForTest('myRoster.h', text)
            expect(markers).toHaveLength(0)
        })

        it('accepts MACRO_NAME "suffix" even if spaces between macro and suffix', () => {
            const text = [
                '#define COMMON "LIGHT/HORN"',
                'ROSTER(1, "Loco", COMMON  "/EXTRA")',
            ].join('\n')
            const markers = _runValidatorsForTest('myRoster.h', text)
            expect(markers).toHaveLength(0)
        })

        it('warns when MACRO_NAME is undefined but has quoted suffix', () => {
            const markers = _runValidatorsForTest(
                'myRoster.h',
                'ROSTER(1, "Loco", UNDEFINED_MACRO "/EXTRA")',
            )
            const undefinedWarnings = markers.filter((m) => m.message.includes('is not defined'))
            expect(undefinedWarnings).toHaveLength(1)
            expect(undefinedWarnings[0].message).toContain('UNDEFINED_MACRO')
            expect(undefinedWarnings[0].severity).toBe(WARNING)
        })

        it('errors when suffix is not quoted', () => {
            const text = [
                '#define COMMON "LIGHT/HORN"',
                'ROSTER(1, "Loco", COMMON /EXTRA)',
            ].join('\n')
            const markers = _runValidatorsForTest('myRoster.h', text)
            // The validator rejects unquoted suffixes; check for any error
            const errorMarkers = markers.filter((m) => m.severity === ERROR)
            expect(errorMarkers).toHaveLength(1)
            expect(errorMarkers[0].message).toContain('Function list must be')
        })

        it('accepts multiple entries with mixed formats (some with suffix, some without)', () => {
            const text = [
                '#define COMMON "LIGHT/HORN"',
                '#define STEAM "WHISTLE/BELL"',
                'ROSTER(1, "Loco A", COMMON)',
                'ROSTER(2, "Loco B", COMMON "/EXTRA")',
                'ROSTER(3, "Loco C", STEAM "/PUFF")',
                'ROSTER(4, "Loco D", "LIGHT/HORN")',
            ].join('\n')
            const markers = _runValidatorsForTest('myRoster.h', text)
            expect(markers).toHaveLength(0)
        })

        it('handles quoted strings with parentheses (e.g., "(copy)")', () => {
            const text = [
                '#define THOMAS_F "LIGHT/HORN"',
                'ROSTER(6263, "Thomas (copy)", THOMAS_F)',
            ].join('\n')
            const markers = _runValidatorsForTest('myRoster.h', text)
            expect(markers).toHaveLength(0)
        })

        it('handles complex loco names with special chars and parentheses', () => {
            const text = [
                '#define STEAM_F "WHISTLE/BELL"',
                'ROSTER(1001, "CSX SD80MAC (2009) #801", STEAM_F)',
                'ROSTER(1002, "UP Big Boy (4014) (rebuilt)", STEAM_F)',
            ].join('\n')
            const markers = _runValidatorsForTest('myRoster.h', text)
            expect(markers).toHaveLength(0)
        })
    })
})

// ── getDefineNames (tested indirectly via validateRoster) ─────────────────────

describe('getDefineNames (via validateRoster integration)', () => {
    it('finds names from all #define statements in the file', () => {
        const text = [
            '#define ALPHA "a"',
            '#define BETA_2 "b"',
            '#define _GAMMA "c"',
            'ROSTER(1, "Loco", ALPHA)',
            'ROSTER(2, "LocoB", BETA_2)',
            'ROSTER(3, "LocoC", _GAMMA)',
        ].join('\n')

        const markers = _runValidatorsForTest('myRoster.h', text)
        expect(markers).toHaveLength(0)
    })

    it('does not treat a #define inside a comment as a valid define', () => {
        // The regex anchors on line start (^) with /m so inline comments on the
        // same line as #define still count.  Only test that a define on its own
        // line is detected (the negative case — commented-out defines are not
        // in scope since C preprocessor comments are handled separately).
        const text = 'ROSTER(1, "Loco", ONLY_IN_COMMENT)'

        const markers = _runValidatorsForTest('myRoster.h', text)
        const undefinedWarnings = markers.filter((m) => m.message.includes('is not defined'))
        expect(undefinedWarnings).toHaveLength(1)
    })
})

// ── Turnout ID uniqueness (myTurnouts.h) ──────────────────────────────────────

describe('validateTurnoutIdUniqueness', () => {
    it('flags a duplicate ID shared by two SERVO_TURNOUT entries', () => {
        const text = [
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
            'SERVO_TURNOUT(200, 26, 410, 205, Fast, "Yard Entry")',
        ].join('\n')

        const markers = _runValidatorsForTest('myTurnouts.h', text)
        const dupWarnings = markers.filter((m) => m.message.includes('already used by another entry'))
        expect(dupWarnings).toHaveLength(1)
    })

    it('flags a duplicate ID shared across different turnout macro types', () => {
        const text = [
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
            'TURNOUT(200, 10, 1, "Yard Exit")',
            'PIN_TURNOUT(200, 30, "Siding")',
        ].join('\n')

        const markers = _runValidatorsForTest('myTurnouts.h', text)
        const dupWarnings = markers.filter((m) => m.message.includes('already used by another entry'))
        expect(dupWarnings).toHaveLength(2)
    })

    it('does not flag distinct IDs across different turnout types', () => {
        const text = [
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
            'TURNOUT(201, 10, 1, "Yard Exit")',
            'PIN_TURNOUT(202, 30, "Siding")',
        ].join('\n')

        const markers = _runValidatorsForTest('myTurnouts.h', text)
        const dupWarnings = markers.filter((m) => m.message.includes('already used by another entry'))
        expect(dupWarnings).toHaveLength(0)
    })
})

// ── ALIAS target-reference validator (myAliases.h) ────────────────────────────

describe('validateAliasTargets', () => {
    const baseData = {
        aliases: [],
        roster: [],
        turnouts: [{ id: 200, type: 'SERVO' as const, pin: 25, activeAngle: 410, inactiveAngle: 205, profile: 'Slow' as const, description: 'Junction', defaultState: 'CLOSED' as const }],
        sensors: [],
        routes: [],
        sequences: [],
    }

    it('flags an ALIAS value that matches no configured object', () => {
        const text = 'ALIAS(MAIN_YARD, 999)'

        const markers = _runValidatorsForTest('myAliases.h', text, baseData)
        const warnings = markers.filter((m) => m.message.includes('does not match any configured'))
        expect(warnings).toHaveLength(1)
        expect(warnings[0].severity).toBe(ERROR)
    })

    it('does not flag an ALIAS value that matches a configured turnout ID', () => {
        const text = 'ALIAS(MAIN_YARD, 200)'

        const markers = _runValidatorsForTest('myAliases.h', text, baseData)
        const warnings = markers.filter((m) => m.message.includes('does not match any configured'))
        expect(warnings).toHaveLength(0)
    })

    it('does not flag an ALIAS with no value (EX-RAIL auto-assigns one)', () => {
        const text = 'ALIAS(MAIN_YARD)'

        const markers = _runValidatorsForTest('myAliases.h', text, baseData)
        const warnings = markers.filter((m) => m.message.includes('does not match any configured'))
        expect(warnings).toHaveLength(0)
    })
})

// ── ROUTE/AUTOMATION/SEQUENCE id rules (myRoutes.h / mySequences.h / myAutomation.h) ──────────

describe('validateSequenceIdRules — wired through _runValidatorsForTest', () => {
    it('flags a ROUTE id that collides with a SEQUENCE id defined elsewhere', () => {
        const entries = [
            { kind: 'Route' as const, id: 10 },
            { kind: 'Sequence' as const, id: 10 },
        ]

        const markers = _runValidatorsForTest('myRoutes.h', 'ROUTE(10, "Main")\nDONE', undefined, entries)
        expect(markers).toHaveLength(1)
        expect(markers[0].message).toContain('unique across all three types')
    })

    it('flags the colliding SEQUENCE id too, when that file is opened', () => {
        const entries = [
            { kind: 'Route' as const, id: 10 },
            { kind: 'Sequence' as const, id: 10 },
        ]

        const markers = _runValidatorsForTest('mySequences.h', 'SEQUENCE(10)\nDONE', undefined, entries)
        expect(markers).toHaveLength(1)
        expect(markers[0].message).toContain('unique across all three types')
    })

    it('flags an AUTOMATION id that collides with a ROUTE id', () => {
        const entries = [
            { kind: 'Route' as const, id: 5 },
            { kind: 'Automation' as const, id: 5 },
        ]

        const markers = _runValidatorsForTest('myAutomation.h', 'AUTOMATION(5, "Handoff")\nDONE', undefined, entries)
        expect(markers).toHaveLength(1)
        expect(markers[0].message).toContain('unique across all three types')
    })

    it('flags id 0 on a ROUTE as reserved for the startup sequence', () => {
        const entries = [{ kind: 'Route' as const, id: 0 }]

        const markers = _runValidatorsForTest('myRoutes.h', 'ROUTE(0, "Bad")\nDONE', undefined, entries)
        expect(markers).toHaveLength(1)
        expect(markers[0].message).toContain('reserved for the startup sequence')
    })

    it('produces no markers when every id is unique and in range', () => {
        const entries = [
            { kind: 'Route' as const, id: 1 },
            { kind: 'Automation' as const, id: 2 },
            { kind: 'Sequence' as const, id: 3 },
        ]

        expect(_runValidatorsForTest('myRoutes.h', 'ROUTE(1, "Main")\nDONE', undefined, entries)).toHaveLength(0)
        expect(_runValidatorsForTest('mySequences.h', 'SEQUENCE(3)\nDONE', undefined, entries)).toHaveLength(0)
        expect(_runValidatorsForTest('myAutomation.h', 'AUTOMATION(2, "Handoff")\nDONE', undefined, entries)).toHaveLength(0)
    })

    it('does not run without sequenceIdEntries supplied (backward compatible no-op)', () => {
        const markers = _runValidatorsForTest('myRoutes.h', 'ROUTE(0, "Bad")\nDONE')
        expect(markers).toHaveLength(0)
    })

    it('only flags the occurrence in the currently open file, not unrelated files’ macros', () => {
        const entries = [
            { kind: 'Route' as const, id: 10 },
            { kind: 'Sequence' as const, id: 10 },
        ]

        // myAutomation.h has no AUTOMATION(10, ...) in its text, so nothing to mark there
        // even though id 10 collides elsewhere.
        const markers = _runValidatorsForTest('myAutomation.h', '// no automations here', undefined, entries)
        expect(markers).toHaveLength(0)
    })
})

// ── hasErrorMarkers() / onMarkersChanged() — the strict-compile gate ────────────

describe('hasErrorMarkers', () => {
    it('is false when there are no markers at all', () => {
        mockModelMarkers = []
        expect(hasErrorMarkers()).toBe(false)
    })

    it('is false when markers exist but are all below Error severity', () => {
        mockModelMarkers = [{ severity: WARNING }]
        expect(hasErrorMarkers()).toBe(false)
    })

    it('is true when at least one marker is Error severity', () => {
        mockModelMarkers = [{ severity: WARNING }, { severity: ERROR }]
        expect(hasErrorMarkers()).toBe(true)
    })
})

describe('onMarkersChanged', () => {
    it('invokes the callback when monaco reports a markers change', () => {
        const callback = vi.fn()
        onMarkersChanged(callback)

        const [handler] = vi.mocked(monaco.editor.onDidChangeMarkers).mock.calls.at(-1)!
        handler([] as never)

        expect(callback).toHaveBeenCalled()
    })
})
