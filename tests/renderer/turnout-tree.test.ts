import { describe, it, expect } from 'vitest'
import {
    parseTurnoutFromFile,
    parseTurnoutFolders,
    serializeTurnoutToFile,
    type Turnout,
} from '../../src/renderer/src/utils/myAutomationParser'
import {
    buildTurnoutTree,
    deleteFolder,
    isValidFolderName,
    moveTurnout,
    releaseChildren,
    renameFolder,
    retargetChildren,
    wouldCreateCycle,
    type TurnoutTreeNode,
} from '../../src/renderer/src/utils/turnout-tree'

const servo = (id: number, extra: Partial<Turnout> = {}): Turnout =>
    ({ type: 'SERVO', id, pin: 100 + id, activeAngle: 400, inactiveAngle: 100, profile: 'Slow', description: `T${id}`, comment: '', defaultState: 'CLOSED', ...extra }) as Turnout
const virt = (id: number, extra: Partial<Turnout> = {}): Turnout =>
    ({ type: 'VIRTUAL', id, description: `V${id}`, comment: '', defaultState: 'CLOSED', ...extra }) as Turnout

/** Compact text rendering of a tree, e.g. ["Yard/", "  #1", "#2"]. */
function render(nodes: TurnoutTreeNode[], turnouts: Turnout[], depth = 0): string[] {
    return nodes.flatMap(n => [
        `${'  '.repeat(depth)}${n.kind === 'folder' ? `${n.name}/` : `#${turnouts[n.index].id}`}`,
        ...render(n.children, turnouts, depth + 1),
    ])
}

describe('// @tree comments', () => {
    it('round-trips folder and virtual-parent placement through the file text', () => {
        const turnouts = [
            servo(1, { folder: 'Yard/East' }),
            virt(2, { folder: 'Yard' }),
            servo(3, { parentId: 2 }),
            servo(4),
        ]
        const text = serializeTurnoutToFile(turnouts)
        expect(text).toContain('// @tree: Yard/East\nSERVO_TURNOUT(1,')
        expect(text).toContain('// @tree: #2\nSERVO_TURNOUT(3,')

        const parsed = parseTurnoutFromFile(text)
        const byId = (id: number) => parsed.find(t => t.id === id)!
        expect(byId(1).folder).toBe('Yard/East')
        expect(byId(2).folder).toBe('Yard')
        expect(byId(3).parentId).toBe(2)
        expect(byId(4).folder).toBeUndefined()
        expect(byId(4).parentId).toBeUndefined()
    })

    it('leaves the EXRAIL macro lines themselves untouched', () => {
        const text = serializeTurnoutToFile([servo(1, { folder: 'A' })])
        const macroLines = text.split('\n').filter(l => !l.trim().startsWith('//'))
        expect(macroLines).toEqual(['SERVO_TURNOUT(1, 101, 400, 100, Slow, "T1")'])
    })

    it('declares empty folders with @tree-folder and skips ones a turnout already implies', () => {
        const text = serializeTurnoutToFile([servo(1, { folder: 'Yard/East' })], ['Yard', 'Yard/East', 'Spare/Empty'])
        expect(text).toContain('// @tree-folder: Spare/Empty')
        expect(text).not.toContain('@tree-folder: Yard')
        expect(parseTurnoutFolders(text)).toEqual(['Spare/Empty'])
    })

    it('tolerates sloppy hand-written tags (spacing, repeated slashes)', () => {
        const parsed = parseTurnoutFromFile('//@tree:   Yard /  / East  \nSERVO_TURNOUT(1, 101, 400, 100, Slow)')
        expect(parsed[0].folder).toBe('Yard/East')
    })

    it('does not let a tag above an [INVALID] line attach to the next turnout', () => {
        const parsed = parseTurnoutFromFile([
            '// @tree: Yard',
            '// [INVALID] SERVO_TURNOUT(bad)',
            'SERVO_TURNOUT(1, 101, 400, 100, Slow)',
        ].join('\n'))
        expect(parsed[0].folder).toBeUndefined()
    })

    it('a tag applies to one turnout only', () => {
        const parsed = parseTurnoutFromFile([
            '// @tree: Yard',
            'SERVO_TURNOUT(1, 101, 400, 100, Slow)',
            'SERVO_TURNOUT(2, 102, 400, 100, Slow)',
        ].join('\n'))
        expect(parsed.find(t => t.id === 1)!.folder).toBe('Yard')
        expect(parsed.find(t => t.id === 2)!.folder).toBeUndefined()
    })

    it('attaches tags to every turnout kind', () => {
        const parsed = parseTurnoutFromFile([
            '// @tree: A', 'TURNOUT(1, 10, 2)',
            '// @tree: B', 'TURNOUTL(2, 11)',
            '// @tree: C', 'PIN_TURNOUT(3, 52)',
            '// @tree: D', 'VIRTUAL_TURNOUT(4)',
        ].join('\n'))
        expect(Object.fromEntries(parsed.map(t => [t.id, t.folder]))).toEqual({ 1: 'A', 2: 'B', 3: 'C', 4: 'D' })
    })

    it('files with no tags parse exactly as before (no tree keys added)', () => {
        const [t] = parseTurnoutFromFile('SERVO_TURNOUT(1, 101, 400, 100, Slow, "x")')
        expect('folder' in t).toBe(false)
        expect('parentId' in t).toBe(false)
    })
})

