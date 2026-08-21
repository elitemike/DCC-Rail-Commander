import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { resolve } from 'aurelia'
import * as monaco from 'monaco-editor'
import { ThemeService } from '../../services/theme.service'
import { defineEditorThemes } from '../monaco-editor'
import type { FileChangeEntry } from '../../utils/config-file-diff'

interface FileChangesDialogModel {
    files: FileChangeEntry[]
    onSave: () => Promise<void>
}

export class FileChangesDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)
    private readonly themeService = resolve(ThemeService)

    files: FileChangeEntry[] = []
    selectedIndex = 0
    saving = false

    private onSave: () => Promise<void> = async () => {}
    private container!: HTMLElement
    private diffEditor: monaco.editor.IStandaloneDiffEditor | null = null
    private originalModel: monaco.editor.ITextModel | null = null
    private modifiedModel: monaco.editor.ITextModel | null = null
    private unsubTheme: (() => void) | null = null
    private resizeObserver: ResizeObserver | null = null

    activate(model: FileChangesDialogModel): void {
        // Only files that will actually differ on disk are worth showing —
        // an unchanged file has nothing to preview.
        this.files = model.files.filter((f) => f.status !== 'unchanged')
        this.selectedIndex = 0
        this.onSave = model.onSave
    }

    attached(): void {
        if (this.files.length === 0) return
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

    selectFile(index: number): void {
        this.selectedIndex = index
        this.setModels()
    }

    private setModels(): void {
        const entry = this.files[this.selectedIndex]
        if (!entry || !this.diffEditor) return
        this.originalModel?.dispose()
        this.modifiedModel?.dispose()
        // Deliberately no URI: the live raw editors cache models keyed by
        // monaco.Uri.file(filename), and reusing that key here would collide
        // with (and throw against) an already-open editor for the same file.
        this.originalModel = monaco.editor.createModel(entry.before, 'cpp')
        this.modifiedModel = monaco.editor.createModel(entry.after, 'cpp')
        this.diffEditor.setModel({ original: this.originalModel, modified: this.modifiedModel })
    }

    close(): void {
        void this.$dialog.ok()
    }

    async save(): Promise<void> {
        if (this.saving) return
        this.saving = true
        try {
            await this.onSave()
        } finally {
            this.saving = false
        }
        void this.$dialog.ok()
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
