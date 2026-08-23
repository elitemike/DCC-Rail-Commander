import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import { InstallerState } from '../../models/installer-state'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

type ViewTab = 'visual' | 'raw'

/**
 * startup-editor — editor for myStartup.h (track power/mode + turnout
 * defaults, i.e. everything that runs at power-on).
 *
 * Provides a Visual/Raw toggle:
 *   - Visual: TrackManager form + a read-only Turnout Defaults summary
 *   - Raw:    Monaco editor with the managed sections
 */
export class StartupEditorCustomElement {
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

    private get startupFile(): { name: string; content: string } | null {
        return this.installerState.configFiles.find(f => f.name === 'myStartup.h') ?? null
    }

    get content(): string {
        return this.startupFile?.content ?? this.state.startupPreview
    }

    set content(val: string) {
        if (this.startupFile) {
            this.startupFile.content = val
        } else {
            this.installerState.configFiles.push({ name: 'myStartup.h', content: val })
        }
        this.state.hasChanges = true
    }

    flush(): void {
        this.rawEditor?.flush()
    }
}