describe('buildTurnoutTree', () => {
    it('nests folders and virtual parents; folders sort first, turnouts keep file order', () => {
        const turnouts = [
            servo(5),
            servo(1, { folder: 'Yard/East' }),
            virt(2, { folder: 'Yard' }),
            servo(3, { parentId: 2 }),
            servo(4, { folder: 'Yard' }),
        ]
        expect(render(buildTurnoutTree(turnouts, []), turnouts)).toEqual([
            'Yard/',
            '  East/',
            '    #1',
            '  #2',
            '    #3',
            '  #4',
            '#5',
        ])
    })

    it('shows declared empty folders', () => {
        expect(render(buildTurnoutTree([], ['Empty/Sub']), [])).toEqual(['Empty/', '  Sub/'])
    })

    it('puts a turnout at the top level when its parent is missing, not virtual, or loops', () => {
        const turnouts = [
            servo(1, { parentId: 99 }), // missing
            servo(2, { parentId: 3 }), // parent isn't VIRTUAL
            servo(3),
            virt(4, { parentId: 5 }), // 4 ↔ 5 cycle
            virt(5, { parentId: 4 }),
        ]
        const tree = buildTurnoutTree(turnouts, [])
        const topIds = tree.map(n => (n.kind === 'turnout' ? turnouts[n.index].id : n.name))
        expect(topIds).toEqual(expect.arrayContaining([1, 2, 3]))
        // Every turnout appears exactly once, wherever it ended up.
        const seen: number[] = []
        const walk = (ns: TurnoutTreeNode[]) => ns.forEach(n => { if (n.kind === 'turnout') seen.push(turnouts[n.index].id); walk(n.children) })
        walk(tree)
        expect(seen.sort()).toEqual([1, 2, 3, 4, 5])
    })
})

describe('moveTurnout / cycles', () => {
    it('moves between folder, virtual parent and top level', () => {
        let ts = [servo(1), virt(2)]
        ts = moveTurnout(ts, 0, { parentId: 2 })!
        expect(ts[0].parentId).toBe(2)
        ts = moveTurnout(ts, 0, { folder: 'Yard' })!
        expect(ts[0].folder).toBe('Yard')
        expect(ts[0].parentId).toBeUndefined()
        ts = moveTurnout(ts, 0, {})!
        expect(ts[0].folder).toBeUndefined()
    })

    it('refuses a non-virtual parent, itself as parent, and cycles', () => {
        const ts = [servo(1), virt(2), virt(3, { parentId: 2 })]
        expect(moveTurnout(ts, 1, { parentId: 1 })).toBeNull() // parent isn't VIRTUAL
        expect(moveTurnout(ts, 1, { parentId: 2 })).toBeNull() // itself
        expect(moveTurnout(ts, 1, { parentId: 3 })).toBeNull() // under its own child
        expect(wouldCreateCycle(ts, 1, 3)).toBe(true)
        expect(wouldCreateCycle(ts, 1, 2)).toBe(true)
        expect(wouldCreateCycle(ts, 0, 3)).toBe(false)
    })
})

describe('virtual parent lifecycle', () => {
    it('releaseChildren hands children to the removed parent’s own location', () => {
        const ts = [virt(2, { folder: 'Yard' }), servo(3, { parentId: 2 })]
        expect(releaseChildren(ts, 0)[1]).toMatchObject({ id: 3, folder: 'Yard' })
        expect(releaseChildren(ts, 0)[1].parentId).toBeUndefined()

        const topLevel = [virt(2), servo(3, { parentId: 2 })]
        const released = releaseChildren(topLevel, 0)[1]
        expect(released.parentId).toBeUndefined()
        expect(released.folder).toBeUndefined()
    })

    it('retargetChildren follows a parent id change', () => {
        const ts = [virt(2), servo(3, { parentId: 2 }), servo(4)]
        const out = retargetChildren(ts, 2, 20)
        expect(out[1].parentId).toBe(20)
        expect(out[2].parentId).toBeUndefined()
    })
})

describe('folder edits', () => {
    const edit = (turnouts: Turnout[], folders: string[] = []) => ({ turnouts, folders })

    it('renameFolder rewrites nested turnout and declared-folder paths', () => {
        const out = renameFolder(edit([servo(1, { folder: 'Yard/East' }), servo(2, { folder: 'Other' })], ['Yard/Spare']), 'Yard', 'Depot')!
        expect(out.turnouts[0].folder).toBe('Depot/East')
        expect(out.turnouts[1].folder).toBe('Other')
        expect(out.folders).toEqual(['Depot/Spare'])
    })

    it('renameFolder refuses collisions and moving a folder into itself', () => {
        const e = edit([servo(1, { folder: 'A' }), servo(2, { folder: 'B' })])
        expect(renameFolder(e, 'A', 'B')).toBeNull()
        expect(renameFolder(e, 'A', 'A/Inner')).toBeNull()
    })

    it('deleteFolder moves contents up a level instead of deleting them', () => {
        const out = deleteFolder(edit([servo(1, { folder: 'Yard' }), servo(2, { folder: 'Yard/East' })], ['Yard/Spare']), 'Yard')
        expect(out.turnouts[0].folder).toBeUndefined()
        expect(out.turnouts[1].folder).toBe('East')
        expect(out.folders).toEqual(['Spare'])
    })

    it('validates folder names', () => {
        expect(isValidFolderName('Yard')).toBe(true)
        expect(isValidFolderName('  ')).toBe(false)
        expect(isValidFolderName('a/b')).toBe(false)
    })
})
