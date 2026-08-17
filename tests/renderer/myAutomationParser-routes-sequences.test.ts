import { describe, expect, it } from 'vitest'

import {
    parseRoutesFromFile,
    serializeRoutesToFile,
    parseSequencesFromFile,
    serializeSequencesToFile,
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
})
