import { bindable, resolve } from 'aurelia'
import { IDialogService } from '@aurelia/dialog'
import { buildFolderTree, isValidFolderName, itemIndicesUnder, type FolderItem, type FolderTreeNode } from '../utils/folder-tree'
import { confirmAction } from '../utils/confirm-action'
import { ToastService } from '../services/toast.service'
import type { TextInputResult } from './dialogs/text-input-dialog'

interface TreeRow {
    kind: 'folder' | 'item'
    key: string
    depth: number
    label: string
    /** Folder path (folders) or the item's own folder (items). */
    path: string
    /** Index into `items` (items) — -1 for folders. */
    index: number
    count: number
    open: boolean
}

/**
 * Left-hand navigator shared by the list editors (sensors, signals, routes, ...): a tree of folders
 * with the entries as leaves. Selecting a leaf sets `selectedIndex` (the editor shows just that
 * entry in its right pane); selecting a folder sets `selectedFolder` and clears the index. Folders
 * are purely logical grouping — the panel never touches the entries' EXRAIL macros. Entries can be
 * dragged onto a folder (or the "All" root row) to move them.
 *
 * The editor owns the data: it passes `items` (anything with an optional `folder`), `folders`
 * (declared, possibly empty), `itemLabel`, and add/rename/remove/move callbacks.
 */
export class FolderTreePanelCustomElement {
    private readonly dialogService = resolve(IDialogService)
    private readonly toastService = resolve(ToastService)

    @bindable items: FolderItem[] = []
    @bindable folders: string[] = []
    @bindable({ mode: 'twoWay' }) selectedFolder = ''
    @bindable({ mode: 'twoWay' }) selectedIndex = -1
    @bindable label = 'Items'
    @bindable itemLabel: (item: FolderItem, index: number) => string = (_i, n) => `#${n + 1}`
    @bindable onAdd!: (path: string) => boolean
    @bindable onRename!: (from: string, to: string) => boolean
    @bindable onRemove!: (path: string) => void
    @bindable onMove!: (index: number, folder: string) => void

    /** localStorage key for the panel width — shared by default so every tree view resizes together (like the turnout editor's sidebar). */
    @bindable widthKey = 'tree-panel-width'
    width = 256
    private static readonly MIN_WIDTH = 200
    private static readonly MAX_WIDTH = 600

    attached(): void {
        try {
            const saved = parseInt(localStorage.getItem(this.widthKey) ?? '', 10)
            if (Number.isFinite(saved)) this.width = this._clamp(saved)
        } catch { /* storage unavailable — keep the default */ }
    }

    private _clamp(w: number): number {
        return Math.min(FolderTreePanelCustomElement.MAX_WIDTH, Math.max(FolderTreePanelCustomElement.MIN_WIDTH, w))
    }

    /** Drag handle on the panel's right edge. */
    startResize(event: PointerEvent): void {
        const handle = event.currentTarget as HTMLElement
        const startX = event.clientX
        const startWidth = this.width
        handle.setPointerCapture(event.pointerId)
        const move = (e: PointerEvent): void => { this.width = this._clamp(startWidth + e.clientX - startX) }
        const up = (): void => {
            handle.removeEventListener('pointermove', move)
            handle.removeEventListener('pointerup', up)
            handle.removeEventListener('pointercancel', up)
            try { localStorage.setItem(this.widthKey, String(this.width)) } catch { /* ignore */ }
        }
        handle.addEventListener('pointermove', move)
        handle.addEventListener('pointerup', up)
        handle.addEventListener('pointercancel', up)
    }

    /** Folder paths the user has collapsed (everything starts expanded). */
    collapsed: string[] = []
    private _dragIndex = -1

