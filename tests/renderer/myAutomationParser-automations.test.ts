import { describe, expect, it } from 'vitest'

import {
    parseAutomationsFromFile,
    serializeAutomationsToFile,
    extractAutomations,
} from '../../src/renderer/src/utils/myAutomationParser'

describe('serializeAutomationsToFile / parseAutomationsFromFile — round trip', () => {
    it('round-trips a single automation, mirroring ROUTE\'s exact shape', () => {
        const automations = [{ id: 1, description: 'Coal trucks - Collect', body: 'CALL(2)\nDONE' }]
        const file = serializeAutomationsToFile(automations)
        expect(file).toBe('AUTOMATION(1, "Coal trucks - Collect")\nCALL(2)\nDONE')
        expect(parseAutomationsFromFile(file)).toEqual(automations)
    })

    it('defaults a brand-new, completely empty body to DONE', () => {
        const file = serializeAutomationsToFile([{ id: 1, description: 'New', body: '' }])
        expect(file).toBe('AUTOMATION(1, "New")\nDONE')
    })

    it('round-trips multiple automations', () => {
        const automations = [
            { id: 1, description: 'First', body: 'FON(0)\nDONE' },
            { id: 2, description: 'Second', body: 'FOFF(0)\nDONE' },
        ]
        const file = serializeAutomationsToFile(automations)
        expect(parseAutomationsFromFile(file)).toEqual(automations)
    })
})

describe('extractAutomations — migration helper', () => {
    it('pulls AUTOMATION blocks out of arbitrary content, leaving the rest as remainder', () => {
        const content = [
            '// my custom file',
            'ALIAS(TRN_A, 100)',
            'AUTOMATION(1, "Do a thing")',
            'THROW(100)',
            'DONE',
            'TURNOUT(100, 20, 0, "Yard")',
        ].join('\n')
        const { automations, remainder } = extractAutomations(content)
        expect(automations).toEqual([{ id: 1, description: 'Do a thing', body: 'THROW(100)\nDONE' }])
        expect(remainder).toBe(['// my custom file', 'ALIAS(TRN_A, 100)', 'TURNOUT(100, 20, 0, "Yard")'].join('\n'))
    })

    it('returns an empty automations array and the content unchanged when there are none', () => {
        const content = 'ALIAS(TRN_A, 100)\nTURNOUT(100, 20, 0, "Yard")'
        const { automations, remainder } = extractAutomations(content)
        expect(automations).toEqual([])
        expect(remainder).toBe(content)
    })

    it('extracts multiple automations from the same file', () => {
        const content = [
            'AUTOMATION(1, "First")',
            'DONE',
            '',
            'AUTOMATION(2, "Second")',
            'DONE',
        ].join('\n')
        const { automations, remainder } = extractAutomations(content)
        expect(automations).toEqual([
            { id: 1, description: 'First', body: 'DONE' },
            { id: 2, description: 'Second', body: 'DONE' },
        ])
        expect(remainder).toBe('')
    })
})
