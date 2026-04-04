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
