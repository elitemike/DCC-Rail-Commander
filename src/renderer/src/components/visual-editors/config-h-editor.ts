import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import { InstallerState } from '../../models/installer-state'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

type ViewTab = 'visual' | 'raw'

/**
 * config-h-editor — editor for config.h / myConfig.h.
 *
 * Provides a Visual/Raw toggle:
 *   - Visual: dispatches to a product-specific form component
 *   - Raw:    Monaco raw C++ editor (unchanged behaviour)
 */
export class ConfigHEditorCustomElement {
    private readonly state = resolve(ConfigEditorState)
    private readonly installerState = resolve(InstallerState)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)

    activeTab: ViewTab = 'visual'
    /** Set once the user explicitly clicks Visual/Raw for this file. Until then, attached() re-applies the current default-editor-view preference on every visit — see attached() below. */
    private _userChoseTab = false

    get productId(): string | null {
        return this.installerState.selectedProduct
    }

    get hasVisualEditor(): boolean {
        return this.productId === 'ex_commandstation' || this.productId === 'ex_ioexpander'
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

    get content(): string {
        return this.state.configHContent
    }

    onRawChange = (text: string): void => {
        this.state.configHContent = text
        this.state.syncConfigH()
    }
}
