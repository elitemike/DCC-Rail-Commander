import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import { InstallerState } from '../../models/installer-state'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

type ViewTab = 'visual' | 'raw'

/**
 * automation-editor — editor for myAutomation.h.
 *
 * Provides a Visual/Raw toggle:
 *   - Visual: TrackManager form (the only structured part of myAutomation.h —
 *     includes/turnout-defaults/custom EXRAIL content remain raw-only)
 *   - Raw:    Monaco editor with the managed sections (unchanged behaviour)
 */
export class AutomationEditorCustomElement {
    private readonly state = resolve(ConfigEditorState)
    private readonly installerState = resolve(InstallerState)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)

    activeTab: ViewTab = 'visual'
    /** Set once the user explicitly clicks Visual/Raw for this file. Until then, attached() re-applies the current default-editor-view preference on every visit — see attached() below. */
    private _userChoseTab = false

    /** Ref to the raw Monaco editor — used to flush pending debounced edits before Save. */
    rawEditor: { flush(): string } | null = null

    get productId(): string | null {
        return this.installerState.selectedProduct
    }

    get hasVisualEditor(): boolean {
        return this.productId === 'ex_commandstation'
    }

    // Aurelia's if.bind caches and reuses this same component instance across
    // hide/show cycles — re-apply the current default-editor-view preference on
    // every visit (not just the first) so a setting change made while this
    // file's editor already existed still takes effect, as long as the user
    // hasn't manually picked a tab for it this session (_userChoseTab).
    attached(): void {
        if (!this._userChoseTab) this.activeTab = this.editorDefaultView.value
    }

    setTab(tab: ViewTab): void {
        this._userChoseTab = true
        this.activeTab = tab
    }

    private get automationFile(): { name: string; content: string } | null {
        return this.installerState.configFiles.find(f => f.name === 'myAutomation.h') ?? null
    }

    get content(): string {
        return this.automationFile?.content ?? this.state.automationPreview
    }

    set content(val: string) {
        if (this.automationFile) {
            this.automationFile.content = val
            this.state.hasChanges = true
        }
    }

    flush(): void {
        this.rawEditor?.flush()
    }
}
