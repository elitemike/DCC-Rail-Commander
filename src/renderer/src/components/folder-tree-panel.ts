import { bindable, resolve } from 'aurelia'
import { IDialogService } from '@aurelia/dialog'
import { allFolderPaths, isValidFolderName, itemIndicesUnder, type FolderItem } from '../utils/folder-tree'
import { confirmAction } from '../utils/confirm-action'
import { ToastService } from '../services/toast.service'
import type { TextInputResult } from './dialogs/text-input-dialog'

interface FolderRow {
    path: string
    name: string
    depth: number
    count: number
}

/**
 * Left-hand folder navigator shared by the list editors (sensors, signals, routes, ...). Folders are
 * purely logical grouping — the panel never touches the entries' EXRAIL macros. The editor owns the
 * data: it passes `items` (anything with an optional `folder`) and `folders` (declared, possibly
 * empty), and supplies add/rename/remove callbacks that return whether the edit was accepted.
 * `selected` is the folder whose subtree the editor should list ('' = everything).
 */
export class FolderTreePanelCustomElement {
    private readonly dialogService = resolve(IDialogService)
    private readonly toastService = resolve(ToastService)

    @bindable items: FolderItem[] = []
    @bindable folders: string[] = []
    @bindable({ mode: 'twoWay' }) selected = ''
    @bindable label = 'Items'
    @bindable onAdd!: (path: string) => boolean
    @bindable onRename!: (from: string, to: string) => boolean
    @bindable onRemove!: (path: string) => void

    get total(): number {
        return this.items.length
    }

    get rows(): FolderRow[] {
        return allFolderPaths(this.items, this.folders).map(path => ({
            path,
            name: path.split('/').pop() ?? path,
            depth: path.split('/').length - 1,
            count: itemIndicesUnder(this.items, path).length,
        }))
    }

    select(path: string): void {
        this.selected = path
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
        const path = this.selected ? `${this.selected}/${name}` : name
        if (!this.onAdd(path)) {
            this.toastService.show({ title: "Can't Create Folder", content: `A folder named "${path}" already exists.`, cssClass: 'e-toast-warning' })
            return
        }
        this.selected = path
    }

    async promptRename(): Promise<void> {
        const from = this.selected
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
        this.selected = to
    }

    async confirmDelete(): Promise<void> {
        const path = this.selected
        if (!path) return
        if (!(await confirmAction(this.dialogService, `Delete folder "${path}"?`, `Its ${this.label.toLowerCase()} and subfolders move up one level — nothing else is deleted.`, { confirmLabel: 'Delete folder' }))) return
        this.onRemove(path)
        this.selected = path.split('/').slice(0, -1).join('/')
    }
}
