import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { resolve } from 'aurelia'
import * as monaco from 'monaco-editor'
import { ThemeService } from '../../services/theme.service'
import { defineEditorThemes } from '../monaco-editor'
import type { LocalHistorySnapshot } from '../../services/local-history.service'

interface LocalHistoryDialogModel {
    fileName: string
    currentContent: string
    snapshots: LocalHistorySnapshot[]
}

/**
 * Local (app-only) version history for one config file — see src/main/local-history.ts for why
 * this exists. Snapshots are shown newest first, diffed against the file's current in-memory
 * content; Restore hands the picked snapshot's content back to workspace.ts's openLocalHistory().
 */
export class LocalHistoryDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)
    private readonly themeService = resolve(ThemeService)

    fileName = ''
    currentContent = ''
    snapshots: LocalHistorySnapshot[] = []
    selectedIndex = 0

    private container!: HTMLElement
    private diffEditor: monaco.editor.IStandaloneDiffEditor | null = null
    private originalModel: monaco.editor.ITextModel | null = null
    private modifiedModel: monaco.editor.ITextModel | null = null
    private unsubTheme: (() => void) | null = null
    private resizeObserver: ResizeObserver | null = null

    activate(model: LocalHistoryDialogModel): void {
        this.fileName = model.fileName
        this.currentContent = model.currentContent
        this.snapshots = model.snapshots
        this.selectedIndex = 0
    }

    attached(): void {
        if (this.snapshots.length === 0) return
        defineEditorThemes()
        this.diffEditor = monaco.editor.createDiffEditor(this.container, {
            readOnly: true,
            renderSideBySide: true,
            automaticLayout: true,
            theme: this.themeService.effective === 'dark' ? 'dccex-dark' : 'dccex-light',
            fontSize: 13,
            lineHeight: 20,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
            scrollBeyondLastLine: false,
        })
        this.setModels()

        requestAnimationFrame(() => this.diffEditor?.layout())
        setTimeout(() => this.diffEditor?.layout(), 50)

        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                try {
                    this.diffEditor?.layout()
                } catch {
                    // Container may already be detached — ignore.
                }
            })
            this.resizeObserver.observe(this.container)
        }

        this.unsubTheme = this.themeService.onChange((effective) => {
            monaco.editor.setTheme(effective === 'dark' ? 'dccex-dark' : 'dccex-light')
        })
    }

    selectSnapshot(index: number): void {
        this.selectedIndex = index
        this.setModels()
    }

    /** Snapshot's older content on the left, current in-memory content on the right. */
    private setModels(): void {
        const snapshot = this.snapshots[this.selectedIndex]
        if (!snapshot || !this.diffEditor) return
        this.originalModel?.dispose()
        this.modifiedModel?.dispose()
        this.originalModel = monaco.editor.createModel(snapshot.content, 'cpp')
        this.modifiedModel = monaco.editor.createModel(this.currentContent, 'cpp')
        this.diffEditor.setModel({ original: this.originalModel, modified: this.modifiedModel })
    }

    formatTimestamp(iso: string): string {
        try {
            return new Date(iso).toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
            })
        } catch {
            return iso
        }
    }

    restore(): void {
        const snapshot = this.snapshots[this.selectedIndex]
        if (!snapshot) return
        void this.$dialog.ok(snapshot.content)
    }

    close(): void {
        void this.$dialog.cancel()
    }

    detaching(): void {
        this.unsubTheme?.()
        this.resizeObserver?.disconnect()
        this.diffEditor?.dispose()
        this.originalModel?.dispose()
        this.modifiedModel?.dispose()
        this.diffEditor = null
        this.originalModel = null
        this.modifiedModel = null
    }
}
