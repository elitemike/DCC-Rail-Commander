import { describe, it, expect, vi } from 'vitest'
import { RosterEditorCustomElement } from '../../src/renderer/src/components/roster-editor'
import type { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'
import {
    deriveDefineGroups,
    parseRosterFromFile,
    parseAliasesFromFile,
    serializeAliasesToFile,
    serializeRosterToFile,
} from '../../src/renderer/src/utils/myAutomationParser'
import type { Roster } from '../../src/renderer/src/utils/myAutomationParser'

// ── Factory ───────────────────────────────────────────────────────────────────

function makeEditor() {
    const editor = Object.create(RosterEditorCustomElement.prototype) as RosterEditorCustomElement

    const state = {
        roster: [],
        rosterPreservedComments: '',
        setRosterFromRaw: vi.fn(),
    } as unknown as ConfigEditorState

    const eaPublish = vi.fn()
    const ea = { publish: eaPublish, subscribe: vi.fn() }
    const toastShow = vi.fn()

    Object.assign(editor, {
        state,
        ea,
        toastService: { show: toastShow },
        dialogService: {},
        splitterObj: null,
        activeTab: 'raw' as const,
        editBuffer: null,
        editBufferIndex: null,
        rawEditor: null,
        rawSnapshot: '',
        _rawText: '',
        errorMessage: '',
        dccAddressInput: '',
        draggedIndex: null,
        newFunctionName: '',
        newFunctionIsMomentary: false,
        newFunctionNoFunction: false,
    })

    return { editor, state, eaPublish, toastShow }
}

// ── _processRawLeave: toast publishing ────────────────────────────────────────

describe('RosterEditorCustomElement._processRawLeave', () => {
    describe('toast event', () => {
        it('publishes SHOW_TOAST_EVENT when the raw text contains an invalid ROSTER line', () => {
            const { editor, toastShow } = makeEditor()

            editor._processRawLeave('ROSTER(bad input here)')

            expect(toastShow).toHaveBeenCalledOnce()
            const [payload] = toastShow.mock.calls[0]
            expect(payload).toMatchObject({
                title: 'Invalid Lines Commented Out',
                cssClass: 'e-toast-warning',
            })
            expect(payload.content).toContain('1 invalid roster line is commented out')
        })

        it('pluralises the message for multiple invalid lines', () => {
            const { editor, toastShow } = makeEditor()

            editor._processRawLeave(
                'ROSTER(bad one)\nROSTER(bad two)',
            )

            expect(toastShow).toHaveBeenCalledOnce()
            const [payload] = toastShow.mock.calls[0]
            expect(payload.content).toContain('2 invalid roster lines are commented out')
        })

        it('does NOT publish when all ROSTER lines are valid', () => {
            const { editor, toastShow } = makeEditor()

            editor._processRawLeave('ROSTER(42, "Thomas", "LIGHT/HORN")')

            expect(toastShow).not.toHaveBeenCalled()
        })

        it('does NOT publish when the text contains no ROSTER calls at all', () => {
            const { editor, toastShow } = makeEditor()

            editor._processRawLeave('// just a comment\n')

            expect(toastShow).not.toHaveBeenCalled()
        })
    })

    // ── rosterPreservedComments persistence ───────────────────────────────────

    describe('rosterPreservedComments persistence across multiple toggles', () => {
        it('sets rosterPreservedComments when an invalid line is first encountered', () => {
            const { editor, state } = makeEditor()

            editor._processRawLeave('ROSTER(bad input)')

            expect(state.rosterPreservedComments).toMatch(/\/\/ \[INVALID\]/)
            expect(state.rosterPreservedComments).toContain('ROSTER(bad input)')
        })

        it('preserves the [INVALID] comment on a second toggle (the bug scenario)', () => {
            const { editor, state } = makeEditor()

            // First pass — raw tab has a malformed line; user switches to visual.
            editor._processRawLeave('ROSTER(bad input)\nROSTER(1, "Good Loco", "LIGHT")')
            const afterFirstPass = state.rosterPreservedComments
            expect(afterFirstPass).toContain('// [INVALID]')

            // Simulate the round-trip: rosterRaw getter would return the
            // preserved comment + serialized valid lines. We fake the concatenated
            // text that flush() would return when the user is back in raw mode.
            const rawOnSecondVisit = `${afterFirstPass}\nROSTER(1, "Good Loco", "LIGHT")`

            // Second pass — user switches back to visual again.
            editor._processRawLeave(rawOnSecondVisit)

            // The [INVALID] line must still be preserved — it must not be wiped.
            expect(state.rosterPreservedComments).toContain('// [INVALID]')
            expect(state.rosterPreservedComments).toContain('ROSTER(bad input)')
        })

        it('does NOT publish toast on second toggle when the [INVALID] line is already commented out', () => {
            const { editor, state, toastShow } = makeEditor()

            // First pass: bad line gets commented and toast fires.
            editor._processRawLeave('ROSTER(bad input)')
            expect(toastShow).toHaveBeenCalledOnce()
            toastShow.mockClear()

            // Second pass: the text now contains the already-commented line.
            // commentInvalidRosterLines skips lines starting with '//', so
            // invalidLines is empty → no toast should fire.
            const rawOnSecondVisit = `${state.rosterPreservedComments}\nROSTER(1, "Good Loco", "LIGHT")`
            editor._processRawLeave(rawOnSecondVisit)

            // Already-commented lines are not re-toasted on subsequent toggles.
            expect(toastShow).not.toHaveBeenCalled()
        })

        it('clears rosterPreservedComments when all invalid lines have been corrected', () => {
            const { editor, state } = makeEditor()

            // First pass: creates a preserved comment.
            editor._processRawLeave('ROSTER(bad input)')
            expect(state.rosterPreservedComments).not.toBe('')

            // User fixes the line in raw and switches to visual with only valid content.
            editor._processRawLeave('ROSTER(42, "Fixed Loco", "LIGHT")')

            expect(state.rosterPreservedComments).toBe('')
        })
    })
})

// ── deriveDefineGroups ────────────────────────────────────────────────────────

describe('deriveDefineGroups', () => {
    it('returns empty groups and ungrouped for an empty roster', () => {
        const result = deriveDefineGroups([])
        expect(result.groups).toHaveLength(0)
        expect(result.ungrouped).toHaveLength(0)
    })

    it('puts all inline entries into ungrouped when none have a functionMacro', () => {
        const roster: Roster[] = [
            { dccAddress: 1, name: 'A', functions: [], comment: '' },
            { dccAddress: 2, name: 'B', functions: [], comment: '' },
            { dccAddress: 3, name: 'C', functions: [], comment: '' },
        ]
        const { groups, ungrouped } = deriveDefineGroups(roster)
        expect(groups).toHaveLength(0)
        expect(ungrouped).toEqual([0, 1, 2])
    })

    it('creates one group for two locos sharing the same functionMacro', () => {
        const roster: Roster[] = [
            { dccAddress: 1, name: 'A', functions: [], comment: '', functionMacro: 'FOO_F' },
            { dccAddress: 2, name: 'B', functions: [], comment: '', functionMacro: 'FOO_F' },
        ]
        const { groups, ungrouped } = deriveDefineGroups(roster)
        expect(groups).toHaveLength(1)
        expect(groups[0].macroName).toBe('FOO_F')
        expect(groups[0].rosterIndices).toEqual([0, 1])
        expect(ungrouped).toHaveLength(0)
    })

    it('handles mixed roster: some grouped, some ungrouped', () => {
        const roster: Roster[] = [
            { dccAddress: 1, name: 'A', functions: [], comment: '', functionMacro: 'GRP_F' },
            { dccAddress: 2, name: 'B', functions: [], comment: '' },
            { dccAddress: 3, name: 'C', functions: [], comment: '', functionMacro: 'GRP_F' },
            { dccAddress: 4, name: 'D', functions: [], comment: '' },
        ]
        const { groups, ungrouped } = deriveDefineGroups(roster)
        expect(groups).toHaveLength(1)
        expect(groups[0].macroName).toBe('GRP_F')
        expect(groups[0].rosterIndices).toEqual([0, 2])
        expect(ungrouped).toEqual([1, 3])
    })

    it('creates separate groups for different macroNames', () => {
        const roster: Roster[] = [
            { dccAddress: 1, name: 'A', functions: [], comment: '', functionMacro: 'AAA_F' },
            { dccAddress: 2, name: 'B', functions: [], comment: '', functionMacro: 'BBB_F' },
        ]
        const { groups } = deriveDefineGroups(roster)
        expect(groups).toHaveLength(2)
        expect(groups.map(g => g.macroName)).toEqual(['AAA_F', 'BBB_F'])
    })

    it('copies friendlyName from the first roster entry for the group', () => {
        const roster: Roster[] = [
            { dccAddress: 1, name: 'A', functions: [], comment: '', functionMacro: 'FOO_F', defineFriendlyName: 'Steam Locos' },
            { dccAddress: 2, name: 'B', functions: [], comment: '', functionMacro: 'FOO_F', defineFriendlyName: 'Steam Locos' },
        ]
        const { groups } = deriveDefineGroups(roster)
        expect(groups[0].friendlyName).toBe('Steam Locos')
    })

    it('preserves insertion order of groups', () => {
        const roster: Roster[] = [
            { dccAddress: 1, name: 'A', functions: [], comment: '', functionMacro: 'ZZZ_F' },
            { dccAddress: 2, name: 'B', functions: [], comment: '', functionMacro: 'AAA_F' },
        ]
        const { groups } = deriveDefineGroups(roster)
        expect(groups[0].macroName).toBe('ZZZ_F')
        expect(groups[1].macroName).toBe('AAA_F')
    })
})

// ── serializeRosterToFile — macro preservation & friendly names ───────────────

describe('serializeRosterToFile — macro preservation', () => {
    it('emits #define for a singleton entry with functionMacro', () => {
        const roster: Roster[] = [
            {
                dccAddress: 42, name: 'Thomas', comment: '',
                functions: [{ name: 'Horn', isMomentary: false, noFunction: false }],
                functionMacro: 'THOMAS_F',
            },
        ]
        const output = serializeRosterToFile(roster)
        expect(output).toContain('#define THOMAS_F "Horn"')
        expect(output).toContain('ROSTER(42, "Thomas", THOMAS_F)')
    })

    it('preserves the user-assigned functionMacro name (does not replace with auto-generated name)', () => {
        const roster: Roster[] = [
            { dccAddress: 1, name: 'A', comment: '', functions: [], functionMacro: 'MY_CUSTOM_NAME_F' },
            { dccAddress: 2, name: 'B', comment: '', functions: [], functionMacro: 'MY_CUSTOM_NAME_F' },
        ]
        const output = serializeRosterToFile(roster)
        expect(output).toContain('#define MY_CUSTOM_NAME_F ""')
        expect(output).toContain('ROSTER(1, "A", MY_CUSTOM_NAME_F)')
        expect(output).toContain('ROSTER(2, "B", MY_CUSTOM_NAME_F)')
        // Should NOT emit an auto-generated name
        expect(output).not.toContain('A_F')
    })

    it('appends // friendlyName: "..." to the #define line when defineFriendlyName is set', () => {
        const roster: Roster[] = [
            {
                dccAddress: 1, name: 'Loco A', comment: '',
                functions: [{ name: 'Horn', isMomentary: false, noFunction: false }],
                functionMacro: 'STEAM_F',
                defineFriendlyName: 'Steam Locomotives',
            },
        ]
        const output = serializeRosterToFile(roster)
        expect(output).toContain('#define STEAM_F "Horn" // friendlyName: "Steam Locomotives"')
    })

    it('does NOT append friendlyName comment when defineFriendlyName is undefined', () => {
        const roster: Roster[] = [
            {
                dccAddress: 1, name: 'Loco', comment: '',
                functions: [],
                functionMacro: 'NO_NAME_F',
            },
        ]
        const output = serializeRosterToFile(roster)
        expect(output).toContain('#define NO_NAME_F ""')
        expect(output).not.toContain('friendlyName')
    })

    it('emits inline string for entries with no functionMacro and no duplicate function strings', () => {
        const roster: Roster[] = [
            { dccAddress: 1, name: 'A', comment: '', functions: [{ name: 'Horn', isMomentary: false, noFunction: false }] },
        ]
        const output = serializeRosterToFile(roster)
        expect(output).toContain('ROSTER(1, "A", "Horn")')
        expect(output).not.toContain('#define')
    })

    it('auto-groups two inline entries with identical function strings', () => {
        const roster: Roster[] = [
            { dccAddress: 1, name: 'A', comment: '', functions: [{ name: 'Horn', isMomentary: false, noFunction: false }] },
            { dccAddress: 2, name: 'B', comment: '', functions: [{ name: 'Horn', isMomentary: false, noFunction: false }] },
        ]
        const output = serializeRosterToFile(roster)
        // A #define should be auto-emitted
        expect(output).toMatch(/#define \w+ "Horn"/)
        // Both ROSTER lines should reference the macro name (not inline "Horn")
        expect(output).not.toContain('ROSTER(1, "A", "Horn")')
        expect(output).not.toContain('ROSTER(2, "B", "Horn")')
    })
})

// ── parseRosterFromFile — friendly name parsing ───────────────────────────────

describe('parseRosterFromFile — friendly name parsing', () => {
    it('parses defineFriendlyName from // friendlyName: "..." comment on #define line', () => {
        const text = [
            '#define STEAM_F "Horn/Bell" // friendlyName: "Steam Locomotives"',
            'ROSTER(1, "Loco", STEAM_F)',
        ].join('\n')
        const roster = parseRosterFromFile(text)
        expect(roster[0].defineFriendlyName).toBe('Steam Locomotives')
    })

    it('sets defineFriendlyName to undefined when no friendlyName comment is present', () => {
        const text = [
            '#define MY_F "Horn"',
            'ROSTER(1, "Loco", MY_F)',
        ].join('\n')
        const roster = parseRosterFromFile(text)
        expect(roster[0].defineFriendlyName).toBeUndefined()
    })

    it('does not set defineFriendlyName for inline-string-based entries', () => {
        const text = 'ROSTER(1, "Loco", "Horn")'
        const roster = parseRosterFromFile(text)
        expect(roster[0].defineFriendlyName).toBeUndefined()
    })

    it('roundtrips: serialize with defineFriendlyName, parse back, same value returned', () => {
        const original: Roster[] = [
            {
                dccAddress: 1,
                name: 'Thomas',
                comment: '',
                functions: [{ name: 'Whistle', isMomentary: true, noFunction: false }],
                functionMacro: 'THOMAS_F',
                defineFriendlyName: 'Famous Steam Engines',
            },
        ]
        const text = serializeRosterToFile(original)
        const parsed = parseRosterFromFile(text)

        expect(parsed[0].functionMacro).toBe('THOMAS_F')
        expect(parsed[0].defineFriendlyName).toBe('Famous Steam Engines')
        expect(parsed[0].functions[0].name).toBe('Whistle')
        expect(parsed[0].functions[0].isMomentary).toBe(true)
    })

    it('roundtrips: two locos sharing a macro with friendly name survive serialise→parse', () => {
        const original: Roster[] = [
            { dccAddress: 1, name: 'A', comment: '', functions: [], functionMacro: 'FOO_F', defineFriendlyName: 'Foo Locos' },
            { dccAddress: 2, name: 'B', comment: '', functions: [], functionMacro: 'FOO_F', defineFriendlyName: 'Foo Locos' },
        ]
        const text = serializeRosterToFile(original)
        const parsed = parseRosterFromFile(text)

        expect(parsed).toHaveLength(2)
        expect(parsed[0].defineFriendlyName).toBe('Foo Locos')
        expect(parsed[1].defineFriendlyName).toBe('Foo Locos')
        expect(parsed[0].functionMacro).toBe('FOO_F')
        expect(parsed[1].functionMacro).toBe('FOO_F')
    })
})

describe('parseRosterFromFile — appended functions via preprocessor concatenation', () => {
    it('parses MACRO_NAME "suffix" format and separates base + appended functions', () => {
        const text = [
            '#define COMMON "LIGHT/HORN"',
            'ROSTER(1, "Loco", COMMON "/EXTRA")',
        ].join('\n')
        const roster = parseRosterFromFile(text)
        expect(roster[0].functionMacro).toBe('COMMON')
        expect(roster[0].functions).toHaveLength(3) // LIGHT, HORN, EXTRA
        expect(roster[0].appendedFunctions).toHaveLength(1) // EXTRA
        expect(roster[0].appendedFunctions?.[0].name).toBe('EXTRA')
    })

    it('parses MACRO with empty suffix', () => {
        const text = [
            '#define COMMON "LIGHT"',
            'ROSTER(1, "Loco", COMMON "")',
        ].join('\n')
        const roster = parseRosterFromFile(text)
        expect(roster[0].functionMacro).toBe('COMMON')
        expect(roster[0].appendedFunctions).toBeUndefined()
    })

    it('parses MACRO suffix with multiple functions', () => {
        const text = [
            '#define COMMON "LIGHT/HORN"',
            'ROSTER(1, "Loco", COMMON "/EXTRA/PUFF")',
        ].join('\n')
        const roster = parseRosterFromFile(text)
        expect(roster[0].appendedFunctions).toHaveLength(2)
        expect(roster[0].appendedFunctions?.[0].name).toBe('EXTRA')
        expect(roster[0].appendedFunctions?.[1].name).toBe('PUFF')
    })

    it('roundtrips: loco with appended functions survives serialize→parse', () => {
        const original: Roster[] = [
            {
                dccAddress: 1,
                name: 'Thomas',
                comment: '',
                functions: [
                    { name: 'LIGHT', isMomentary: false, noFunction: false },
                    { name: 'HORN', isMomentary: false, noFunction: false },
                    { name: 'EXTRA', isMomentary: false, noFunction: false },
                ],
                functionMacro: 'COMMON',
                appendedFunctions: [
                    { name: 'EXTRA', isMomentary: false, noFunction: false },
                ],
            },
        ]
        const text = serializeRosterToFile(original)
        // Should emit: ROSTER(1, "Thomas", COMMON "/EXTRA")
        expect(text).toContain('COMMON "/EXTRA"')
        const parsed = parseRosterFromFile(text)
        expect(parsed[0].functionMacro).toBe('COMMON')
        expect(parsed[0].appendedFunctions).toHaveLength(1)
    })
})

describe('serializeRosterToFile — appended functions', () => {
    it('emits MACRO_NAME "suffix" format when entry has appendedFunctions', () => {
        const roster: Roster[] = [
            {
                dccAddress: 1,
                name: 'Loco',
                functions: [
                    { name: 'LIGHT', isMomentary: false, noFunction: false },
                    { name: 'HORN', isMomentary: false, noFunction: false },
                    { name: 'EXTRA', isMomentary: false, noFunction: false },
                ],
                comment: '',
                functionMacro: 'COMMON',
                appendedFunctions: [
                    { name: 'EXTRA', isMomentary: false, noFunction: false },
                ],
            },
        ]
        const output = serializeRosterToFile(roster)
        expect(output).toContain('COMMON "/EXTRA"')
        expect(output).toContain('#define COMMON "LIGHT/HORN"')
    })

    it('emits plain MACRO_NAME when appendedFunctions is empty/undefined', () => {
        const roster: Roster[] = [
            {
                dccAddress: 1,
                name: 'Loco',
                functions: [
                    { name: 'LIGHT', isMomentary: false, noFunction: false },
                    { name: 'HORN', isMomentary: false, noFunction: false },
                ],
                comment: '',
                functionMacro: 'COMMON',
            },
        ]
        const output = serializeRosterToFile(roster)
        expect(output).toContain('ROSTER(1, "Loco", COMMON)')
        // Should not use the "MACRO /suffix" format when no appended functions
        expect(output).not.toContain('ROSTER(1, "Loco", COMMON "')
    })

    it('handles multiple locos with mixed appended/non-appended functions', () => {
        const roster: Roster[] = [
            {
                dccAddress: 1,
                name: 'A',
                functions: [
                    { name: 'LIGHT', isMomentary: false, noFunction: false },
                    { name: 'HORN', isMomentary: false, noFunction: false },
                    { name: 'EXTRA', isMomentary: false, noFunction: false },
                ],
                comment: '',
                functionMacro: 'COMMON',
                appendedFunctions: [
                    { name: 'EXTRA', isMomentary: false, noFunction: false },
                ],
            },
            {
                dccAddress: 2,
                name: 'B',
                functions: [
                    { name: 'LIGHT', isMomentary: false, noFunction: false },
                    { name: 'HORN', isMomentary: false, noFunction: false },
                ],
                comment: '',
                functionMacro: 'COMMON',
            },
        ]
        const output = serializeRosterToFile(roster)
        expect(output).toContain('COMMON "/EXTRA"')
        expect(output).toContain('ROSTER(2, "B", COMMON)')
    })
})

describe('parseRosterFromFile — preserve empty function tokens', () => {
    it('preserves empty tokens so trailing functions line up (Mute → F8)', () => {
        const text = 'ROSTER(611, "N&W #611", "Headlight/Bell/Whistle/*Short Whistle/Steam Release///Dimmer/Mute")'
        const roster = parseRosterFromFile(text)
        expect(roster).toHaveLength(1)
        const fns = roster[0].functions
        // Expect every slash to correspond to a function slot — there are 9 tokens
        expect(fns).toHaveLength(9)
        // Check a few specific positions
        expect(fns[3].isMomentary).toBe(true) // *Short Whistle
        expect(fns[4].name).toBe('Steam Release')
        expect(fns[5].noFunction).toBe(true)
        expect(fns[6].noFunction).toBe(true)
        expect(fns[7].name).toBe('Dimmer')
        expect(fns[8].name).toBe('Mute')
    })
})

describe('RosterEditorCustomElement alias integration', () => {
    it('populates aliasInput from myAliases.h when selecting a roster entry', () => {
        const editor = Object.create(RosterEditorCustomElement.prototype) as RosterEditorCustomElement
        const loadAppendedFunctions = vi.fn()
        Object.assign(editor, {
            state: { getPrimaryAliasNameForId: vi.fn().mockReturnValue('YARD_GOAT') },
            dccAddressInput: '',
            aliasInput: '',
            errorMessage: '',
            appendedFunctionsList: [],
            loadAppendedFunctions,
        })

            ; (editor as any)._setBuffer(0, {
                dccAddress: 42,
                name: 'Switcher',
                functions: [],
                comment: '',
            })

        expect(editor.aliasInput).toBe('YARD_GOAT')
        expect(loadAppendedFunctions).toHaveBeenCalledOnce()
    })

    it('syncs the matching alias when the roster ID or alias changes', () => {
        const existing = {
            dccAddress: 42,
            name: 'Switcher',
            functions: [],
            comment: '',
        }
        const updateRosterEntry = vi.fn()
        const syncAliasForId = vi.fn().mockReturnValue({ ok: true })
        const editor = Object.create(RosterEditorCustomElement.prototype) as RosterEditorCustomElement
        Object.assign(editor, {
            state: {
                roster: [existing],
                updateRosterEntry,
                syncAliasForId,
                getPrimaryAliasNameForId: vi.fn().mockReturnValue('OLD_ALIAS'),
            },
            editBufferIndex: 0,
            editBuffer: { ...existing, dccAddress: 84 },
            aliasInput: 'NEW_ALIAS',
            errorMessage: '',
            _rebuildTree: vi.fn(),
        })

        editor.commitBuffer()

        expect(updateRosterEntry).toHaveBeenCalledWith(0, { ...existing, dccAddress: 84 })
        expect(syncAliasForId).toHaveBeenCalledWith(42, 84, 'NEW_ALIAS', 'Roster', 'OLD_ALIAS')
    })
})

describe('Alias type comments', () => {
    it('parses alias type metadata from an end-of-line comment', () => {
        const aliases = parseAliasesFromFile('#define YARD_EXIT "200" // type: Turnout')
        expect(aliases).toEqual([{ name: 'YARD_EXIT', value: '200', aliasType: 'Turnout' }])
    })

    it('serializes alias type metadata back to myAliases.h', () => {
        const text = serializeAliasesToFile([{ name: 'SW1', value: '42', aliasType: 'Roster' }])
        expect(text).toBe('#define SW1 "42" // type: Roster')
    })
})
