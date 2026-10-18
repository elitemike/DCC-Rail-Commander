/**
 * Pure logic for folder grouping of any config list (sensors, signals, routes, sequences, ...).
 * An entry's folder is stored on the entry itself (`folder`, persisted as `// @tree:` comment lines —
 * see parseFolderMeta in myAutomationParser.ts), so grouping is *logical only*: it never changes
 * the EXRAIL macros, their ids, or their order in the file.
 *
 * turnout-tree.ts builds on the same helpers and adds VIRTUAL-turnout parents; the roster has its
 * own macro-derived grouping (deriveDefineGroups) and does not use this.
 */

import { normalizeFolderPath } from './myAutomationParser'

export interface FolderItem {
    folder?: string
}

export interface FolderNode {
    kind: 'folder'
    path: string
    name: string
    children: FolderTreeNode[]
}

export interface ItemNode {
    kind: 'item'
    /** Index into the items array. */
    index: number
}

export type FolderTreeNode = FolderNode | ItemNode

/** The config lists that support folder grouping; each has a `<singular>Folders` field in ConfigEditorState. */
export type FolderKind = 'sensors' | 'signals' | 'routes' | 'sequences' | 'automations' | 'eventHandlers' | 'aliases' | 'roster'

export const folderField = (kind: FolderKind): string => `${kind === 'aliases' ? 'alias' : kind === 'roster' ? 'roster' : kind.slice(0, -1)}Folders`

export interface FolderEdit<T extends FolderItem> {
    items: T[]
    folders: string[]
}

const folderParent = (path: string): string => path.split('/').slice(0, -1).join('/')
const folderName = (path: string): string => path.split('/').pop() ?? path
export const isUnder = (path: string, ancestor: string): boolean => path === ancestor || path.startsWith(`${ancestor}/`)

/** Folder names can't contain "/" (the path separator) and can't be blank. */
export function isValidFolderName(name: string): boolean {
    const n = name.trim()
    return n.length > 0 && !n.includes('/') && !n.includes('\n') && !n.includes('\r')
}

/** Every folder path in use — declared ones plus every item's, each with all of its ancestors. Sorted. */
export function allFolderPaths(items: FolderItem[], declared: string[]): string[] {
    const set = new Set<string>()
    const add = (path: string | undefined) => {
        if (!path) return
        const segs = path.split('/')
        for (let i = 1; i <= segs.length; i++) set.add(segs.slice(0, i).join('/'))
    }
    declared.forEach(add)
    items.forEach(t => add(t.folder))
    return [...set].sort((a, b) => a.localeCompare(b))
}

/** Folders first (alphabetical), then items in file order; at every level. */
export function buildFolderTree(items: FolderItem[], declared: string[]): FolderTreeNode[] {
    const folderNodes = new Map<string, FolderNode>()
    for (const path of allFolderPaths(items, declared)) {
        folderNodes.set(path, { kind: 'folder', path, name: folderName(path), children: [] })
    }
    const roots: FolderTreeNode[] = []
    for (const node of folderNodes.values()) {
        const parent = folderNodes.get(folderParent(node.path))
        ;(parent ? parent.children : roots).push(node)
    }
    items.forEach((it, index) => {
        const leaf: ItemNode = { kind: 'item', index }
        ;(it.folder ? folderNodes.get(it.folder)?.children ?? roots : roots).push(leaf)
    })
    return roots
}

/** Indices of the items inside `folder` (and every subfolder). `undefined`/'' means all items. */
export function itemIndicesUnder(items: FolderItem[], folder: string | undefined): number[] {
    const out: number[] = []
    items.forEach((it, i) => {
        if (!folder || (it.folder && isUnder(it.folder, folder))) out.push(i)
    })
    return out
}

/** Moves item `index` into `folder` ('' / undefined = top level). */
export function moveItemToFolder<T extends FolderItem>(items: T[], index: number, folder: string | undefined): T[] {
    const target = folder ? normalizeFolderPath(folder) : ''
    return items.map((it, i) => {
        if (i !== index) return it
        const { folder: _f, ...rest } = it
        return (target ? { ...rest, folder: target } : rest) as T
    })
}

/** Declares a folder (and so its ancestors). */
export function addFolder<T extends FolderItem>(edit: FolderEdit<T>, path: string): FolderEdit<T> {
    const p = normalizeFolderPath(path)
    if (!p || edit.folders.includes(p)) return edit
    return { items: edit.items, folders: [...edit.folders, p] }
}

function rewritePrefix(path: string, from: string, to: string): string {
    if (!isUnder(path, from)) return path
    const rest = path.slice(from.length)
    return to ? `${to}${rest}` : rest.replace(/^\//, '')
}

/** Renames/moves folder `from` (and everything under it) to `to`. `to` must not already exist. */
export function renameFolder<T extends FolderItem>(edit: FolderEdit<T>, from: string, to: string): FolderEdit<T> | null {
    const target = normalizeFolderPath(to)
    if (!target || target === from) return null
    if (isUnder(target, from)) return null // can't move a folder inside itself
    if (allFolderPaths(edit.items, edit.folders).includes(target)) return null
    return {
        items: edit.items.map(t => (t.folder && isUnder(t.folder, from) ? { ...t, folder: rewritePrefix(t.folder, from, target) } : t)),
        folders: [...new Set(edit.folders.map(f => rewritePrefix(f, from, target)))],
    }
}

/** Deletes folder `path`: its items and subfolders move up to its parent (nothing is deleted but the folder). */
export function deleteFolder<T extends FolderItem>(edit: FolderEdit<T>, path: string): FolderEdit<T> {
    const parent = folderParent(path)
    const lift = (p: string): string => (p === path ? parent : rewritePrefix(p, path, parent))
    return {
        items: edit.items.map(t => {
            if (!t.folder || !isUnder(t.folder, path)) return t
            const next = lift(t.folder)
            const { folder: _f, ...rest } = t
            return (next ? { ...rest, folder: next } : rest) as T
        }),
        folders: [...new Set(edit.folders.filter(f => f !== path).map(lift).filter(Boolean))],
    }
}
