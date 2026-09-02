import { describe, expect, it } from 'vitest'

import {
    parseTurnoutFromFile,
    serializeTurnoutToFile,
    commentInvalidTurnoutLines,
    type Turnout,
} from '../../src/renderer/src/utils/myAutomationParser'

describe('parseTurnoutFromFile — TURNOUTL (linear-address DCC accessory)', () => {
    it('parses id, addr, and description', () => {
        const turnouts = parseTurnoutFromFile('TURNOUTL(1, 401, "Yard Exit")')
        expect(turnouts).toEqual([
            { type: 'DCCL', id: 1, addr: 401, description: 'Yard Exit', comment: '', defaultState: 'CLOSED' },
        ])
    })

    it('parses without a description', () => {
        const turnouts = parseTurnoutFromFile('TURNOUTL(2, 500)')
        expect(turnouts).toEqual([
            { type: 'DCCL', id: 2, addr: 500, description: '', comment: '', defaultState: 'CLOSED' },
        ])
    })

    it('does not get swallowed by the plain TURNOUT parser, or vice versa', () => {
        const file = 'TURNOUT(1, 100, 0, "Legacy")\nTURNOUTL(2, 401, "Linear")'
        const turnouts = parseTurnoutFromFile(file)
        expect(turnouts).toEqual([
            { type: 'DCC', id: 1, addr: 100, subAddr: 0, description: 'Legacy', comment: '', defaultState: 'CLOSED' },
            { type: 'DCCL', id: 2, addr: 401, description: 'Linear', comment: '', defaultState: 'CLOSED' },
        ])
    })
})

describe('parseTurnoutFromFile — VIRTUAL_TURNOUT (no hardware)', () => {
    it('parses id and description, with no hardware fields', () => {
        const turnouts = parseTurnoutFromFile('VIRTUAL_TURNOUT(3, "Simulated Siding")')
        expect(turnouts).toEqual([
            { type: 'VIRTUAL', id: 3, description: 'Simulated Siding', comment: '', defaultState: 'CLOSED' },
        ])
    })

    it('parses without a description', () => {
        const turnouts = parseTurnoutFromFile('VIRTUAL_TURNOUT(4)')
        expect(turnouts).toEqual([
            { type: 'VIRTUAL', id: 4, description: '', comment: '', defaultState: 'CLOSED' },
        ])
    })
})

describe('serializeTurnoutToFile — TURNOUTL / VIRTUAL_TURNOUT', () => {
    it('emits TURNOUTL for a DCCL entry, not SERVO_TURNOUT', () => {
        const turnouts: Turnout[] = [
            { type: 'DCCL', id: 1, addr: 401, description: 'Yard Exit', comment: '', defaultState: 'CLOSED' },
        ]
        expect(serializeTurnoutToFile(turnouts)).toBe('TURNOUTL(1, 401, "Yard Exit")')
    })

    it('emits VIRTUAL_TURNOUT for a VIRTUAL entry, not SERVO_TURNOUT', () => {
        const turnouts: Turnout[] = [
            { type: 'VIRTUAL', id: 3, description: 'Simulated Siding', comment: '', defaultState: 'CLOSED' },
        ]
        expect(serializeTurnoutToFile(turnouts)).toBe('VIRTUAL_TURNOUT(3, "Simulated Siding")')
    })

    it('round-trips a mixed-kind file end to end, preserving each entry exactly', () => {
        // parseTurnoutFromFile scans for each macro type in its own full-text pass (a
        // pre-existing property, true of SERVO/DCC/PIN before DCCL/VIRTUAL existed too),
        // so re-parsed order groups by type — SERVO, DCC, PIN, DCCL, VIRTUAL — regardless
        // of the original file's line order. defaultState is likewise never carried by the
        // turnout-line text itself (it's merged in from myAutomation.h at a higher layer —
        // see config-editor-state-turnouts-raw.test.ts), so it always round-trips as CLOSED here.
        const turnouts: Turnout[] = [
            { type: 'SERVO', id: 1, pin: 25, activeAngle: 400, inactiveAngle: 100, profile: 'Slow', description: 'Servo', comment: '', defaultState: 'CLOSED' },
            { type: 'DCC', id: 2, addr: 100, subAddr: 0, description: 'Legacy', comment: '', defaultState: 'CLOSED' },
            { type: 'PIN', id: 4, pin: 22, description: 'GPIO', comment: '', defaultState: 'CLOSED' },
            { type: 'DCCL', id: 3, addr: 401, description: 'Linear', comment: '', defaultState: 'CLOSED' },
            { type: 'VIRTUAL', id: 5, description: 'Virtual', comment: '', defaultState: 'CLOSED' },
        ]
        const file = serializeTurnoutToFile(turnouts)
        expect(parseTurnoutFromFile(file)).toEqual(turnouts)
    })
})

describe('commentInvalidTurnoutLines — TURNOUTL / VIRTUAL_TURNOUT', () => {
    it('leaves a structurally valid TURNOUTL line alone', () => {
        const { processedText, invalidLines } = commentInvalidTurnoutLines('TURNOUTL(1, 401, "Yard Exit")')
        expect(processedText).toBe('TURNOUTL(1, 401, "Yard Exit")')
        expect(invalidLines).toEqual([])
    })

    it('flags a malformed TURNOUTL line (missing addr)', () => {
        const { processedText, invalidLines } = commentInvalidTurnoutLines('TURNOUTL(1, "Yard Exit")')
        expect(processedText).toBe('// [INVALID] TURNOUTL(1, "Yard Exit")')
        expect(invalidLines).toEqual(['TURNOUTL(1, "Yard Exit")'])
    })

    it('leaves a structurally valid VIRTUAL_TURNOUT line alone', () => {
        const { processedText, invalidLines } = commentInvalidTurnoutLines('VIRTUAL_TURNOUT(3, "Simulated Siding")')
        expect(processedText).toBe('VIRTUAL_TURNOUT(3, "Simulated Siding")')
        expect(invalidLines).toEqual([])
    })

    it('does not flag TURNOUTL as an invalid plain TURNOUT', () => {
        const file = 'TURNOUT(1, 100, 0, "Legacy")\nTURNOUTL(2, 401, "Linear")'
        const { processedText, invalidLines } = commentInvalidTurnoutLines(file)
        expect(processedText).toBe(file)
        expect(invalidLines).toEqual([])
    })
})
