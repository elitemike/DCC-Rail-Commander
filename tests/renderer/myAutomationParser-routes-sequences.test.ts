import { describe, expect, it } from 'vitest'

import {
    parseRoutesFromFile,
    serializeRoutesToFile,
    parseSequencesFromFile,
    serializeSequencesToFile,
    parseEventHandlersFromFile,
    serializeEventHandlersToFile,
    buildGeneratorHeader,
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

describe('parseRoutesFromFile / serializeRoutesToFile — comment field', () => {
    it('parses a trailing // comment on the header line, separate from the quoted description', () => {
        const routes = parseRoutesFromFile('ROUTE(1, "Main") // Runs every morning\nTHROW(200)\nDONE\n')
        expect(routes).toEqual([{ id: 1, description: 'Main', comment: 'Runs every morning', body: 'THROW(200)\nDONE' }])
    })

    it('serializes the comment as a trailing // on the ROUTE(...) line', () => {
        const file = serializeRoutesToFile([{ id: 1, description: 'Main', comment: 'Runs every morning', body: 'DONE' }])
        expect(file).toBe('ROUTE(1, "Main") // Runs every morning\nDONE')
    })

    it('omits the trailing comment entirely when unset', () => {
        const file = serializeRoutesToFile([{ id: 1, description: 'Main', body: 'DONE' }])
        expect(file).toBe('ROUTE(1, "Main")\nDONE')
    })

    it('round-trips a multi-route file where only some routes have a comment', () => {
        const routes = [
            { id: 1, description: 'First', comment: 'Note one', body: 'THROW(200)' },
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

describe('parseSequencesFromFile / serializeSequencesToFile — comment field', () => {
    it('parses a single leading // line directly above the header as the comment', () => {
        const seqs = parseSequencesFromFile('// Waits for the far end to confirm clear\nSEQUENCE(1) // Cross the points\nDONE\n')
        expect(seqs).toEqual([{ id: 1, description: 'Cross the points', comment: 'Waits for the far end to confirm clear', body: 'DONE' }])
    })

    it('parses a multi-line leading comment block, one line per source line', () => {
        const file = ['// First line of the note', '// Second line of the note', 'SEQUENCE(1)', 'DONE'].join('\n')
        const seqs = parseSequencesFromFile(file)
        expect(seqs).toEqual([{ id: 1, description: '', comment: 'First line of the note\nSecond line of the note', body: 'DONE' }])
    })

    it('does not attach a stray comment to the previous entry\'s body when a blank line separates them from the next header', () => {
        const file = ['SEQUENCE(1)', 'THROW(200)', 'DONE', '', '// Longer note for seq 2', 'SEQUENCE(2)', 'CLOSE(201)', 'DONE'].join('\n')
        const seqs = parseSequencesFromFile(file)
        expect(seqs).toEqual([
            { id: 1, description: '', body: 'THROW(200)\nDONE' },
            { id: 2, description: '', comment: 'Longer note for seq 2', body: 'CLOSE(201)\nDONE' },
        ])
    })

    it('leaves a trailing // comment with no following SEQUENCE as ordinary body content of the last entry', () => {
        const file = ['SEQUENCE(1)', 'THROW(200)', '// just a note, nothing follows'].join('\n')
        const seqs = parseSequencesFromFile(file)
        expect(seqs).toEqual([{ id: 1, description: '', body: 'THROW(200)\n// just a note, nothing follows' }])
    })

    it('serializes the comment as // line(s) directly above the header, before the description comment', () => {
        const file = serializeSequencesToFile([{ id: 1, description: 'Cross the points', comment: 'Line one\nLine two', body: 'DONE' }])
        expect(file).toBe('// Line one\n// Line two\nSEQUENCE(1) // Cross the points\nDONE')
    })

    it('round-trips a multi-sequence file where only some sequences have a comment', () => {
        const seqs = [
            { id: 1, description: 'First', comment: 'Note one', body: 'THROW(200)' },
            { id: 2, description: 'Second', body: 'CLOSE(201)\nDONE' },
        ]
        const file = serializeSequencesToFile(seqs)
        expect(parseSequencesFromFile(file)).toEqual(seqs)
    })

    it('does not mistake the DCC-Rail-Commander "managed file" boilerplate header for the first sequence\'s leading comment', () => {
        const header = buildGeneratorHeader('mySequences.h', '0.1.0')
        const file = `${header}\n\nSEQUENCE(1)\nDONE`
        const seqs = parseSequencesFromFile(file)
        expect(seqs).toEqual([{ id: 1, description: '', body: 'DONE' }])
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

    it('keeps stacked ON* headers sharing one body as a single entry (EXRAIL fallthrough idiom), instead of handing the whole body to only the last trigger', () => {
        const file = [
            'ONSENSOR(ReverseLoop1)',
            'ONSENSOR(ReverseLoop2)',
            'IF(ReverseLoop1)',
            '  THROW(Reverse_Loop_Instant)',
            'ENDIF',
            'IF(ReverseLoop2)',
            '  CLOSE(Reverse_Loop_Instant)',
            'ENDIF',
            'DONE',
        ].join('\n')
        const handlers = parseEventHandlersFromFile(file)
        expect(handlers).toEqual([{ command: 'ONSENSOR', text: file }])
    })

    it('keeps stacked headers of different hat types sharing one body as a single entry', () => {
        const file = ['ONSENSOR(200)', 'ONACTIVATE(100, 4)', 'THROW(201)', 'DONE'].join('\n')
        const handlers = parseEventHandlersFromFile(file)
        expect(handlers).toEqual([{ command: 'ONSENSOR', text: file }])
    })

    it('round-trips a file mixing a stacked fallthrough group with an independent handler', () => {
        const handlers = [
            { command: 'ONSENSOR', text: 'ONSENSOR(1)\nONSENSOR(2)\nTHROW(201)\nDONE' },
            { command: 'ONRAILSYNCON', text: 'ONRAILSYNCON\nPOWERON' },
        ]
        const file = serializeEventHandlersToFile(handlers)
        expect(parseEventHandlersFromFile(file)).toEqual(handlers)
    })
})

describe('parseEventHandlersFromFile / serializeEventHandlersToFile — name/comment fields', () => {
    it('parses a trailing // name on the header line, keeping text free of it', () => {
        const handlers = parseEventHandlersFromFile('ONSENSOR(200) // Platform bell\nTHROW(201)\nDONE\n')
        expect(handlers).toEqual([{ command: 'ONSENSOR', text: 'ONSENSOR(200)\nTHROW(201)\nDONE', name: 'Platform bell' }])
    })

    it('parses a leading // comment block directly above the header as the longer comment', () => {
        const file = ['// Rings the bell whenever a train occupies the down platform.', 'ONSENSOR(200)', 'THROW(201)', 'DONE'].join('\n')
        const handlers = parseEventHandlersFromFile(file)
        expect(handlers).toEqual([{ command: 'ONSENSOR', text: 'ONSENSOR(200)\nTHROW(201)\nDONE', comment: 'Rings the bell whenever a train occupies the down platform.' }])
    })

    it('parses both a leading comment block and a trailing name together', () => {
        const file = ['// A longer note about this handler.', 'ONSENSOR(200) // Platform bell', 'DONE'].join('\n')
        const handlers = parseEventHandlersFromFile(file)
        expect(handlers).toEqual([{ command: 'ONSENSOR', text: 'ONSENSOR(200)\nDONE', name: 'Platform bell', comment: 'A longer note about this handler.' }])
    })

    it('does not let a trailing name on the first header line break stacked-header absorption for the following handler', () => {
        const file = ['ONSENSOR(1) // First trigger', 'ONSENSOR(2)', 'THROW(201)', 'DONE'].join('\n')
        const handlers = parseEventHandlersFromFile(file)
        expect(handlers).toEqual([{ command: 'ONSENSOR', text: 'ONSENSOR(1)\nONSENSOR(2)\nTHROW(201)\nDONE', name: 'First trigger' }])
    })

    it('serializes name as a trailing // on the header line and comment as leading // lines above it', () => {
        const file = serializeEventHandlersToFile([{ command: 'ONSENSOR', text: 'ONSENSOR(200)\nDONE', name: 'Platform bell', comment: 'Longer note' }])
        expect(file).toBe('// Longer note\nONSENSOR(200) // Platform bell\nDONE')
    })

    it('round-trips a multi-handler file where only some handlers have a name/comment', () => {
        const handlers = [
            { command: 'ONSENSOR', text: 'ONSENSOR(200)\nDONE', name: 'Platform bell', comment: 'Longer note' },
            { command: 'ONRAILSYNCON', text: 'ONRAILSYNCON\nPOWERON' },
        ]
        const file = serializeEventHandlersToFile(handlers)
        expect(parseEventHandlersFromFile(file)).toEqual(handlers)
    })

    it('does not mistake the DCC-Rail-Commander "managed file" boilerplate header for the first handler\'s leading comment', () => {
        const header = buildGeneratorHeader('myEvents.h', '0.1.0')
        const file = `${header}\n\nONSENSOR(200)\nTHROW(201)\nDONE`
        const handlers = parseEventHandlersFromFile(file)
        expect(handlers).toEqual([{ command: 'ONSENSOR', text: 'ONSENSOR(200)\nTHROW(201)\nDONE' }])
    })
})
