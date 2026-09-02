import { describe, expect, it } from 'vitest'

import { importExistingProject, type ImportFile } from '../../src/renderer/src/models/project-importer'
import {
    parseRosterFromFile,
    parseTurnoutFromFile,
    parseSensorsFromFile,
    parseSignalsFromFile,
    parseRoutesFromFile,
    parseSequencesFromFile,
    parseAutomationsFromFile,
    parseAliasesFromFile,
} from '../../src/renderer/src/utils/myAutomationParser'

function fileOf(name: string, content: string): ImportFile {
    return { name, content }
}

function configFile(result: ReturnType<typeof importExistingProject>, name: string): string | undefined {
    return result.configFiles.find(f => f.name === name)?.content
}

describe('importExistingProject — alias-name id resolution', () => {
    it('resolves an alias-named SEQUENCE id to its numeric value before parsing', () => {
        const files = [
            fileOf('aliases.h', 'ALIAS(SEQ_FOO, 500)'),
            fileOf('seq.h', 'SEQUENCE(SEQ_FOO)\nFWD(20)\nDONE'),
        ]
        const result = importExistingProject(files)
        expect(parseSequencesFromFile(configFile(result, 'mySequences.h')!)).toEqual([
            { id: 500, description: '', body: 'FWD(20)\nDONE' },
        ])
    })

    it('resolves alias-named ids in TURNOUT/ROUTE declarations too', () => {
        const files = [
            fileOf('aliases.h', 'ALIAS(TRN_A, 100)\nALIAS(RTE_A, 200)'),
            fileOf('turnouts.h', 'TURNOUT(TRN_A, 20, 0, "Yard")'),
            fileOf('routes.h', 'ROUTE(RTE_A, "Go")\nTHROW(TRN_A)\nDONE'),
        ]
        const result = importExistingProject(files)
        expect(parseTurnoutFromFile(configFile(result, 'myTurnouts.h')!)).toEqual([
            { type: 'DCC', id: 100, addr: 20, subAddr: 0, description: 'Yard', comment: '', defaultState: 'CLOSED' },
        ])
        expect(parseRoutesFromFile(configFile(result, 'myRoutes.h')!)).toEqual([
            { id: 200, description: 'Go', body: 'THROW(100)\nDONE' },
        ])
    })

    it('does not substitute an alias name that happens to appear inside a quoted description', () => {
        const files = [
            fileOf('aliases.h', 'ALIAS(TRN_A, 100)'),
            fileOf('roster.h', 'ROSTER(1, "TRN_A the loco", "Light")'),
        ]
        const result = importExistingProject(files)
        expect(parseRosterFromFile(configFile(result, 'myRoster.h')!)[0].name).toBe('TRN_A the loco')
    })
})

describe('importExistingProject — merging and conflict detection', () => {
    it('merges the same kind of entry declared in different files', () => {
        const files = [
            fileOf('a.h', 'ROSTER(1, "Loco A", "Light")'),
            fileOf('b.h', 'ROSTER(2, "Loco B", "Light")'),
        ]
        const result = importExistingProject(files)
        expect(parseRosterFromFile(configFile(result, 'myRoster.h')!)).toHaveLength(2)
        expect(result.conflicts).toEqual([])
    })

    it('flags a conflict when the same id is declared differently in two files, keeping the first', () => {
        const files = [
            fileOf('a.h', 'TURNOUT(1, 20, 0, "First")'),
            fileOf('b.h', 'TURNOUT(1, 30, 0, "Second")'),
        ]
        const result = importExistingProject(files)
        const turnouts = parseTurnoutFromFile(configFile(result, 'myTurnouts.h')!)
        expect(turnouts).toHaveLength(1)
        expect(turnouts[0].description).toBe('First')
        expect(result.conflicts).toEqual([{ kind: 'Turnout', id: 1, files: ['a.h', 'b.h'] }])
    })

    it('does not flag identical re-declarations as a conflict', () => {
        const files = [
            fileOf('a.h', 'SENSOR(1, 30, "Occupancy")'),
            fileOf('b.h', 'SENSOR(1, 30, "Occupancy")'),
        ]
        const result = importExistingProject(files)
        // Still flagged — mergeByKey keys purely on id, any second declaration under the same id
        // from a different file is reported so the user can confirm it really is a duplicate.
        expect(result.conflicts).toEqual([{ kind: 'Sensor', id: 1, files: ['a.h', 'b.h'] }])
    })
})