    get rows(): TreeRow[] {
        const out: TreeRow[] = []
        const walk = (nodes: FolderTreeNode[], depth: number): void => {
            for (const n of nodes) {
                if (n.kind === 'folder') {
                    const open = !this.collapsed.includes(n.path)
                    out.push({ kind: 'folder', key: `f:${n.path}`, depth, label: n.name, path: n.path, index: -1, count: itemIndicesUnder(this.items, n.path).length, open })
                    if (open) walk(n.children, depth + 1)
                } else {
                    const item = this.items[n.index]
                    out.push({ kind: 'item', key: `i:${n.index}`, depth, label: this.itemLabel(item, n.index), path: item.folder ?? '', index: n.index, count: 0, open: false })
                }
            }
        }
        walk(buildFolderTree(this.items, this.folders), 0)
        return out
    }

    selectFolder(path: string): void {
        this.selectedIndex = -1
        this.selectedFolder = path
    }

    selectItem(index: number): void {
        this.selectedIndex = index
        this.selectedFolder = ''
    }

    toggle(path: string): void {
        this.collapsed = this.collapsed.includes(path) ? this.collapsed.filter(p => p !== path) : [...this.collapsed, path]
    }

    isSelected(row: TreeRow): boolean {
        return row.kind === 'folder' ? this.selectedIndex < 0 && this.selectedFolder === row.path : this.selectedIndex === row.index
    }

    /** Where "New folder" goes: inside the selected folder, or beside the selected entry. */
    private get _container(): string {
        if (this.selectedIndex >= 0) return this.items[this.selectedIndex]?.folder ?? ''
        return this.selectedFolder
    }

    // ── Drag & drop (entries onto folders) ────────────────────────────────────
    dragStart(event: DragEvent, row: TreeRow): void {
        if (row.kind !== 'item') return
        this._dragIndex = row.index
        event.dataTransfer?.setData('text/plain', String(row.index))
    }

    dragOver(event: DragEvent): void {
        if (this._dragIndex >= 0) event.preventDefault()
    }

    drop(event: DragEvent, folder: string): void {
        event.stopPropagation()
        event.preventDefault()
        const index = this._dragIndex
        this._dragIndex = -1
        if (index < 0) return
        this.onMove(index, folder)
        this.selectItem(index)
    }

    private async _prompt(title: string, label: string, value: string, confirmLabel: string, validate: (v: string) => string): Promise<string | null> {
        const { dialog } = await this.dialogService.open({
            component: () => import('./dialogs/text-input-dialog').then(m => m.TextInputDialog).catch(() => null),
            model: { title, label, value, confirmLabel, validate },
        })
        const result = await dialog.closed
        if (result.status !== 'ok' || !result.value) return null
        return (result.value as TextInputResult).value
    }

    private _validateName = (v: string): string => (isValidFolderName(v) ? '' : 'Folder names can\'t be blank or contain "/".')

    /** New folder inside the selected folder (or at the top level when "All" is selected). */
    async promptNewFolder(): Promise<void> {
        const name = await this._prompt('New Folder', 'Folder name', '', 'Create', this._validateName)
        if (name === null) return
        const container = this._container
        const path = container ? `${container}/${name}` : name
        if (!this.onAdd(path)) {
            this.toastService.show({ title: "Can't Create Folder", content: `A folder named "${path}" already exists.`, cssClass: 'e-toast-warning' })
            return
        }
        this.selectFolder(path)
    }

    async promptRename(): Promise<void> {
        const from = this.selectedFolder
        if (!from) return
        const current = from.split('/').pop() ?? from
        const name = await this._prompt('Rename Folder', 'Folder name', current, 'Rename', this._validateName)
        if (name === null || name === current) return
        const parent = from.split('/').slice(0, -1).join('/')
        const to = parent ? `${parent}/${name}` : name
        if (!this.onRename(from, to)) {
            this.toastService.show({ title: "Can't Rename Folder", content: `A folder named "${to}" already exists.`, cssClass: 'e-toast-warning' })
            return
        }
        this.selectFolder(to)
    }

    async confirmDelete(): Promise<void> {
        const path = this.selectedFolder
        if (!path) return
        if (!(await confirmAction(this.dialogService, `Delete folder "${path}"?`, `Its ${this.label.toLowerCase()} and subfolders move up one level — nothing else is deleted.`, { confirmLabel: 'Delete folder' }))) return
        this.onRemove(path)
        this.selectFolder(path.split('/').slice(0, -1).join('/'))
    }
}
