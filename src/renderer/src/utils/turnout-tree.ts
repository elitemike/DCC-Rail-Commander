/**
 * Pure logic for the turnout editor's tree view. A turnout's place in the tree is stored on the
 * turnout itself (`folder` or `parentId`, persisted as `// @tree:` comments — see
 * parseTurnoutTreeMeta in myAutomationParser.ts); nothing here touches the EXRAIL macros.
 *
 * Nodes are either organisation-only *folders* (path "A/B") or turnouts. A VIRTUAL turnout may also
 * act as a parent node (`parentId` of its children). Anything that can't be resolved — a parent id
 * that doesn't exist, isn't VIRTUAL, or would form a cycle — falls back to the top level, so a
 * hand-edited file can never hide a turnout.
 */

import type { Turnout } from './myAutomationParser'
import { normalizeFolderPath } from './myAutomationParser'
import { addFolder as addFolderGeneric, allFolderPaths as allFolderPathsGeneric, deleteFolder as deleteFolderGeneric, isValidFolderName as isValidFolderNameGeneric, renameFolder as renameFolderGeneric } from './folder-tree'

export interface FolderTreeNode {
    kind: 'folder'
    path: string
    name: string
    children: TurnoutTreeNode[]
}

export interface TurnoutLeafNode {
    kind: 'turnout'
    /** Index into the turnouts array. */
    index: number
    children: TurnoutTreeNode[]
}

export type TurnoutTreeNode = FolderTreeNode | TurnoutLeafNode

export interface TurnoutLocation {
    folder?: string
    parentId?: number
}

export interface TurnoutTreeEdit {
    turnouts: Turnout[]
    folders: string[]
}

const folderParent = (path: string): string => path.split('/').slice(0, -1).join('/')
const folderName = (path: string): string => path.split('/').pop() ?? path

export const isValidFolderName = isValidFolderNameGeneric

/** Every folder path in use — declared ones plus every turnout's, each with all of its ancestors. Sorted. */
export const allFolderPaths = allFolderPathsGeneric

/**
 * Index of the turnout that is `index`'s effective parent turnout, or -1 when it has none (no
 * parentId, parent missing / not VIRTUAL, or the chain loops back).
 */
function effectiveParentIndex(turnouts: Turnout[], index: number): number {
    const t = turnouts[index]
    if (t.parentId === undefined) return -1
    const parent = turnouts.findIndex(p => p.id === t.parentId && p.type === 'VIRTUAL')
    if (parent === -1 || parent === index) return -1
    // Walk up; if we come back to `index` the chain is a cycle.
    const seen = new Set<number>([index])
    let cur = parent
    while (cur !== -1) {
        if (seen.has(cur)) return -1
        seen.add(cur)
        const p = turnouts[cur]
        cur = p.parentId === undefined ? -1 : turnouts.findIndex(q => q.id === p.parentId && q.type === 'VIRTUAL')
    }
    return parent
}

/** Builds the tree: folders first (alphabetical), then turnouts in file order; at every level. */
export function buildTurnoutTree(turnouts: Turnout[], declaredFolders: string[]): TurnoutTreeNode[] {
    const folderNodes = new Map<string, FolderTreeNode>()
    for (const path of allFolderPaths(turnouts, declaredFolders)) {
        folderNodes.set(path, { kind: 'folder', path, name: folderName(path), children: [] })
    }
    const leafNodes: TurnoutLeafNode[] = turnouts.map((_, index) => ({ kind: 'turnout', index, children: [] }))

    const roots: TurnoutTreeNode[] = []
    // Folders first so they sort ahead of turnouts at every level.
    for (const node of folderNodes.values()) {
        const parent = folderNodes.get(folderParent(node.path))
        ;(parent ? parent.children : roots).push(node)
    }
    turnouts.forEach((t, index) => {
        const parentIdx = effectiveParentIndex(turnouts, index)
        if (parentIdx !== -1) leafNodes[parentIdx].children.push(leafNodes[index])
        else if (t.parentId === undefined && t.folder && folderNodes.has(t.folder)) folderNodes.get(t.folder)!.children.push(leafNodes[index])
        else roots.push(leafNodes[index])
    })
    return roots
}