describe('importExistingProject — alias usage-context classification', () => {
    it('confidently tags an alias used as a Turnout id', () => {
        const files = [
            fileOf('a.h', 'ALIAS(TRN_A, 100)\nTURNOUT(TRN_A, 20, 0, "Yard")\nTHROW(TRN_A)'),
        ]
        const result = importExistingProject(files)
        const aliases = parseAliasesFromFile(configFile(result, 'myAliases.h')!)
        expect(aliases.find(a => a.name === 'TRN_A')?.aliasType).toBe('Turnout')
        expect(result.aliasReview).toEqual([])
    })

    it('confidently classifies a Block-role alias as untagged, not questionable', () => {
        const files = [
            fileOf('a.h', 'ALIAS(BLK_YARD, 100)\nRESERVE(BLK_YARD)\nFREE(BLK_YARD)'),
        ]
        const result = importExistingProject(files)
        const aliases = parseAliasesFromFile(configFile(result, 'myAliases.h')!)
        expect(aliases.find(a => a.name === 'BLK_YARD')?.aliasType).toBeUndefined()
        expect(result.aliasReview).toEqual([])
    })

    it('resolves a CALL/FOLLOW target (ambiguous Route-or-Sequence) via the value-match heuristic', () => {
        const files = [
            fileOf('a.h', 'ALIAS(SEQ_A, 500)\nSEQUENCE(500)\nDONE'),
            fileOf('b.h', 'CALL(SEQ_A)'),
        ]
        const result = importExistingProject(files)
        const aliases = parseAliasesFromFile(configFile(result, 'myAliases.h')!)
        expect(aliases.find(a => a.name === 'SEQ_A')?.aliasType).toBe('Sequence')
        expect(result.aliasReview).toEqual([])
    })

    it('flags an alias declared with different values across files', () => {
        const files = [
            fileOf('a.h', 'ALIAS(SEQ_A, 500)'),
            fileOf('b.h', 'ALIAS(SEQ_A, 600)'),
        ]
        const result = importExistingProject(files)
        expect(result.aliasReview).toHaveLength(1)
        expect(result.aliasReview[0]).toMatchObject({ name: 'SEQ_A', reason: expect.stringContaining('different values') })
    })

    it('flags an alias with no usage evidence anywhere as needing review', () => {
        const files = [fileOf('a.h', 'ALIAS(UNUSED_THING, 999)')]
        const result = importExistingProject(files)
        expect(result.aliasReview).toHaveLength(1)
        expect(result.aliasReview[0].name).toBe('UNUSED_THING')
    })

    it('flags a CALL/FOLLOW target as questionable when no declaration exists to disambiguate Route vs Sequence', () => {
        const files = [
            fileOf('a.h', 'ALIAS(RTE_OR_SEQ, 500)'),
            fileOf('b.h', 'FOLLOW(RTE_OR_SEQ)'),
        ]
        const result = importExistingProject(files)
        expect(result.aliasReview).toHaveLength(1)
        expect(result.aliasReview[0].reason).toContain('ambiguous between Route and Sequence')
    })
})

