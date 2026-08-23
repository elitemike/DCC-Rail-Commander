import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import { InstallerState } from '../../models/installer-state'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

type ViewTab = 'visual' | 'raw'

/**
 * accessories-editor — editor for the HAL Devices (I2C accessory boards)
 * managed block, which physically lives inside myAutomation.h's
 * MANAGED_HAL_DEVICES_TAG block but is surfaced as its own row under Device
 * Settings so it's unambiguous which file/section is being edited.
 *
 * Unlike the other file-level editors, this one is not routed through
 * file-editor-panel's filename-keyed dispatcher — it has no configFiles
 * entry of its own to point activeFileIndex at (see workspace.ts's
 * activeSection === 'accessories' branch). Its Raw tab is scoped to just the
 * HAL Devices block's own text (generatedHalDevicesContent), not the whole
 * myAutomation.h file.
 */
export class AccessoriesEditorCustomElement {
    private readonly state = resolve(ConfigEditorState)
    private readonly installerState = resolve(InstallerState)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)

    activeTab: ViewTab = 'visual'
    /** Set once the user explicitly clicks Visual/Raw for this section. Until then, attached() re-applies the current default-editor-view preference on every visit — see attached() below. */
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
    // section's editor already existed still takes effect, as long as the user
    // hasn't manually picked a tab for it this session (_userChoseTab).
    attached(): void {
        if (!this._userChoseTab) this.activeTab = this.editorDefaultView.value
    }

    setTab(tab: ViewTab): void {
        this._userChoseTab = true
        this.activeTab = tab
    }

    get content(): string {
        return this.state.generatedHalDevicesContent
    }

    set content(val: string) {
        this.state.syncHalDevices(val)
    }

    flush(): void {
        this.rawEditor?.flush()
    }

    /** Called by workspace.flushPendingFormEdits() — this component isn't routed through file-editor-panel. */
    flushPending(): void {
        this.flush()
    }
}
