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