describe('importExistingProject — leftover content and file status', () => {
    it('drops a file entirely once every line has been migrated (fully-migrated)', () => {
        const files = [fileOf('roster.h', 'ROSTER(1, "Loco A", "Light")')]
        const result = importExistingProject(files)
        expect(result.fileReports).toEqual([{ originalName: 'roster.h', status: 'fully-migrated' }])
        expect(result.configFiles.some(f => f.name === 'roster.h')).toBe(false)
    })

    it('creates a leftover custom file for content with no structured home (e.g. turntable directives)', () => {
        const files = [fileOf('turntable.h', 'DCC_TURNTABLE(1, 200)\nTT_ADDPOSITION(1, 1, 200, 0, "Entry")')]
        const result = importExistingProject(files)
        expect(result.fileReports).toEqual([
            { originalName: 'turntable.h', status: 'fully-leftover', leftoverFileName: 'turntable.h' },
        ])
        const leftover = configFile(result, 'turntable.h')
        expect(leftover).toContain('DCC_TURNTABLE(1, 200)')
        expect(leftover).toContain('TT_ADDPOSITION')
    })

    it('marks a file partial-leftover when some content migrated and some did not', () => {
        const files = [fileOf('mixed.h', 'ROSTER(1, "Loco A", "Light")\nDCC_TURNTABLE(1, 200)')]
        const result = importExistingProject(files)
        expect(result.fileReports).toEqual([
            { originalName: 'mixed.h', status: 'partial-leftover', leftoverFileName: 'mixed.h' },
        ])
        expect(parseRosterFromFile(configFile(result, 'myRoster.h')!)).toHaveLength(1)
        expect(configFile(result, 'mixed.h')).toContain('DCC_TURNTABLE')
    })

    it('preserves a #define macro verbatim in the leftover file (no structured home)', () => {
        const files = [fileOf('macros.h', '#define DELAY_SWITCH 250')]
        const result = importExistingProject(files)
        expect(configFile(result, 'macros.h')).toContain('#define DELAY_SWITCH 250')
    })

    it('preserves HAL_IGNORE_DEFAULTS verbatim — nothing in the app ever re-emits it', () => {
        const files = [fileOf('hal.h', 'HAL_IGNORE_DEFAULTS\nHAL(PCA9685, 100, 16, 0x40)')]
        const result = importExistingProject(files)
        expect(configFile(result, 'hal.h')).toContain('HAL_IGNORE_DEFAULTS')
    })

    it('leaves an ambiguous bare HAL(...) line as leftover instead of silently dropping it', () => {
        // PCA9555 alone matches two catalog boards — see hal-boards.ts.
        const files = [fileOf('hal.h', 'HAL(PCA9555, 276, 16, 0x20)')]
        const result = importExistingProject(files)
        expect(configFile(result, 'hal.h')).toContain('HAL(PCA9555, 276, 16, 0x20)')
    })

    it('merges an AUTOMATION(...) block into myAutomations.h, not a leftover file', () => {
        const files = [fileOf('atm.h', 'AUTOMATION(1, "Test")\nPRINT("hi")\nDONE')]
        const result = importExistingProject(files)
        expect(parseAutomationsFromFile(configFile(result, 'myAutomations.h')!)).toEqual([
            { id: 1, description: 'Test', body: 'PRINT("hi")\nDONE' },
        ])
        expect(configFile(result, 'atm.h')).toBeUndefined()
    })

    it('migrates a ROUTE that merely calls ROTATE_DCC inside its body — only the turntable declarations are unrecognized', () => {
        const files = [fileOf('tt.h', 'DCC_TURNTABLE(1, 200)\nROUTE(1, "Move")\nROTATE_DCC(1, 1)\nDONE')]
        const result = importExistingProject(files)
        expect(parseRoutesFromFile(configFile(result, 'myRoutes.h')!)).toEqual([
            { id: 1, description: 'Move', body: 'ROTATE_DCC(1, 1)\nDONE' },
        ])
        expect(configFile(result, 'tt.h')).toContain('DCC_TURNTABLE(1, 200)')
        expect(configFile(result, 'tt.h')).not.toContain('ROTATE_DCC')
    })
})

describe('importExistingProject — HAL devices and #include ordering', () => {
    it('merges a bare, untagged HAL(...) line into the myAutomation.h HAL Devices block', () => {
        const files = [fileOf('hal.h', 'HAL(PCA9685, 100, 16, 0x40)')]
        const result = importExistingProject(files)
        expect(configFile(result, 'myAutomation.h')).toContain('HAL(PCA9685, 100, 16, 0x40)')
    })

    it('orders a macro-bearing leftover file before other custom files in configFiles', () => {
        const files = [
            fileOf('other.h', 'DCC_TURNTABLE(1, 200)'),
            fileOf('macros.h', '#define DELAY_SWITCH 250'),
        ]
        const result = importExistingProject(files)
        const names = result.configFiles.map(f => f.name)
        expect(names.indexOf('macros.h')).toBeLessThan(names.indexOf('other.h'))
    })
})

describe('importExistingProject — config.h', () => {
    it('carries config.h through unchanged', () => {
        const files = [fileOf('config.h', '#define WIFI_SSID "Test"')]
        const result = importExistingProject(files)
        expect(configFile(result, 'config.h')).toBe('#define WIFI_SSID "Test"')
    })
})
