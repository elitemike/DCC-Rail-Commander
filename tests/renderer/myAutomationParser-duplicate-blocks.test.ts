import { describe, expect, it } from 'vitest'

import { findDuplicateExrailBlocks, removeDuplicateExrailBlocks } from '../../src/renderer/src/utils/myAutomationParser'

describe('findDuplicateExrailBlocks', () => {
    it('finds no duplicates in a clean file', () => {
        const files = [
            { name: 'myAutomation.h', content: 'AUTOSTART SEQUENCE(95)\nDELAY(500)\nFOLLOW(95)\n' },
        ]
        expect(findDuplicateExrailBlocks(files)).toEqual([])
    })

    it('finds a duplicate AUTOSTART SEQUENCE(id) declared twice in the same file', () => {
        const files = [
            {
                name: 'myAutomation.h',
                content: [
                    'AUTOSTART SEQUENCE(96)',
                    'SET(110)',
                    'FOLLOW(96)',
                    '',
                    'AUTOSTART SEQUENCE(96)',
                    'SET(111)',
                    'FOLLOW(96)',
                ].join('\n'),
            },
        ]

        const groups = findDuplicateExrailBlocks(files)
        expect(groups).toHaveLength(1)
        expect(groups[0].macro).toBe('SEQUENCE')
        expect(groups[0].id).toBe(96)
        expect(groups[0].occurrences).toHaveLength(2)
        expect(groups[0].occurrences[0].text).toContain('SET(110)')
        expect(groups[0].occurrences[1].text).toContain('SET(111)')
    })

    it('finds a duplicate AUTOMATION(id, "desc") across two different files', () => {
        const files = [
            { name: 'myAutomation.h', content: 'AUTOMATION(89, "test")\nPRINT("a")\nDONE\n' },
            { name: 'myAutomations.h', content: 'AUTOMATION(89, "test")\nPRINT("b")\nDONE\n' },
        ]

        const groups = findDuplicateExrailBlocks(files)
        expect(groups).toHaveLength(1)
        expect(groups[0].macro).toBe('AUTOMATION')
        expect(groups[0].occurrences.map(o => o.fileName)).toEqual(['myAutomation.h', 'myAutomations.h'])
    })

    it('does not flag a bare (non-AUTOSTART) SEQUENCE and a ROUTE that happen to share a number', () => {
        // Different macros are independent id groups even with the same numeric id — only an
        // exact macro+id match counts as a duplicate (matching CommandStation-EX's own
        // seqCount() check, which is keyed on both).
        const files = [
            { name: 'myAutomation.h', content: 'SEQUENCE(1)\nDONE\n\nROUTE(1, "Main")\nDONE\n' },
        ]
        expect(findDuplicateExrailBlocks(files)).toEqual([])
    })

    it('ignores a commented-out declaration', () => {
        const files = [
            { name: 'myAutomation.h', content: '//SEQUENCE(180)\nAUTOSTART SEQUENCE(180)\nDONE\n' },
        ]
        expect(findDuplicateExrailBlocks(files)).toEqual([])
    })

    it('reproduces the real-world case: every sequence in the Gibson-style file duplicated once', () => {
        const files = [
            {
                name: 'myAutomation.h',
                content: [
                    'AUTOSTART SEQUENCE(95)',
                    'SET(115)',
                    'FOLLOW(95)',
                    '',
                    'AUTOSTART SEQUENCE(96)',
                    'SET(110)',
                    'FOLLOW(96)',
                    '',
                    '// duplicated further down, with different inline edits',
                    'AUTOSTART SEQUENCE(95)',
                    'SET(115) //bm',
                    'FOLLOW(95)',
                    '',
                    'AUTOSTART SEQUENCE(96)',
                    'SET(110) //bm',
                    'FOLLOW(96)',
                ].join('\n'),
            },
        ]

        const groups = findDuplicateExrailBlocks(files)
        expect(groups.map(g => `${g.macro}(${g.id})`)).toEqual(['SEQUENCE(95)', 'SEQUENCE(96)'])
    })
})

describe('removeDuplicateExrailBlocks', () => {
    it('keeps the first occurrence and deletes the rest', () => {
        const files = [
            {
                name: 'myAutomation.h',
                content: [
                    'AUTOSTART SEQUENCE(96)',
                    'SET(110)',
                    'FOLLOW(96)',
                    '',
                    'AUTOSTART SEQUENCE(96)',
                    'SET(111)',
                    'FOLLOW(96)',
                ].join('\n'),
            },
        ]
        const groups = findDuplicateExrailBlocks(files)

        const result = removeDuplicateExrailBlocks(files, groups)
        expect(result).toHaveLength(1)
        expect(result[0].content).toContain('SET(110)')
        expect(result[0].content).not.toContain('SET(111)')
        expect((result[0].content.match(/AUTOSTART SEQUENCE\(96\)/g) ?? []).length).toBe(1)
    })

    it('removes a duplicate that lives in a different file than the kept copy', () => {
        const files = [
            { name: 'myAutomation.h', content: 'AUTOMATION(89, "test")\nPRINT("a")\nDONE\n' },
            { name: 'myAutomations.h', content: 'AUTOMATION(89, "test")\nPRINT("b")\nDONE\n' },
        ]
        const groups = findDuplicateExrailBlocks(files)

        const result = removeDuplicateExrailBlocks(files, groups)
        const automationH = result.find(f => f.name === 'myAutomation.h')!
        const automationsH = result.find(f => f.name === 'myAutomations.h')!
        expect(automationH.content).toContain('PRINT("a")')
        expect(automationsH.content).not.toContain('AUTOMATION(89')
    })

    it('leaves files with no duplicates untouched', () => {
        const files = [
            { name: 'config.h', content: '// nothing to do here\n' },
        ]
        const result = removeDuplicateExrailBlocks(files, [])
        expect(result).toEqual(files)
    })

    it('collapses the blank-line gap left behind by a removed block', () => {
        const files = [
            {
                name: 'myAutomation.h',
                content: [
                    'AUTOSTART SEQUENCE(1)',
                    'DONE',
                    '',
                    'AUTOSTART SEQUENCE(1)',
                    'DONE',
                    '',
                    'AUTOMATION(2, "keep")',
                    'DONE',
                ].join('\n'),
            },
        ]
        const groups = findDuplicateExrailBlocks(files)
        const result = removeDuplicateExrailBlocks(files, groups)
        expect(result[0].content).not.toMatch(/\n{3,}/)
        expect(result[0].content).toContain('AUTOMATION(2, "keep")')
    })
})
