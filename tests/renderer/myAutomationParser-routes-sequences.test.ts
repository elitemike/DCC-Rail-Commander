import { describe, expect, it } from 'vitest'

import {
    parseRoutesFromFile,
    serializeRoutesToFile,
    parseSequencesFromFile,
    serializeSequencesToFile,
    parseEventHandlersFromFile,
    serializeEventHandlersToFile,
} from '../../src/renderer/src/utils/myAutomationParser'

describe('parseRoutesFromFile / serializeRoutesToFile — DONE handling', () => {
    it('keeps a trailing DONE as part of body, not stripped', () => {
        const routes = parseRoutesFromFile('ROUTE(1, "Main")\nTHROW(200)\nCLOSE(201)\nDONE\n')
        expect(routes).toEqual([{ id: 1, description: 'Main', body: 'THROW(200)\nCLOSE(201)\nDONE' }])
    })

    it('round-trips a body that already ends in DONE without duplicating it', () => {
        const file = serializeRoutesToFile([{ id: 1, description: 'Main', body: 'THROW(200)\nDONE' }])
        expect(file).toBe('ROUTE(1, "Main")\nTHROW(200)\nDONE')
        expect((file.match(/^DONE$/gm) ?? []).length).toBe(1)
    })

    it('writes a body with no DONE exactly as given — removing DONE is respected, not forced back', () => {
        const file = serializeRoutesToFile([{ id: 1, description: 'Main', body: 'THROW(200)' }])
        expect(file).toBe('ROUTE(1, "Main")\nTHROW(200)')
    })

    it('still defaults a brand-new, completely empty body to DONE', () => {
        const file = serializeRoutesToFile([{ id: 1, description: 'New Route', body: '' }])
        expect(file).toBe('ROUTE(1, "New Route")\nDONE')
    })

    it('finds the body/next-route boundary correctly even when a route has no DONE at all', () => {
        const file = [
            'ROUTE(1, "First")',
            'THROW(200)',
            '',
            'ROUTE(2, "Second")',
            'CLOSE(201)',
            'DONE',
        ].join('\n')
        const routes = parseRoutesFromFile(file)
        expect(routes).toEqual([
            { id: 1, description: 'First', body: 'THROW(200)' },
            { id: 2, description: 'Second', body: 'CLOSE(201)\nDONE' },
        ])
    })

    it('round-trips a multi-route file end to end, preserving each body exactly', () => {
        const routes = [
            { id: 1, description: 'First', body: 'THROW(200)' },
            { id: 2, description: 'Second', body: 'CLOSE(201)\nDONE' },
        ]
        const file = serializeRoutesToFile(routes)
        expect(parseRoutesFromFile(file)).toEqual(routes)
    })
})

