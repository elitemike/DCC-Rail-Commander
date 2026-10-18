import { resolve } from 'aurelia'
import { IDialogService } from '@aurelia/dialog'
import { confirmAction } from '../../utils/confirm-action'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { SignalEntry } from '../../utils/myAutomationParser'
import { allFolderPaths } from '../../utils/folder-tree'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

type SignalKind = SignalEntry['type']

export class SignalsEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly dialogService = resolve(IDialogService)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)
    activeTab: 'visual' | 'raw' = 'visual'
    /** Set once the user explicitly clicks Visual/Raw for this file. Until then, attached() re-applies the current default-editor-view preference on every visit — see attached() below. */
    private _userChoseTab = false
    rawEditor: any = null

    attached(): void {
        // Aurelia's if.bind caches and reuses this same component instance across
        // hide/show cycles — re-apply the current default-editor-view preference on
        // every visit (not just the first) so a setting change made while this
        // file's editor already existed still takes effect, as long as the user
        // hasn't manually picked a tab for it this session (_userChoseTab).
        this._applyDefaultViewIfUnset()
        this._ensureSelection()
        try { console.debug('SignalsEditor attached') } catch { /* ignore */ }
    }

    setTab(t: 'visual' | 'raw') {
        this._userChoseTab = true
        this._applyTab(t)
    }

    /** Applies the current default-editor-view preference, unless the user has already picked a tab for this file this session. Called from attached() on every visit — see there for why. */
    private _applyDefaultViewIfUnset(): void {
        if (!this._userChoseTab) this._applyTab(this.editorDefaultView.value)
    }

    /** setTab()'s actual work, factored out so attached() can (re)apply the default-editor-view preference without marking it as a user choice. */
    private _applyTab(t: 'visual' | 'raw') {
        if (t === 'raw') this.rawSnapshot = this.state.signalsRaw
        this.activeTab = t
        if (t === 'visual') this._ensureSelection()
        if (t === 'raw') setTimeout(() => { try { this.rawEditor?.editor?.layout?.() } catch { } }, 50)
    }

    rawSnapshot = ''

    // ── Folders (logical grouping only — see folder-tree.ts) ─────────────────
    /** Folder selected in the tree ('' = none); new signals are created inside it. */
    selectedFolder = ''
    /** Index into state.signals of the signal being edited, or -1. The right pane shows only this one. */
    selectedIndex = -1

    get selectedIndices(): number[] {
        return this.selectedIndex >= 0 && this.selectedIndex < this.state.signals.length ? [this.selectedIndex] : []
    }

    get folderPaths(): string[] {
        return allFolderPaths(this.state.signals, this.state.signalFolders)
    }

    itemLabel = (item: SignalEntry, index: number): string => item.description || `Signal ${index + 1}`

    addFolder = (path: string): boolean => this.state.addFolderTo('signals', path)
    renameFolder = (from: string, to: string): boolean => this.state.renameFolderIn('signals', from, to)
    removeFolder = (path: string): void => this.state.deleteFolderFrom('signals', path)
    moveToFolder = (idx: number, folder: string): void => this.state.moveToFolder('signals', idx, folder)

    /** Keeps the right pane useful: pick the first signal when nothing valid is selected. */
    private _ensureSelection(): void {
        if (this.selectedFolder) return
        if (this.selectedIndex < 0 || this.selectedIndex >= this.state.signals.length) {
            this.selectedIndex = this.state.signals.length > 0 ? 0 : -1
        }
    }

    onRawChange = (text: string) => {
        this.rawSnapshot = text
        this.state.setSignalsFromRaw(text)
    }

    readonly signalKinds: { value: SignalKind; label: string }[] = [
        { value: 'PIN', label: 'Pins (red/amber/green)' },
        { value: 'DCC', label: 'DCC accessory' },
    ]

    addSignal() {
        const folder = this.selectedIndex >= 0 ? this.state.signals[this.selectedIndex]?.folder ?? '' : this.selectedFolder
        this.state.signals = [...this.state.signals, { type: 'PIN', red: 0, amber: 0, green: 0, description: '', ...(folder ? { folder } : {}) }]
        this.selectedFolder = ''
        this.selectedIndex = this.state.signals.length - 1
        this.state.syncAll()
    }

    async removeSignal(idx: number) {
        const entry = this.state.signals[idx]
        if (!entry) return
        if (!(await confirmAction(this.dialogService, `Delete "${entry.description ? entry.description : `Signal ${idx + 1}`}"?`, 'Are you sure you want to remove this signal?'))) return
        this.state.signals = this.state.signals.filter((_, i) => i !== idx)
        this.selectedIndex = -1
        this.state.syncAll()
    }

    updateSignal(idx: number, s: SignalEntry) {
        this.state.signals = this.state.signals.map((v, i) => i === idx ? { ...s } : v)
        this.state.syncAll()
    }

    /**
     * Switches a row's kind, converting to that kind's shape with fresh defaults for any
     * newly-required fields, preserving only `description` (PIN and DCC share no other field).
     */
    changeSignalType(idx: number, type: SignalKind): void {
        const current = this.state.signals[idx]
        if (!current || current.type === type) return
        const description = current.description
        const folder = current.folder
        const next: SignalEntry = type === 'DCC'
            ? { type: 'DCC', id: 0, addr: 0, subAddr: 0, description, ...(folder ? { folder } : {}) }
            : { type: 'PIN', red: 0, amber: 0, green: 0, description, ...(folder ? { folder } : {}) }
        this.updateSignal(idx, next)
    }

    /** Passed to <vpin-picker on-commit.bind>, which needs a zero-arg callback rather than an event to trigger. */
    makeSignalCommitHandler(idx: number): () => void {
        return () => this.updateSignal(idx, this.state.signals[idx])
    }
}
