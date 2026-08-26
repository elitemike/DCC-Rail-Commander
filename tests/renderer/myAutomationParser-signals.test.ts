import { describe, expect, it } from 'vitest'

import {
    parseSignalsFromFile,
    serializeSignalsToFile,
    type SignalEntry,
} from '../../src/renderer/src/utils/myAutomationParser'

describe('parseSignalsFromFile — SIGNAL (pin-driven)', () => {
    it('parses red/amber/green pins and description', () => {
        const signals = parseSignalsFromFile('SIGNAL(22, 23, 24) // Home')
        expect(signals).toEqual([{ type: 'PIN', red: 22, amber: 23, green: 24, description: 'Home' }])
    })
})

describe('parseSignalsFromFile — DCC_SIGNAL (DCC accessory)', () => {
    it('parses id, addr, subAddr, and description', () => {
        const signals = parseSignalsFromFile('DCC_SIGNAL(5, 100, 0) // Yard exit')
        expect(signals).toEqual([{ type: 'DCC', id: 5, addr: 100, subAddr: 0, description: 'Yard exit' }])
    })

    it('does not get swallowed by the plain SIGNAL parser, or vice versa', () => {
        const file = 'SIGNAL(22, 23, 24) // Home\nDCC_SIGNAL(5, 100, 0) // Yard exit'
        const signals = parseSignalsFromFile(file)
        expect(signals).toEqual([
            { type: 'PIN', red: 22, amber: 23, green: 24, description: 'Home' },
            { type: 'DCC', id: 5, addr: 100, subAddr: 0, description: 'Yard exit' },
        ])
    })
})

describe('serializeSignalsToFile — SIGNAL / DCC_SIGNAL', () => {
    it('emits DCC_SIGNAL for a DCC entry, not SIGNAL', () => {
        const signals: SignalEntry[] = [{ type: 'DCC', id: 5, addr: 100, subAddr: 0, description: 'Yard exit' }]
        expect(serializeSignalsToFile(signals)).toBe('DCC_SIGNAL(5, 100, 0)')
    })

    it('round-trips a mixed file, each kind grouped by its own parse pass', () => {
        const signals: SignalEntry[] = [
            { type: 'PIN', red: 22, amber: 23, green: 24, description: 'Home' },
            { type: 'DCC', id: 5, addr: 100, subAddr: 0, description: 'Yard exit' },
        ]
        const file = serializeSignalsToFile(signals)
        // serializeSignalsToFile doesn't emit description as a comment (pre-existing behavior),
        // so only the numeric fields survive the round trip.
        expect(parseSignalsFromFile(file)).toEqual([
            { type: 'PIN', red: 22, amber: 23, green: 24, description: '' },
            { type: 'DCC', id: 5, addr: 100, subAddr: 0, description: '' },
        ])
    })
})
