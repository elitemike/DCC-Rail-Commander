import { describe, it, expect } from 'vitest'
import {
    addFolder, allFolderPaths, buildFolderTree, deleteFolder, itemIndicesUnder, moveItemToFolder, renameFolder,
} from '../../src/renderer/src/utils/folder-tree'
import { parseSensorsFromFile, parseSensorFolders, serializeSensorsToFile, parseSequencesFromFile } from '../../src/renderer/src/utils/myAutomationParser'

const items = [{ folder: 'Yard/East' }, { folder: 'Yard' }, {}]

describe('folder-tree', () => {
    it('lists folders with ancestors, sorted', () => {
        expect(allFolderPaths(items, ['Spare'])).toEqual(['Spare', 'Yard', 'Yard/East'])
    })

    it('builds folders first, items in file order, root items at the top level', () => {
        const tree = buildFolderTree(items, [])
        expect(tree.map(n => n.kind)).toEqual(['folder', 'item'])
        const yard = tree[0] as any
        expect(yard.children.map((c: any) => c.kind)).toEqual(['folder', 'item'])
        expect(yard.children[0].children).toEqual([{ kind: 'item', index: 0 }])
    })

    it('itemIndicesUnder is recursive and empty folder means all', () => {
        expect(itemIndicesUnder(items, 'Yard')).toEqual([0, 1])
        expect(itemIndicesUnder(items, undefined)).toEqual([0, 1, 2])
    })

    it('moves items and clears the folder at top level', () => {
        expect(moveItemToFolder(items, 2, 'A / B')[2].folder).toBe('A/B')
        expect('folder' in moveItemToFolder(items, 0, '')[0]).toBe(false)
    })

    it('renames, rejects collisions and self-nesting, deletes by lifting contents', () => {
        const edit = { items, folders: [] as string[] }
        expect(renameFolder(edit, 'Yard', 'Depot')!.items.map(i => i.folder)).toEqual(['Depot/East', 'Depot', undefined])
        expect(renameFolder(edit, 'Yard', 'Yard/East')).toBeNull()
        expect(deleteFolder(edit, 'Yard').items.map(i => i.folder)).toEqual(['East', undefined, undefined])
        expect(addFolder(edit, 'New').folders).toEqual(['New'])
    })
})

describe('sensor folder metadata', () => {
    it('round-trips folders, empty folders and top-level entries', () => {
        const text = serializeSensorsToFile(
            [{ id: 10, description: 'A', folder: 'Yard' }, { id: 11, description: 'B' }],
            ['Spare', 'Yard'],
        )
        expect(text).toBe('// @tree-folder: Spare\n// @tree: Yard\n// Sensor 10 - A\n// Sensor 11 - B')
        expect(parseSensorsFromFile(text)).toEqual([{ id: 10, description: 'A', folder: 'Yard' }, { id: 11, description: 'B' }])
        expect(parseSensorFolders(text)).toEqual(['Spare'])
    })

    it('a tag does not leak onto the next entry', () => {
        const text = '// @tree: A\nsomething else\n// Sensor 5'
        expect(parseSensorsFromFile(text)).toEqual([{ id: 5, description: '' }])
    })
})

describe('tree tags are not user comments', () => {
    it('extractLeadingComment ignores @tree lines above a SEQUENCE', () => {
        const seq = parseSequencesFromFile('// @tree: Yard\nSEQUENCE(1)\nDONE')
        expect(seq[0].comment).toBeUndefined()
    })
})

import {
    parseAutomationsFromFile, parseRouteFolders, parseRoutesFromFile, parseSequenceFolders, parseSignalsFromFile,
    serializeAutomationsToFile, serializeRoutesToFile, serializeSequencesToFile, serializeSignalsToFile,
} from '../../src/renderer/src/utils/myAutomationParser'

describe('folder metadata for signals, routes, sequences, automations', () => {
    it('signals round-trip folder per entry, keyed by pin/id', () => {
        const signals = [
            { type: 'PIN' as const, red: 30, amber: 31, green: 32, description: '', folder: 'Yard' },
            { type: 'DCC' as const, id: 7, addr: 5, subAddr: 1, description: '' },
        ]
        const text = serializeSignalsToFile(signals, [])
        expect(text).toBe('// @tree: Yard\nSIGNAL(30, 31, 32)\nDCC_SIGNAL(7, 5, 1)')
        expect(parseSignalsFromFile(text)).toEqual(signals)
    })

    it('routes round-trip folders, declared empty folders, and leave the ROUTE macro lines untouched', () => {
        const routes = [
            { id: 1, description: 'A', body: 'DONE', folder: 'Yard/East' },
            { id: 2, description: 'B', body: 'DONE' },
        ]
        const text = serializeRoutesToFile(routes, ['Spare'])
        expect(parseRoutesFromFile(text)).toEqual(routes.map(r => ({ ...r, comment: undefined })))
        expect(parseRouteFolders(text)).toEqual(['Spare'])
        expect(text.split('\n').filter(l => l.startsWith('ROUTE('))).toEqual(['ROUTE(1, "A")', 'ROUTE(2, "B")'])
    })

    it('a body with no terminator does not swallow the next route\'s tag (no duplication on re-serialize)', () => {
        const text = 'ROUTE(1, "A")\nFWD(50)\n// @tree: Yard\nROUTE(2, "B")\nDONE'
        const routes = parseRoutesFromFile(text)
        expect(routes[0].body).toBe('FWD(50)')
        expect(routes[1].folder).toBe('Yard')
        expect(serializeRoutesToFile(routes)).toBe('// @tree: Yard\nROUTE(2, "B")\nDONE'.replace(/^/, 'ROUTE(1, "A")\nFWD(50)\n\n'))
    })

    it('sequences keep the tag apart from the user comment block', () => {
        const seqs = [{ id: 5, description: 'x', comment: 'note', body: 'DONE', folder: 'Depot' }]
        const text = serializeSequencesToFile(seqs, [])
        expect(text.startsWith('// @tree: Depot\n// note\nSEQUENCE(5)')).toBe(true)
        expect(parseSequenceFolders(text)).toEqual([])
    })

    it('automations round-trip folders', () => {
        const autos = [{ id: 9, description: 'Z', body: 'DONE', folder: 'Shows' }]
        const parsed = parseAutomationsFromFile(serializeAutomationsToFile(autos))
        expect(parsed[0].folder).toBe('Shows')
    })
})
