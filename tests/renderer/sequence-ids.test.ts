import { describe, expect, it } from 'vitest'

import {
    parseAutomationsFromFile,
    validateSequenceIds,
    MIN_SEQUENCE_ID,
    MAX_SEQUENCE_ID,
    type SequenceIdEntry,
} from '../../src/renderer/src/utils/myAutomationParser'

// ── parseAutomationsFromFile ────────────────────────────────────────────────

describe('parseAutomationsFromFile', () => {
    it('extracts id and description from a single AUTOMATION block', () => {
        const automations = parseAutomationsFromFile('AUTOMATION(5, "Yard shunt")\nSTART(1)\nDONE')
        expect(automations).toEqual([{ id: 5, description: 'Yard shunt', body: 'START(1)\nDONE' }])
    })

    it('finds multiple AUTOMATION blocks mixed in with other free-form content', () => {
        const text = [
            '// some preserved comment',
            'AUTOMATION(1, "First")',
            'FWD(50)',
            'DONE',
            '',
            'AUTOMATION(2, "Second")',
            'REV(50)',
            'DONE',
        ].join('\n')

        expect(parseAutomationsFromFile(text)).toEqual([
            { id: 1, description: 'First', body: 'FWD(50)\nDONE' },
            { id: 2, description: 'Second', body: 'REV(50)\nDONE' },
        ])
    })

    it('returns an empty array when there are no AUTOMATION blocks', () => {
        expect(parseAutomationsFromFile('// nothing here\nAUTOSTART\nPOWERON\nDONE')).toEqual([])
    })
})

// ── validateSequenceIds ─────────────────────────────────────────────────────

describe('validateSequenceIds — range', () => {
    it('produces no violations for ids within 1-32767, one of each kind', () => {
        const entries: SequenceIdEntry[] = [
            { kind: 'Route', id: 1 },
            { kind: 'Automation', id: 2 },
            { kind: 'Sequence', id: MAX_SEQUENCE_ID },
        ]
        expect(validateSequenceIds(entries)).toEqual([])
    })

    it('flags id 0 as reserved for the startup sequence, not merely out of range', () => {
        const violations = validateSequenceIds([{ kind: 'Route', id: 0 }])
        expect(violations).toHaveLength(1)
        expect(violations[0].reason).toContain('reserved for the startup sequence')
    })

    it('flags an id above MAX_SEQUENCE_ID as out of range', () => {
        const violations = validateSequenceIds([{ kind: 'Sequence', id: MAX_SEQUENCE_ID + 1 }])
        expect(violations).toHaveLength(1)
        expect(violations[0].reason).toContain('out of range')
    })

    it('flags a negative id as out of range', () => {
        const violations = validateSequenceIds([{ kind: 'Automation', id: -1 }])
        expect(violations).toHaveLength(1)
        expect(violations[0].reason).toContain('out of range')
    })

    it('accepts the boundary values MIN_SEQUENCE_ID and MAX_SEQUENCE_ID', () => {
        expect(validateSequenceIds([{ kind: 'Route', id: MIN_SEQUENCE_ID }])).toEqual([])
        expect(validateSequenceIds([{ kind: 'Route', id: MAX_SEQUENCE_ID }])).toEqual([])
    })
})

describe('validateSequenceIds — cross-type uniqueness', () => {
    it('flags a Route and a Sequence sharing the same id', () => {
        const violations = validateSequenceIds([
            { kind: 'Route', id: 10 },
            { kind: 'Sequence', id: 10 },
        ])
        expect(violations).toHaveLength(2)
        expect(violations.every((v) => v.id === 10)).toBe(true)
        expect(violations.map((v) => v.kind).sort()).toEqual(['Route', 'Sequence'])
        expect(violations[0].reason).toContain('unique across all three types')
    })

    it('flags a Route and an Automation sharing the same id', () => {
        const violations = validateSequenceIds([
            { kind: 'Route', id: 42 },
            { kind: 'Automation', id: 42 },
        ])
        expect(violations).toHaveLength(2)
        expect(violations.map((v) => v.kind).sort()).toEqual(['Automation', 'Route'])
    })

    it('flags an Automation and a Sequence sharing the same id', () => {
        const violations = validateSequenceIds([
            { kind: 'Automation', id: 7 },
            { kind: 'Sequence', id: 7 },
        ])
        expect(violations).toHaveLength(2)
        expect(violations.map((v) => v.kind).sort()).toEqual(['Automation', 'Sequence'])
    })

    it('flags all three kinds when they all reuse the same id', () => {
        const violations = validateSequenceIds([
            { kind: 'Route', id: 3 },
            { kind: 'Automation', id: 3 },
            { kind: 'Sequence', id: 3 },
        ])
        expect(violations).toHaveLength(3)
        expect(violations.map((v) => v.kind).sort()).toEqual(['Automation', 'Route', 'Sequence'])
    })

    it('does not flag two entries of the same kind with different ids', () => {
        const violations = validateSequenceIds([
            { kind: 'Route', id: 1 },
            { kind: 'Route', id: 2 },
        ])
        expect(violations).toEqual([])
    })

    it('flags two entries of the same kind sharing an id too — collisions are not only cross-type', () => {
        const violations = validateSequenceIds([
            { kind: 'Sequence', id: 5 },
            { kind: 'Sequence', id: 5 },
        ])
        expect(violations).toHaveLength(2)
        expect(violations.every((v) => v.kind === 'Sequence' && v.id === 5)).toBe(true)
    })

    it('does not cross-contaminate collisions across unrelated ids', () => {
        const violations = validateSequenceIds([
            { kind: 'Route', id: 1 },
            { kind: 'Sequence', id: 2 },
            { kind: 'Automation', id: 3 },
        ])
        expect(violations).toEqual([])
    })
})

describe('validateSequenceIds — combined range + uniqueness', () => {
    it('reports both an out-of-range violation and a duplicate violation independently', () => {
        const violations = validateSequenceIds([
            { kind: 'Route', id: 0 },
            { kind: 'Sequence', id: 0 },
        ])
        // Each of the two id-0 entries gets its own "reserved" violation, plus each
        // gets its own duplicate violation — four violations total, two per entry.
        expect(violations).toHaveLength(4)
        expect(violations.filter((v) => v.reason.includes('reserved')).length).toBe(2)
        expect(violations.filter((v) => v.reason.includes('unique across all three types')).length).toBe(2)
    })
})