describe('parseSequencesFromFile / serializeSequencesToFile — DONE handling', () => {
    it('keeps a trailing DONE as part of body, not stripped', () => {
        const seqs = parseSequencesFromFile('SEQUENCE(1) // Platform release\nTHROW(200)\nDONE\n')
        expect(seqs).toEqual([{ id: 1, description: 'Platform release', body: 'THROW(200)\nDONE' }])
    })

    it('keeps a nested (indented) DONE inside a branch and the real top-level DONE both', () => {
        const body = [
            'IFTHROWN(200)',
            '  THROW(200)',
            '  DONE',
            'ELSE',
            '  CLOSE(200)',
            'ENDIF',
            'DONE',
        ].join('\n')
        const seqs = parseSequencesFromFile(`SEQUENCE(1)\n${body}\n`)
        expect(seqs).toEqual([{ id: 1, description: '', body }])
    })

    it('writes a body with no DONE exactly as given — removing DONE is respected, not forced back', () => {
        const file = serializeSequencesToFile([{ id: 1, description: '', body: 'THROW(200)' }])
        expect(file).toBe('SEQUENCE(1)\nTHROW(200)')
    })

    it('still defaults a brand-new, completely empty body to DONE', () => {
        const file = serializeSequencesToFile([{ id: 1, description: '', body: '' }])
        expect(file).toBe('SEQUENCE(1)\nDONE')
    })

    it('finds the body/next-sequence boundary correctly even when a sequence has no DONE at all', () => {
        const file = ['SEQUENCE(1)', 'THROW(200)', '', 'SEQUENCE(2)', 'CLOSE(201)', 'DONE'].join('\n')
        const seqs = parseSequencesFromFile(file)
        expect(seqs).toEqual([
            { id: 1, description: '', body: 'THROW(200)' },
            { id: 2, description: '', body: 'CLOSE(201)\nDONE' },
        ])
    })

    it('keeps a trailing RETURN as part of body, not stripped — RETURN pops back to CALL and is just as terminal as DONE', () => {
        const seqs = parseSequencesFromFile('SEQUENCE(1)\nTHROW(200)\nRETURN\n')
        expect(seqs).toEqual([{ id: 1, description: '', body: 'THROW(200)\nRETURN' }])
    })

    it('finds the body/next-sequence boundary correctly when a sequence ends in RETURN with no DONE — must not bleed into the next block', () => {
        const file = ['SEQUENCE(1)', 'IFLOCO(LOC_A)', 'FWD(20)', 'ENDIF', 'RETURN', '', 'SEQUENCE(2)', 'CLOSE(201)', 'DONE'].join('\n')
        const seqs = parseSequencesFromFile(file)
        expect(seqs).toEqual([
            { id: 1, description: '', body: 'IFLOCO(LOC_A)\nFWD(20)\nENDIF\nRETURN' },
            { id: 2, description: '', body: 'CLOSE(201)\nDONE' },
        ])
    })

    it('round-trips a RETURN-terminated body end to end, preserving it exactly', () => {
        const seqs = [{ id: 1, description: '', body: 'THROW(200)\nRETURN' }]
        const file = serializeSequencesToFile(seqs)
        expect(parseSequencesFromFile(file)).toEqual(seqs)
    })
})

describe('parseEventHandlersFromFile / serializeEventHandlersToFile', () => {
    it('parses a header line plus body — text includes the header line, unlike RouteEntry.body', () => {
        const handlers = parseEventHandlersFromFile('ONSENSOR(200)\nTHROW(201)\nDONE\n')
        expect(handlers).toEqual([{ command: 'ONSENSOR', text: 'ONSENSOR(200)\nTHROW(201)\nDONE' }])
    })

    it('parses a zero-arg header line with no parens', () => {
        const handlers = parseEventHandlersFromFile('ONRAILSYNCON\nPOWERON\nDONE\n')
        expect(handlers).toEqual([{ command: 'ONRAILSYNCON', text: 'ONRAILSYNCON\nPOWERON\nDONE' }])
    })

    it('finds the boundary between two handlers correctly, even with no DONE at all', () => {
        const file = ['ONSENSOR(200)', 'THROW(201)', '', 'ONACTIVATE(100, 4)', 'CLOSE(202)', 'DONE'].join('\n')
        const handlers = parseEventHandlersFromFile(file)
        expect(handlers).toEqual([
            { command: 'ONSENSOR', text: 'ONSENSOR(200)\nTHROW(201)' },
            { command: 'ONACTIVATE', text: 'ONACTIVATE(100, 4)\nCLOSE(202)\nDONE' },
        ])
    })

    it('round-trips a multi-handler file end to end, preserving each block exactly', () => {
        const handlers = [
            { command: 'ONSENSOR', text: 'ONSENSOR(200)\nTHROW(201)\nDONE' },
            { command: 'ONRAILSYNCON', text: 'ONRAILSYNCON\nPOWERON' },
        ]
        const file = serializeEventHandlersToFile(handlers)
        expect(parseEventHandlersFromFile(file)).toEqual(handlers)
    })
})
