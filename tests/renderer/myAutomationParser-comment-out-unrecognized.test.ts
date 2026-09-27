import { describe, expect, it } from 'vitest'

import {
    findUnrecognizedExrailBlockRanges,
    commentOutUnrecognizedExrailBlocks,
} from '../../src/renderer/src/utils/myAutomationParser'

describe('findUnrecognizedExrailBlockRanges', () => {
    it('bounds a single-header block from its header line through its own DONE', () => {
        const files = [
            {
                name: 'myAutomation.h',
                content: [
                    'ONBEFORE(IR_SENSOR)',       // line 1
                    '  SET(100)',                // line 2
                    'DONE',                      // line 3
                    'AUTOSTART',                 // line 4
                    'DONE',                      // line 5
                ].join('\n'),
            },
        ]
        const findings = [{ fileName: 'myAutomation.h', command: 'ONBEFORE', line: 1 }]
        const ranges = findUnrecognizedExrailBlockRanges(files, findings)
        expect(ranges).toHaveLength(1)
        expect(ranges[0]).toMatchObject({ fileName: 'myAutomation.h', startLine: 0, endLine: 3, commands: ['ONBEFORE'] })
    })

    it('folds a nested unrecognized command (LOOP/ENDLOOP) into its enclosing block, not a second range', () => {
        const content = [
            'ONBEFORE(IR_SENSOR)',   // 0
            '  RESET(100)',         // 1
            '  LOOP(5)',            // 2
            '    SET(101)',         // 3
            '  ENDLOOP',            // 4
            '  SET(101)',           // 5
            'DONE',                 // 6
        ].join('\n')
        const files = [{ name: 'myAutomation.h', content }]
        const findings = [
            { fileName: 'myAutomation.h', command: 'ONBEFORE', line: 1 },
            { fileName: 'myAutomation.h', command: 'LOOP', line: 3 },
            { fileName: 'myAutomation.h', command: 'ENDLOOP', line: 5 },
        ]
        const ranges = findUnrecognizedExrailBlockRanges(files, findings)
        expect(ranges).toHaveLength(1)
        expect(ranges[0].startLine).toBe(0)
        expect(ranges[0].endLine).toBe(7)
        expect(ranges[0].commands).toEqual(['ONBEFORE', 'LOOP', 'ENDLOOP'])
    })

    it('produces two separate ranges for two independent unrecognized blocks', () => {
        const content = [
            'ONBEFORE(IR_SENSOR)', // 0
            '  SET(100)',          // 1
            'DONE',                // 2
            'ONAFTER(IR_SENSOR)',  // 3
            '  RESET(100)',        // 4
            'DONE',                // 5
        ].join('\n')
        const files = [{ name: 'myAutomation.h', content }]
        const findings = [
            { fileName: 'myAutomation.h', command: 'ONBEFORE', line: 1 },
            { fileName: 'myAutomation.h', command: 'ONAFTER', line: 4 },
        ]
        const ranges = findUnrecognizedExrailBlockRanges(files, findings)
        expect(ranges).toHaveLength(2)
        expect(ranges[0]).toMatchObject({ startLine: 0, endLine: 3 })
        expect(ranges[1]).toMatchObject({ startLine: 3, endLine: 6 })
    })

    it('scopes ranges per file when the same finding shape appears in two files', () => {
        const files = [
            { name: 'myAutomation.h', content: 'ONBEFORE(1)\nDONE\n' },
            { name: 'myCustomExrail.h', content: 'ONAFTER(2)\nDONE\n' },
        ]
        const findings = [
            { fileName: 'myAutomation.h', command: 'ONBEFORE', line: 1 },
            { fileName: 'myCustomExrail.h', command: 'ONAFTER', line: 1 },
        ]
        const ranges = findUnrecognizedExrailBlockRanges(files, findings)
        expect(ranges).toHaveLength(2)
        expect(ranges.map(r => r.fileName).sort()).toEqual(['myAutomation.h', 'myCustomExrail.h'])
    })
})

describe('commentOutUnrecognizedExrailBlocks', () => {
    it('wraps the block in /* */ with an explanatory header line, preserving the original text', () => {
        const files = [
            {
                name: 'myAutomation.h',
                content: ['ONBEFORE(IR_SENSOR)', '  SET(100)', 'DONE', 'AUTOSTART', 'DONE'].join('\n'),
            },
        ]
        const ranges = [{ fileName: 'myAutomation.h', startLine: 0, endLine: 3, commands: ['ONBEFORE'] }]
        const result = commentOutUnrecognizedExrailBlocks(files, ranges)
        expect(result).toHaveLength(1)
        const content = result[0].content
        expect(content).toContain('UNRECOGNIZED')
        expect(content).toContain('ONBEFORE')
        expect(content).toContain('/*')
        expect(content).toContain('*/')
        // Original lines still present, verbatim, inside the comment.
        expect(content).toContain('SET(100)')
        // The unrelated trailing block is untouched.
        expect(content).toMatch(/AUTOSTART\nDONE\s*$/)
    })

    it('leaves a file with no ranges completely untouched', () => {
        const files = [{ name: 'myAutomation.h', content: 'AUTOSTART\nDONE\n' }]
        const result = commentOutUnrecognizedExrailBlocks(files, [])
        expect(result).toEqual(files)
    })

    it('applies multiple ranges in the same file in one pass, each independently wrapped', () => {
        const content = [
            'ONBEFORE(IR_SENSOR)', // 0
            '  SET(100)',          // 1
            'DONE',                // 2
            'ONAFTER(IR_SENSOR)',  // 3
            '  RESET(100)',        // 4
            'DONE',                // 5
        ].join('\n')
        const files = [{ name: 'myAutomation.h', content }]
        const ranges = [
            { fileName: 'myAutomation.h', startLine: 0, endLine: 3, commands: ['ONBEFORE'] },
            { fileName: 'myAutomation.h', startLine: 3, endLine: 6, commands: ['ONAFTER'] },
        ]
        const result = commentOutUnrecognizedExrailBlocks(files, ranges)
        const out = result[0].content
        expect(out.match(/\/\*/g)?.length).toBe(2)
        expect(out.match(/\*\//g)?.length).toBe(2)
        expect(out).toContain('ONBEFORE')
        expect(out).toContain('ONAFTER')
    })

    it('does not touch a file that has ranges recorded for a different file name', () => {
        const files = [
            { name: 'myAutomation.h', content: 'AUTOSTART\nDONE\n' },
            { name: 'myCustomExrail.h', content: 'ONAFTER(2)\nDONE\n' },
        ]
        const ranges = [{ fileName: 'myCustomExrail.h', startLine: 0, endLine: 2, commands: ['ONAFTER'] }]
        const result = commentOutUnrecognizedExrailBlocks(files, ranges)
        expect(result.find(f => f.name === 'myAutomation.h')!.content).toBe('AUTOSTART\nDONE\n')
        expect(result.find(f => f.name === 'myCustomExrail.h')!.content).toContain('UNRECOGNIZED')
    })
})