/** True when making turnout `index` a child of VIRTUAL turnout `parentId` would create a loop (or isn't allowed). */
export function wouldCreateCycle(turnouts: Turnout[], index: number, parentId: number): boolean {
    const target = turnouts.findIndex(t => t.id === parentId)
    if (target === -1) return false
    let cur = target
    const seen = new Set<number>()
    while (cur !== -1 && !seen.has(cur)) {
        if (cur === index) return true
        seen.add(cur)
        cur = effectiveParentIndex(turnouts, cur)
    }
    return false
}

/** Where a turnout currently sits, as written (not resolved). */
export function locationOf(t: Turnout): TurnoutLocation {
    if (t.parentId !== undefined) return { parentId: t.parentId }
    if (t.folder) return { folder: t.folder }
    return {}
}

function withLocation(t: Turnout, loc: TurnoutLocation): Turnout {
    const { folder: _f, parentId: _p, ...rest } = t
    const out = { ...rest } as Turnout
    if (loc.parentId !== undefined) out.parentId = loc.parentId
    else if (loc.folder) out.folder = loc.folder
    return out
}

/** Moves turnout `index` to `loc`. Returns null when the move is invalid (target isn't a VIRTUAL turnout, or loops). */
export function moveTurnout(turnouts: Turnout[], index: number, loc: TurnoutLocation): Turnout[] | null {
    if (loc.parentId !== undefined) {
        const parent = turnouts.find(t => t.id === loc.parentId)
        if (!parent || parent.type !== 'VIRTUAL') return null
        if (turnouts[index].id === loc.parentId || wouldCreateCycle(turnouts, index, loc.parentId)) return null
    }
    const normalized: TurnoutLocation = loc.folder ? { folder: normalizeFolderPath(loc.folder) } : loc
    return turnouts.map((t, i) => (i === index ? withLocation(t, normalized) : t))
}

/**
 * Re-homes the children of turnout `index` onto its own location — used before deleting it, or
 * changing it from VIRTUAL, so children aren't orphaned into a parent that no longer exists.
 */
export function releaseChildren(turnouts: Turnout[], index: number): Turnout[] {
    const removed = turnouts[index]
    const loc = locationOf(removed)
    return turnouts.map((t, i) => (i !== index && t.parentId === removed.id ? withLocation(t, loc) : t))
}

/** Points children of VIRTUAL turnout `oldId` at `newId` (the parent's id was edited). */
export function retargetChildren(turnouts: Turnout[], oldId: number, newId: number): Turnout[] {
    if (oldId === newId) return turnouts
    return turnouts.map(t => (t.parentId === oldId ? { ...t, parentId: newId } : t))
}

/** Declares a folder (and so its ancestors). */
export function addFolder(edit: TurnoutTreeEdit, path: string): TurnoutTreeEdit {
    const r = addFolderGeneric({ items: edit.turnouts, folders: edit.folders }, path)
    return r.folders === edit.folders ? edit : { turnouts: r.items, folders: r.folders }
}

/** Renames/moves folder `from` (and everything under it) to `to`. `to` must not already exist. */
export function renameFolder(edit: TurnoutTreeEdit, from: string, to: string): TurnoutTreeEdit | null {
    const r = renameFolderGeneric({ items: edit.turnouts, folders: edit.folders }, from, to)
    return r && { turnouts: r.items, folders: r.folders }
}

/** Deletes folder `path`: its turnouts and subfolders move up to its parent (nothing is deleted but the folder). */
export function deleteFolder(edit: TurnoutTreeEdit, path: string): TurnoutTreeEdit {
    const r = deleteFolderGeneric({ items: edit.turnouts, folders: edit.folders }, path)
    return { turnouts: r.items, folders: r.folders }
}
